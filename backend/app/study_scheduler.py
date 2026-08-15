"""知识点前置依赖 DAG + 确定性复习调度器。

借鉴图原生知识基础设施的思路：LLM 只负责抽取知识点之间的学习先后依赖
（prerequisites）与难度（difficulty），复习任务的顺序完全由本模块的
确定性图算法计算（拓扑排序 + 按日装包 + DAG 约束内动态重排），
保证"循序渐进、从简单到难"，不依赖模型当次的排序自觉。

全部函数为纯函数（无 IO、仅标准库），操作 workspace 中的原生 dict 结构。
"""

from __future__ import annotations

# 思维导图上前置依赖边的 label（generate_mind_map / CourseMindMapView 共用）。
PREREQUISITE_EDGE_LABEL = "前置"
# 无任务知识点判定"已完成"的掌握度阈值（与思维导图"薄弱<60"口径同源）。
KP_MASTERY_DONE_THRESHOLD = 60
FROZEN_STATUSES = ("completed", "in-progress")


def _as_int(value: object, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return int(value)
    return default


def has_dependencies(points: list[dict]) -> bool:
    """是否存在任何结构化前置依赖（决定调度器是否接管排序）。"""
    return any(
        isinstance(point.get("prerequisites"), list) and point["prerequisites"]
        for point in points
        if isinstance(point, dict)
    )


def sanitize_dependencies(points: list[dict]) -> list[str]:
    """原地清洗 knowledgePoints 的依赖字段，返回人读 warnings。

    1) prerequisites：非 list 置 []；逐项 str().strip()；剔除空/自指/未知 id；去重保序。
    2) difficulty：非数字默认 3；round 后钳制 1-5。
    3) 环检测 + 断边：迭代式三色 DFS 找环，对每个环删除
       (target.weight 最低, tie: target.id 字典序) 的那条边，重复直至无环。
    """
    warnings: list[str] = []
    point_ids = {
        str(point.get("id", "")) for point in points if isinstance(point, dict)
    }

    for point in points:
        if not isinstance(point, dict):
            continue
        point_id = str(point.get("id", ""))

        raw_prereqs = point.get("prerequisites")
        if not isinstance(raw_prereqs, list):
            point["prerequisites"] = []
            raw_prereqs = []
        cleaned: list[str] = []
        for item in raw_prereqs:
            prereq = str(item).strip()
            if not prereq or prereq == point_id or prereq not in point_ids:
                continue
            if prereq not in cleaned:
                cleaned.append(prereq)
        point["prerequisites"] = cleaned

        point["difficulty"] = min(5, max(1, _as_int(point.get("difficulty"), 3)))

    # 断环：每轮找一个环，删掉环上 (target weight 最低, id 字典序) 的边。
    edges_removed = 0
    while True:
        cycle = _find_cycle(points)
        if cycle is None:
            break
        # cycle 形如 [a, b, c]，边为 a→b→c→a。target 即"依赖方"。
        edge_targets = list(cycle) + [cycle[0]]
        point_by_id = {str(p.get("id", "")): p for p in points if isinstance(p, dict)}
        source, target = min(
            zip(cycle, edge_targets[1:]),
            key=lambda pair: (
                _as_int(point_by_id.get(pair[1], {}).get("weight"), 0),
                str(pair[1]),
            ),
        )
        target_point = point_by_id.get(target)
        if target_point is None:
            break
        prereqs = target_point.get("prerequisites")
        if isinstance(prereqs, list) and source in prereqs:
            prereqs.remove(source)
        edge_targets_text = f"{_point_name(point_by_id.get(source))}→{_point_name(target_point)}"
        warnings.append(f"知识点依赖存在环，已忽略 {edge_targets_text}")
        edges_removed += 1
        if edges_removed > len(points) * len(points) + len(points):
            break

    return warnings


def _point_name(point: dict | None) -> str:
    if not isinstance(point, dict):
        return "未知知识点"
    return str(point.get("name") or point.get("id") or "未知知识点")


def _find_cycle(points: list[dict]) -> list[str] | None:
    """迭代式三色 DFS，沿 prereq→dependent 方向找环，返回环上的 id 序列。

    图方向：prerequisites 里的 P 是 X 的前置，即存在边 P→X（P 先学）。
    """
    prereq_map = {
        str(point.get("id", "")): list(point.get("prerequisites") or [])
        for point in points
        if isinstance(point, dict)
    }
    # 反转邻接：dependent_map[P] = [X, ...]（P→X）
    dependent_map: dict[str, list[str]] = {pid: [] for pid in prereq_map}
    for pid, prereqs in prereq_map.items():
        for prereq in prereqs:
            if prereq in dependent_map:
                dependent_map[prereq].append(pid)

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {pid: WHITE for pid in dependent_map}
    parent: dict[str, str | None] = {pid: None for pid in dependent_map}

    for start in dependent_map:
        if color[start] != WHITE:
            continue
        stack: list[tuple[str, int]] = [(start, 0)]
        color[start] = GRAY
        while stack:
            node, next_index = stack[-1]
            neighbors = dependent_map.get(node, [])
            if next_index < len(neighbors):
                stack[-1] = (node, next_index + 1)
                neighbor = neighbors[next_index]
                if color.get(neighbor) == GRAY:
                    # 找到环：沿 parent 回溯 neighbor → node。
                    cycle = [node]
                    cursor = node
                    while cursor != neighbor:
                        cursor = parent[cursor]  # type: ignore[assignment]
                        if cursor is None:
                            break
                        cycle.append(cursor)
                    cycle.reverse()
                    return cycle
                if color.get(neighbor) == WHITE:
                    color[neighbor] = GRAY
                    parent[neighbor] = node
                    stack.append((neighbor, 0))
            else:
                color[node] = BLACK
                stack.pop()
    return None


def topological_rank(points: list[dict], modules: list[dict] | None = None) -> dict[str, int]:
    """kp_id → 全局拓扑序号 0..N-1。

    layer(X) = 1 + max(layer(P) for P in prerequisites(X))（记忆化 DFS，入参应已无环）。
    层内排序键 (difficulty 升序, weight 降序, mastery 升序, module.order, 原始下标)。
    """
    point_by_id = {
        str(point.get("id", "")): point
        for point in points
        if isinstance(point, dict)
    }
    module_order = {
        str(module.get("id", "")): _as_int(module.get("order"), 0)
        for module in (modules or [])
        if isinstance(module, dict)
    }

    index_by_id = {
        str(point.get("id", "")): index
        for index, point in enumerate(points)
        if isinstance(point, dict)
    }

    layer_cache: dict[str, int] = {}

    def layer_of(pid: str, visiting: set[str]) -> int:
        if pid in layer_cache:
            return layer_cache[pid]
        if pid in visiting:  # 防御：有环时按 0 层处理，不再递归
            return 0
        point = point_by_id.get(pid)
        if point is None:
            return 0
        prereqs = point.get("prerequisites") or []
        layer = 1
        for prereq in prereqs:
            if prereq in point_by_id:
                layer = max(layer, layer_of(prereq, visiting | {pid}) + 1)
        layer_cache[pid] = layer
        return layer

    def in_layer_key(pid: str) -> tuple:
        point = point_by_id.get(pid, {})
        return (
            _as_int(point.get("difficulty"), 3),
            -_as_int(point.get("weight"), 0),
            _as_int(point.get("mastery"), 0),
            module_order.get(str(point.get("moduleId") or ""), 9999),
            index_by_id.get(pid, 9999),
        )

    layers: dict[int, list[str]] = {}
    for pid in point_by_id:
        layers.setdefault(layer_of(pid, set()), []).append(pid)
    ordered_ids: list[str] = []
    for layer in sorted(layers):
        ordered_ids.extend(sorted(layers[layer], key=in_layer_key))
    return {pid: rank for rank, pid in enumerate(ordered_ids)}


def kp_completion_map(tasks: list[dict], points: list[dict]) -> dict[str, bool]:
    """知识点"已完成"判定：有任务 → 所有任务 completed；无任务 → mastery >= 60。"""
    tasks_by_kp: dict[str, list[dict]] = {}
    for task in tasks:
        if not isinstance(task, dict):
            continue
        kp_id = str(task.get("knowledgePointId") or "")
        if kp_id:
            tasks_by_kp.setdefault(kp_id, []).append(task)

    completion: dict[str, bool] = {}
    for point in points:
        if not isinstance(point, dict):
            continue
        kp_id = str(point.get("id", ""))
        kp_tasks = tasks_by_kp.get(kp_id)
        if kp_tasks:
            completion[kp_id] = all(
                str(task.get("status")) == "completed" for task in kp_tasks
            )
        else:
            completion[kp_id] = (
                _as_int(point.get("mastery"), 0) >= KP_MASTERY_DONE_THRESHOLD
            )
    return completion


def _tasks_by_kp_in_order(tasks: list[dict], kp_order: dict[str, int]) -> list[dict]:
    """按知识点拓扑序拉平任务；kp 组内按 (order, 原下标)；无归属任务按原序追加末尾。"""
    indexed = list(enumerate(tasks))
    grouped: dict[str, list[tuple[int, dict]]] = {}
    unassigned: list[tuple[int, dict]] = []
    for index, task in indexed:
        if not isinstance(task, dict):
            continue
        kp_id = str(task.get("knowledgePointId") or "")
        if kp_id in kp_order:
            grouped.setdefault(kp_id, []).append((index, task))
        else:
            unassigned.append((index, task))

    flattened: list[dict] = []
    for kp_id in sorted(kp_order, key=lambda pid: kp_order[pid]):
        for _, task in sorted(
            grouped.get(kp_id, []),
            key=lambda pair: (_as_int(pair[1].get("order"), pair[0] + 1), pair[0]),
        ):
            flattened.append(task)
    flattened.extend(task for _, task in unassigned)
    return flattened


def _format_scheduling_reason(
    point: dict | None, prereq_names: list[str]
) -> str:
    parts: list[str] = []
    if prereq_names:
        parts.append(f"需先完成【{'、'.join(prereq_names)}】")
    if point is not None:
        parts.append(f"难度 {_as_int(point.get('difficulty'), 3)}/5")
        parts.append(f"权重 {_as_int(point.get('weight'), 0)}")
    else:
        parts.append("按原始顺序补排")
    return "；".join(parts)


def schedule_tasks(
    tasks: list[dict],
    points: list[dict],
    *,
    session_days: list[int],
    daily_minutes: int,
    modules: list[dict] | None = None,
) -> list[str]:
    """生成时确定性调度：按拓扑序拉平任务并装包到复习日，写 day/order/schedulingReason。

    - session_days：复习日序列（可能稀疏，如 [1,4,7,10]），作为箱子序列。
    - 每箱容量 daily_minutes；任务放入第一个剩余容量足够的箱子；无箱可放 → 末日 + warning。
    """
    warnings: list[str] = []
    if not session_days:
        session_days = [1]
    daily_minutes = max(30, int(daily_minutes or 0) or 120)

    point_by_id = {
        str(point.get("id", "")): point
        for point in points
        if isinstance(point, dict)
    }
    kp_order = topological_rank(points, modules)

    remaining_capacity = {day: daily_minutes for day in session_days}
    placed: dict[int, list[dict]] = {day: [] for day in session_days}

    for task in _tasks_by_kp_in_order(tasks, kp_order):
        duration = max(5, _as_int(task.get("duration"), 60))
        target_day = next(
            (
                day
                for day in session_days
                if remaining_capacity[day] >= duration
            ),
            None,
        )
        if target_day is None:
            target_day = session_days[-1]
            warnings.append(
                f"任务「{str(task.get('title') or task.get('id'))}」超出每日复习时长，已并入第 {target_day} 天"
            )
        placed[target_day].append(task)
        remaining_capacity[target_day] -= duration
        task["day"] = target_day

        kp_id = str(task.get("knowledgePointId") or "")
        point = point_by_id.get(kp_id)
        prereq_names = []
        if point is not None:
            prereq_names = [
                _point_name(point_by_id.get(prereq))
                for prereq in (point.get("prerequisites") or [])
                if prereq in point_by_id
            ]
        task["schedulingReason"] = _format_scheduling_reason(point, prereq_names)

    order_index = 1
    sorted_tasks: list[dict] = []
    for day in sorted(placed):
        for task in placed[day]:
            task["order"] = order_index
            order_index += 1
            sorted_tasks.append(task)
    tasks[:] = sorted_tasks
    return warnings


def _legacy_sort(tasks: list[dict], points: list[dict]) -> None:
    """空图降级：精确复刻旧的 (day, mastery[kp], -weight) 排序 + 全局重编 order。"""
    order_by_point = {
        str(point.get("id", "")): _as_int(point.get("mastery"), 0)
        for point in points
        if isinstance(point, dict)
    }
    tasks.sort(
        key=lambda task: (
            _as_int(task.get("day"), 9),
            order_by_point.get(str(task.get("knowledgePointId")), 100),
            -_as_int(task.get("weight"), 0),
        )
    )
    for index, task in enumerate(tasks, start=1):
        task["order"] = index


def reprioritize_pending(
    tasks: list[dict],
    points: list[dict],
    *,
    session_days: list[int],
    daily_minutes: int,
    modules: list[dict] | None = None,
) -> list[str]:
    """做题失分后的动态重排（DAG 约束内）。

    空图 → 旧排序键降级（行为与改造前逐字段一致）。
    DAG 模式：就绪集 Kahn 贪心——每轮从"前置均已完成"的就绪知识点中按
    (有 high 任务优先, difficulty 升序, weight 降序, 拓扑序) 挑一个放置；
    失分知识点（priority 已被置 high）在其直接前置放置后立刻插队，
    可越过同层无关知识点，但绝不超过任何未完成前置。
    completed/in-progress 任务的 (day, order) 冻结不动。
    """
    if not has_dependencies(points):
        _legacy_sort(tasks, points)
        return []

    warnings: list[str] = []
    if not session_days:
        session_days = [1]
    daily_minutes = max(30, int(daily_minutes or 0) or 120)

    point_by_id = {
        str(point.get("id", "")): point
        for point in points
        if isinstance(point, dict)
    }
    kp_order = topological_rank(points, modules)
    done = kp_completion_map(tasks, points)

    frozen = [
        task
        for task in tasks
        if isinstance(task, dict) and str(task.get("status")) in FROZEN_STATUSES
    ]
    pending = [
        task
        for task in tasks
        if isinstance(task, dict) and str(task.get("status")) not in FROZEN_STATUSES
    ]

    pending_by_kp: dict[str, list[dict]] = {}
    unassigned: list[dict] = []
    for task in pending:
        kp_id = str(task.get("knowledgePointId") or "")
        if kp_id in point_by_id:
            pending_by_kp.setdefault(kp_id, []).append(task)
        else:
            unassigned.append(task)

    # 冻结任务先占容量、并确定各知识点的 gate_day（未完成前置的最迟已放置日）。
    remaining_capacity: dict[int, int] = {day: daily_minutes for day in session_days}
    for task in frozen:
        day = _as_int(task.get("day"), session_days[0])
        if day in remaining_capacity:
            remaining_capacity[day] -= max(5, _as_int(task.get("duration"), 60))

    placed_days: dict[str, int] = {}

    placed: dict[int, list[dict]] = {day: [] for day in session_days}
    frozen_by_day: dict[int, list[dict]] = {}
    for task in frozen:
        frozen_by_day.setdefault(_as_int(task.get("day"), session_days[0]), []).append(task)

    remaining_kps = [kp_id for kp_id in kp_order if pending_by_kp.get(kp_id)]
    while remaining_kps:
        ready = [
            kp_id
            for kp_id in remaining_kps
            if all(
                done.get(prereq, True)
                for prereq in (point_by_id[kp_id].get("prerequisites") or [])
            )
        ]
        if not ready:
            # 理论不可达（sanitize 已断环）；防御性全部放开避免死循环。
            ready = list(remaining_kps)

        def kp_pick_key(kp_id: str) -> tuple:
            kp_tasks = pending_by_kp[kp_id]
            has_high = any(str(t.get("priority")) == "high" for t in kp_tasks)
            point = point_by_id[kp_id]
            return (
                0 if has_high else 1,
                _as_int(point.get("difficulty"), 3),
                -_as_int(point.get("weight"), 0),
                kp_order.get(kp_id, 9999),
            )

        chosen = min(ready, key=kp_pick_key)
        remaining_kps.remove(chosen)

        # gate_day：该知识点未完成前置的已放置任务最大 day。
        gate_day = 1
        for prereq in point_by_id[chosen].get("prerequisites") or []:
            if done.get(prereq, True):
                continue
            for task in pending_by_kp.get(prereq, []):
                gate_day = max(gate_day, _as_int(task.get("day"), 1))
        # 前置若已在早前轮次放置，取其放置日。
        for prereq in point_by_id[chosen].get("prerequisites") or []:
            if prereq in placed_days and prereq in done:
                gate_day = max(gate_day, placed_days[prereq])

        kp_tasks = sorted(
            pending_by_kp[chosen],
            key=lambda t: (_as_int(t.get("order"), 9999), str(t.get("id"))),
        )
        for task in kp_tasks:
            duration = max(5, _as_int(task.get("duration"), 60))
            target_day = next(
                (
                    day
                    for day in session_days
                    if day >= gate_day and remaining_capacity[day] >= duration
                ),
                None,
            )
            if target_day is None:
                target_day = next(
                    (day for day in session_days if day >= gate_day),
                    session_days[-1],
                )
                warnings.append(
                    f"任务「{str(task.get('title') or task.get('id'))}」超出每日复习时长，已并入第 {target_day} 天"
                )
            placed[target_day].append(task)
            remaining_capacity[target_day] -= duration
            task["day"] = target_day
            task["schedulingReason"] = _format_scheduling_reason(
                point_by_id.get(chosen),
                [
                    _point_name(point_by_id.get(prereq))
                    for prereq in (point_by_id[chosen].get("prerequisites") or [])
                    if prereq in point_by_id
                ],
            )
        placed_days[chosen] = max(
            (_as_int(t.get("day"), 1) for t in kp_tasks), default=gate_day
        )
        done[chosen] = True

    # 无知识点归属的 pending 任务按原 (day, order) 追加到各日末尾。
    for task in unassigned:
        day = _as_int(task.get("day"), session_days[0])
        if day not in placed:
            day = session_days[-1]
        placed[day].append(task)

    # 每日最终序列 = frozen（原 order 序）++ 新放 pending；全局重编 order。
    order_index = 1
    sorted_tasks: list[dict] = []
    for day in sorted(placed):
        day_frozen = sorted(
            frozen_by_day.get(day, []),
            key=lambda t: _as_int(t.get("order"), 9999),
        )
        for task in day_frozen + placed[day]:
            task["order"] = order_index
            order_index += 1
            sorted_tasks.append(task)
    tasks[:] = sorted_tasks
    return warnings


def find_dag_violations(tasks: list[dict], points: list[dict]) -> list[dict]:
    """检出 pending 任务排到未完成前置之前的违规。"""
    if not has_dependencies(points):
        return []
    point_by_id = {
        str(point.get("id", "")): point
        for point in points
        if isinstance(point, dict)
    }
    done = kp_completion_map(tasks, points)

    violations: list[dict] = []
    for task in tasks:
        if not isinstance(task, dict) or str(task.get("status")) in FROZEN_STATUSES:
            continue
        kp_id = str(task.get("knowledgePointId") or "")
        point = point_by_id.get(kp_id)
        if point is None:
            continue
        pending_prereqs = [
            prereq
            for prereq in (point.get("prerequisites") or [])
            if prereq in point_by_id and not done.get(prereq, True)
        ]
        if not pending_prereqs:
            continue
        task_position = (_as_int(task.get("day"), 9), _as_int(task.get("order"), 9999))
        blocking_names = []
        violated = False
        for prereq in pending_prereqs:
            for other in tasks:
                if not isinstance(other, dict) or str(other.get("knowledgePointId") or "") != prereq:
                    continue
                other_position = (
                    _as_int(other.get("day"), 9),
                    _as_int(other.get("order"), 9999),
                )
                if other_position > task_position:
                    violated = True
                    blocking_names.append(_point_name(point_by_id.get(prereq)))
                    break
        if violated:
            violations.append(
                {
                    "taskId": str(task.get("id")),
                    "taskTitle": str(task.get("title") or task.get("id")),
                    "prerequisiteNames": blocking_names,
                    "currentDay": _as_int(task.get("day"), 1),
                }
            )
    return violations


def enforce_dag_order(
    tasks: list[dict],
    points: list[dict],
    *,
    session_days: list[int],
    daily_minutes: int,
) -> tuple[list[dict], list[str]]:
    """手动调整后的修复：违规 pending 任务顺延到 gate_day 起最近的有容量复习日。

    completed/in-progress 不动。无违规时原样返回（warnings 为空）。
    """
    if not has_dependencies(points):
        return tasks, []
    violations = find_dag_violations(tasks, points)
    if not violations:
        return tasks, []

    warnings: list[str] = []
    point_by_id = {
        str(point.get("id", "")): point
        for point in points
        if isinstance(point, dict)
    }
    done = kp_completion_map(tasks, points)
    if not session_days:
        session_days = [1]
    daily_minutes = max(30, int(daily_minutes or 0) or 120)

    remaining_capacity: dict[int, int] = {day: daily_minutes for day in session_days}
    for task in tasks:
        if isinstance(task, dict) and _as_int(task.get("day"), 0) in remaining_capacity:
            remaining_capacity[_as_int(task.get("day"), 0)] -= max(
                5, _as_int(task.get("duration"), 60)
            )

    moved_ids = set()
    for violation in violations:
        task = next(
            (
                t
                for t in tasks
                if isinstance(t, dict) and str(t.get("id")) == violation["taskId"]
            ),
            None,
        )
        if task is None:
            continue
        kp_id = str(task.get("knowledgePointId") or "")
        point = point_by_id.get(kp_id)
        if point is None:
            continue
        gate_day = 1
        for prereq in point.get("prerequisites") or []:
            if done.get(prereq, True):
                continue
            for other in tasks:
                if isinstance(other, dict) and str(other.get("knowledgePointId") or "") == prereq:
                    gate_day = max(gate_day, _as_int(other.get("day"), 1))
        duration = max(5, _as_int(task.get("duration"), 60))
        target_day = next(
            (
                day
                for day in session_days
                if day >= gate_day and remaining_capacity[day] >= duration
            ),
            None,
        )
        if target_day is None:
            target_day = next(
                (day for day in session_days if day >= gate_day), session_days[-1]
            )
            warnings.append(
                f"任务「{str(task.get('title') or task.get('id'))}」超出每日复习时长，已并入第 {target_day} 天"
            )
        moved_ids.add(str(task.get("id")))
        task["day"] = target_day
        task["schedulingReason"] = _format_scheduling_reason(
            point,
            [
                _point_name(point_by_id.get(prereq))
                for prereq in (point.get("prerequisites") or [])
                if prereq in point_by_id
            ],
        )
        warnings.append(
            f"任务「{str(task.get('title') or task.get('id'))}」已顺延至第 {target_day} 天：需先完成【{'、'.join(violation['prerequisiteNames'])}】"
        )

    tasks.sort(
        key=lambda task: (
            _as_int(task.get("day"), 9),
            1 if str(task.get("id")) in moved_ids else 0,
            _as_int(task.get("order"), 9999),
        )
    )
    for index, task in enumerate(tasks, start=1):
        task["order"] = index
    return tasks, warnings
