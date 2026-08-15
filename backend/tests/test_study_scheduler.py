"""study_scheduler 纯函数调度器的单元测试。

运行：cd backend && .venv\\Scripts\\python -m pytest tests -q
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import study_scheduler


def kp(pid, name=None, *, weight=10, mastery=50, difficulty=3, prereqs=None, module="m-1"):
    return {
        "id": pid,
        "name": name or pid,
        "weight": weight,
        "mastery": mastery,
        "difficulty": difficulty,
        "prerequisites": list(prereqs or []),
        "moduleId": module,
    }


def task(tid, kp_id, *, day=1, order=1, duration=60, status="pending", priority="medium"):
    return {
        "id": tid,
        "knowledgePointId": kp_id,
        "title": f"任务{tid}",
        "day": day,
        "order": order,
        "duration": duration,
        "status": status,
        "priority": priority,
        "weight": 10,
    }


# ---------- sanitize_dependencies ----------

def test_sanitize_strips_self_unknown_and_duplicates():
    points = [
        kp("a", prereqs=["a", "ghost", "b", "b", ""]),
        kp("b"),
    ]
    warnings = study_scheduler.sanitize_dependencies(points)
    assert points[0]["prerequisites"] == ["b"]
    assert warnings == []


def test_sanitize_clamps_difficulty():
    points = [kp("a", difficulty=99), kp("b", difficulty=-2), kp("c", difficulty="x")]
    study_scheduler.sanitize_dependencies(points)
    assert [p["difficulty"] for p in points] == [5, 1, 3]


def test_sanitize_breaks_cycle_at_lowest_weight_target():
    # 三节点环 a→b→c→a（prereq 方向：a 依赖 b，b 依赖 c，c 依赖 a）。
    # c 的 weight 最低 → 断掉指向 c 的边，即 a 的 prerequisites 里的 "c" 被移除。
    points = [
        kp("a", weight=20, prereqs=["b"]),
        kp("b", weight=15, prereqs=["c"]),
        kp("c", weight=5, prereqs=["a"]),
    ]
    warnings = study_scheduler.sanitize_dependencies(points)
    prereq_map = {p["id"]: p["prerequisites"] for p in points}
    # 无环判定：再跑一次 _find_cycle 必须为 None。
    assert study_scheduler._find_cycle(points) is None
    assert any("环" in w for w in warnings)
    # 断掉的应是指向最低 weight 目标（c）的那条边。
    assert "c" not in prereq_map["a"]


def test_sanitize_is_idempotent():
    points = [kp("a", prereqs=["b"]), kp("b", prereqs=["a"])]
    study_scheduler.sanitize_dependencies(points)
    snapshot = copy.deepcopy(points)
    study_scheduler.sanitize_dependencies(points)
    assert points == snapshot


# ---------- topological_rank ----------

def test_topological_linear_chain():
    points = [kp("c", prereqs=["b"]), kp("b", prereqs=["a"]), kp("a", difficulty=1)]
    rank = study_scheduler.topological_rank(points)
    assert rank["a"] < rank["b"] < rank["c"]


def test_topological_diamond():
    points = [
        kp("a", difficulty=1),
        kp("b", prereqs=["a"], difficulty=2),
        kp("c", prereqs=["a"], difficulty=1),
        kp("d", prereqs=["b", "c"]),
    ]
    rank = study_scheduler.topological_rank(points)
    assert rank["a"] < rank["c"] < rank["b"] < rank["d"]  # 同层难度低者先


def test_topological_same_layer_prefers_high_weight():
    points = [kp("low", weight=5), kp("high", weight=30)]
    rank = study_scheduler.topological_rank(points)
    assert rank["high"] < rank["low"]


# ---------- schedule_tasks ----------

def test_schedule_packs_by_daily_budget():
    points = [kp("a"), kp("b"), kp("c")]
    tasks = [
        task("t1", "a", duration=60),
        task("t2", "b", duration=60),
        task("t3", "c", duration=90),
    ]
    warnings = study_scheduler.schedule_tasks(tasks, points, session_days=[1, 2], daily_minutes=120)
    assert warnings == []
    by_day = {}
    for t in tasks:
        by_day.setdefault(t["day"], []).append(t["duration"])
    assert sum(by_day.get(1, [])) <= 120
    assert sum(by_day.get(2, [])) <= 120
    assert sorted(t["order"] for t in tasks) == [1, 2, 3]


def test_schedule_uses_sparse_review_days():
    points = [kp(f"p{i}") for i in range(4)]
    tasks = [task(f"t{i}", f"p{i}", duration=60) for i in range(4)]
    study_scheduler.schedule_tasks(tasks, points, session_days=[1, 4, 7], daily_minutes=120)
    assert all(t["day"] in {1, 4, 7} for t in tasks)


def test_schedule_respects_prerequisite_order():
    points = [
        kp("basic", difficulty=1),
        kp("advanced", difficulty=4, prereqs=["basic"]),
    ]
    tasks = [task("t-adv", "advanced"), task("t-basic", "basic")]
    study_scheduler.schedule_tasks(tasks, points, session_days=[1, 2], daily_minutes=120)
    basic = next(t for t in tasks if t["knowledgePointId"] == "basic")
    advanced = next(t for t in tasks if t["knowledgePointId"] == "advanced")
    assert (basic["day"], basic["order"]) < (advanced["day"], advanced["order"])
    assert "需先完成" in advanced["schedulingReason"]
    assert "basic" in advanced["schedulingReason"]


def test_schedule_overflow_goes_to_last_day_with_warning():
    points = [kp("a"), kp("b")]
    tasks = [task("t1", "a", duration=120), task("t2", "b", duration=120)]
    warnings = study_scheduler.schedule_tasks(tasks, points, session_days=[1], daily_minutes=120)
    assert any("超出每日复习时长" in w for w in warnings)
    assert all(t["day"] == 1 for t in tasks)


# ---------- reprioritize_pending ----------

def test_reprioritize_empty_graph_matches_legacy_key():
    """空图降级 golden：与改造前 (day, mastery[kp], -weight) 排序逐字段一致。"""
    points = [
        kp("weak", mastery=20, weight=30),
        kp("strong", mastery=90, weight=10),
        kp("mid", mastery=55, weight=20),
    ]
    tasks = [
        task("t1", "strong", day=1, order=1),
        task("t2", "weak", day=1, order=2),
        task("t3", "mid", day=2, order=3),
    ]
    legacy_expected = sorted(
        tasks,
        key=lambda t: (
            t["day"],
            {"weak": 20, "strong": 90, "mid": 55}.get(t["knowledgePointId"], 100),
            -t["weight"],
        ),
    )
    study_scheduler.reprioritize_pending(tasks, points, session_days=[1, 2], daily_minutes=120)
    assert tasks == legacy_expected
    assert [t["order"] for t in tasks] == [1, 2, 3]


def test_reprioritize_failed_kp_cannot_jump_pending_prerequisite():
    points = [
        kp("basic"),
        kp("adv", prereqs=["basic"]),
    ]
    tasks = [
        task("t-basic", "basic", day=1, order=1),
        task("t-adv", "adv", day=2, order=2, priority="high"),
    ]
    warnings = study_scheduler.reprioritize_pending(tasks, points, session_days=[1, 2], daily_minutes=120)
    adv = next(t for t in tasks if t["knowledgePointId"] == "adv")
    basic = next(t for t in tasks if t["knowledgePointId"] == "basic")
    # 失分高优知识点也绝不能排到未完成前置之前。
    assert (adv["day"], adv["order"]) > (basic["day"], basic["order"])


def test_reprioritize_unlocks_after_prerequisite_completed():
    points = [
        kp("basic"),
        kp("adv", prereqs=["basic"]),
    ]
    tasks = [
        task("t-basic", "basic", day=1, order=1, status="completed"),
        task("t-far", "other", day=2, order=2),
        task("t-adv", "adv", day=3, order=3, priority="high"),
    ]
    points.append(kp("other"))
    study_scheduler.reprioritize_pending(tasks, points, session_days=[1, 2, 3], daily_minutes=120)
    adv = next(t for t in tasks if t["knowledgePointId"] == "adv")
    far = next(t for t in tasks if t["knowledgePointId"] == "other")
    # 前置已完成 → 高优 adv 可越过同层无关知识点 far。
    assert (adv["day"], adv["order"]) < (far["day"], far["order"])


def test_reprioritize_frozen_tasks_keep_position():
    points = [kp("a"), kp("b", prereqs=["a"])]
    tasks = [
        task("t-a-done", "a", day=3, order=5, status="completed"),
        task("t-a-now", "a", day=1, order=1, status="in-progress"),
        task("t-b", "b", day=2, order=2),
    ]
    study_scheduler.reprioritize_pending(tasks, points, session_days=[1, 2, 3], daily_minutes=180)
    frozen = next(t for t in tasks if t["id"] == "t-a-done")
    inprog = next(t for t in tasks if t["id"] == "t-a-now")
    # 冻结任务的 day 不动；order 全局重编后会变，但其"当日首位"的相对位置保持。
    assert frozen["day"] == 3
    assert inprog["day"] == 1
    # 全局 order 重编连续。
    assert sorted(t["order"] for t in tasks) == [1, 2, 3]


# ---------- find_dag_violations / enforce_dag_order ----------

def test_find_violations_detects_manual_override():
    points = [kp("basic"), kp("adv", prereqs=["basic"])]
    tasks = [
        task("t-adv", "adv", day=1, order=1),   # 被手动拉到前面
        task("t-basic", "basic", day=2, order=2),
    ]
    violations = study_scheduler.find_dag_violations(tasks, points)
    assert len(violations) == 1
    assert violations[0]["taskId"] == "t-adv"
    assert violations[0]["prerequisiteNames"] == ["basic"]


def test_enforce_dag_order_defers_violating_task():
    points = [kp("basic"), kp("adv", prereqs=["basic"])]
    tasks = [
        task("t-adv", "adv", day=1, order=1),
        task("t-basic", "basic", day=2, order=2),
    ]
    fixed, warnings = study_scheduler.enforce_dag_order(
        tasks, points, session_days=[1, 2, 3], daily_minutes=120
    )
    adv = next(t for t in fixed if t["id"] == "t-adv")
    basic = next(t for t in fixed if t["id"] == "t-basic")
    assert (adv["day"], adv["order"]) > (basic["day"], basic["order"])
    assert any("顺延" in w for w in warnings)


def test_enforce_dag_noop_without_violations():
    points = [kp("a"), kp("b", prereqs=["a"])]
    tasks = [task("t-a", "a", day=1), task("t-b", "b", day=2)]
    snapshot = copy.deepcopy(tasks)
    fixed, warnings = study_scheduler.enforce_dag_order(
        tasks, points, session_days=[1, 2], daily_minutes=120
    )
    assert warnings == []
    assert fixed == snapshot


# ---------- 集成：apply_operations_to_copy 硬校验 ----------

def test_apply_operations_rejects_dag_violation():
    from app.agents.tools import apply_operations_to_copy

    workspace = {
        "knowledgePoints": [kp("basic"), kp("adv", prereqs=["basic"])],
        "tasks": [
            task("t-basic", "basic", day=2, order=2),
            task("t-adv", "adv", day=3, order=3),
        ],
    }
    # AI 提案把前置 basic 推迟到 adv 之后（day 4）→ 依赖任务在前面，应硬失败。
    operations = [{"type": "move_task", "task_id": "t-basic", "day": 4, "order": 1}]
    try:
        apply_operations_to_copy(workspace, operations)
        raise AssertionError("应当抛出 ValueError")
    except ValueError as error:
        assert "前置依赖" in str(error)


# ---------- 集成：_sanitize_custom_workspace 走调度器 ----------

def test_sanitize_custom_workspace_schedules_by_dag():
    from app import study_service

    candidate = {
        "modules": [{"id": "m-1", "title": "模块一", "order": 1}],
        "knowledgePoints": [
            kp("basic", "基础知识", difficulty=1, mastery=30),
            kp("adv", "进阶应用", difficulty=4, prereqs=["basic"], mastery=30),
        ],
        "tasks": [
            task("t-adv", "adv", day=1, order=1, duration=60),
            task("t-basic", "basic", day=1, order=2, duration=60),
        ],
        "practiceQuestions": [],
        "mockQuestions": [],
    }
    base = {
        "course": {"id": "test-course"},
        "onboarding": {"days": 4, "reviewCount": 2, "dailyHours": 2},
    }
    workspace = study_service._sanitize_custom_workspace(candidate, base, materials=[])
    adv = next(t for t in workspace["tasks"] if t["knowledgePointId"] == "adv")
    basic = next(t for t in workspace["tasks"] if t["knowledgePointId"] == "basic")
    assert (basic["day"], basic["order"]) < (adv["day"], adv["order"])
    assert "需先完成【基础知识】" in adv["schedulingReason"]
    assert "schedulingWarnings" in workspace


def test_sanitize_custom_workspace_empty_graph_keeps_legacy_remap():
    """无依赖 candidate 走旧 _remap 路径（空图降级），行为不变。"""
    from app import study_service

    candidate = {
        "modules": [{"id": "m-1", "title": "模块一", "order": 1}],
        "knowledgePoints": [kp("a"), kp("b")],
        "tasks": [
            task("t1", "a", day=1, order=1),
            task("t2", "b", day=3, order=2),
        ],
        "practiceQuestions": [],
        "mockQuestions": [],
    }
    base = {
        "course": {"id": "test-course"},
        "onboarding": {"days": 4, "reviewCount": 2, "dailyHours": 2},
    }
    workspace = study_service._sanitize_custom_workspace(candidate, base, materials=[])
    days = sorted({t["day"] for t in workspace["tasks"]})
    # reviewCount=2, days=4 → 复习日 [1, 4]（_review_session_days: j=1 → 1+3=4）。
    assert days == [1, 4]
