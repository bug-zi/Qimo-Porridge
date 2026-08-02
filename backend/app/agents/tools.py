from __future__ import annotations

import copy
import random
import uuid
from datetime import datetime
from typing import Any, Callable

from ..agent_runtime import create_adjustment_proposal, get_adjustment_proposal, set_proposal_status
from ..knowledge_service import learner_memory_context, retrieve_material_context


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_materials",
            "description": "检索当前课程的资料片段。需要课程事实、公式、题型或出处时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "要检索的课程问题或关键词"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 8},
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_learning_state",
            "description": "读取当前课程目标、知识点掌握度、任务、错题、笔记和长期学习记忆。",
            "parameters": {
                "type": "object",
                "properties": {
                    "focus": {"type": "string", "description": "希望聚焦的问题，可为空"},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_plan_change",
            "description": "生成等待用户确认的学习计划或学习内容调整提案。该工具不会直接修改学习空间。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "reason": {"type": "string"},
                    "impact": {"type": "string"},
                    "operations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {
                                    "type": "string",
                                    "enum": [
                                        "remove_task",
                                        "change_duration",
                                        "change_priority",
                                        "move_task",
                                        "add_worked_example",
                                    ],
                                },
                                "task_id": {"type": "string"},
                                "minutes": {"type": "integer", "minimum": 5, "maximum": 720},
                                "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                                "day": {"type": "integer", "minimum": 1, "maximum": 30},
                                "order": {"type": "integer", "minimum": 1, "maximum": 100},
                                "example": {
                                    "type": "object",
                                    "properties": {
                                        "id": {"type": "string"},
                                        "title": {"type": "string"},
                                        "origin": {"type": "string", "enum": ["material", "ai-adapted"]},
                                        "source": {"type": "string"},
                                        "problem": {"type": "string"},
                                        "analysis": {"type": "string"},
                                        "steps": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                            "minItems": 2,
                                            "maxItems": 12,
                                        },
                                        "answer": {"type": "string"},
                                        "checks": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                            "maxItems": 6,
                                        },
                                        "examPointIds": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                            "maxItems": 8,
                                        },
                                    },
                                    "required": ["title", "origin", "source", "problem", "analysis", "steps", "answer"],
                                    "additionalProperties": False,
                                },
                            },
                            "required": ["type", "task_id"],
                            "additionalProperties": False,
                        },
                        "minItems": 1,
                        "maxItems": 12,
                    },
                },
                "required": ["title", "reason", "impact", "operations"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_practice_set",
            "description": "生成一批单项选择题并直接写入当前课程的练习区（practiceQuestions），立即生效。用于用户要求“出几道题练练”“专项练习”“针对某考点出题”时。题目内容由你在调用时作为参数提供，工具负责校验、打乱选项并落库。",
            "parameters": {
                "type": "object",
                "properties": {
                    "knowledgePointId": {"type": "string", "description": "题目归属知识点 id（可选，未提供时每题需自带 knowledgePointId）"},
                    "questions": {
                        "type": "array",
                        "description": "你生成的题目，最多 5 道",
                        "items": {
                            "type": "object",
                            "properties": {
                                "prompt": {"type": "string"},
                                "options": {"type": "array", "items": {"type": "string"}, "minItems": 4, "maxItems": 5},
                                "answerIndex": {"type": "integer", "minimum": 0, "maximum": 4},
                                "explanation": {"type": "string"},
                                "knowledgePointId": {"type": "string"},
                                "score": {"type": "integer", "minimum": 1, "maximum": 20},
                            },
                            "required": ["prompt", "options", "answerIndex", "explanation"],
                            "additionalProperties": False,
                        },
                        "minItems": 1,
                        "maxItems": 5,
                    },
                },
                "required": ["questions"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "summarize_wrong_answers",
            "description": "按知识点归纳当前课程的错题，生成结构化总结并追加写入课程笔记（note），立即生效。用于用户要求“归纳错题”“总结我常错的点”“整理错题本”时。总结由你基于 get_learning_state 看到的 wrongAnswers 生成，作为参数传入。",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "Markdown 错题归纳：按知识点分组，指出常见错误类型与复习建议"},
                    "focusKnowledgePointIds": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 10,
                        "description": "本次归纳聚焦的知识点 id（可选）",
                    },
                },
                "required": ["summary"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_worked_example",
            "description": "给指定任务（章节）直接补充一道例题并写入 studyGuide，立即生效（不需确认）。用于用户要求“给这节补道例题”“再来一道例题”时。例题内容由你生成并作为参数传入。",
            "parameters": {
                "type": "object",
                "properties": {
                    "taskId": {"type": "string", "description": "目标任务 id；界面上下文提供 currentTaskId 时优先使用"},
                    "example": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "origin": {"type": "string", "enum": ["material", "ai-adapted"]},
                            "source": {"type": "string"},
                            "problem": {"type": "string"},
                            "analysis": {"type": "string"},
                            "steps": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 12},
                            "answer": {"type": "string"},
                            "checks": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
                            "examPointIds": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
                        },
                        "required": ["title", "origin", "source", "problem", "analysis", "steps", "answer"],
                        "additionalProperties": False,
                    },
                },
                "required": ["taskId", "example"],
                "additionalProperties": False,
            },
        },
    },
]


def _clean_text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _clean_string_list(value: Any, *, limit: int, item_limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        text = _clean_text(item, item_limit)
        if text:
            items.append(text)
        if len(items) >= limit:
            break
    return items


def _sanitize_worked_example(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("追加例题必须提供 example 对象")
    origin = _clean_text(value.get("origin"), 24) or "ai-adapted"
    if origin not in {"material", "ai-adapted"}:
        origin = "ai-adapted"
    example = {
        "id": _clean_text(value.get("id"), 120) or f"agent-example-{uuid.uuid4().hex[:12]}",
        "title": _clean_text(value.get("title"), 200),
        "origin": origin,
        "source": _clean_text(value.get("source"), 300),
        "problem": _clean_text(value.get("problem"), 4000),
        "analysis": _clean_text(value.get("analysis"), 4000),
        "steps": _clean_string_list(value.get("steps"), limit=12, item_limit=2000),
        "answer": _clean_text(value.get("answer"), 2000),
        "checks": _clean_string_list(value.get("checks"), limit=6, item_limit=1000),
        "examPointIds": _clean_string_list(value.get("examPointIds"), limit=8, item_limit=120),
    }
    if not example["title"] or not example["problem"] or not example["analysis"] or not example["answer"]:
        raise ValueError("追加例题缺少标题、题干、分析或答案")
    if len(example["steps"]) < 2:
        raise ValueError("追加例题至少需要 2 个解题步骤")
    return example


def _prepare_operations(operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for operation in operations:
        if not isinstance(operation, dict):
            raise ValueError("调整操作格式无效")
        next_operation = copy.deepcopy(operation)
        if str(next_operation.get("type", "")) == "add_worked_example":
            next_operation["example"] = _sanitize_worked_example(next_operation.get("example"))
        prepared.append(next_operation)
    return prepared


def _task_summary(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "totalMinutes": sum(int(task.get("duration", 0)) for task in tasks),
        "tasks": [
            {
                "id": task.get("id"),
                "title": task.get("title"),
                "day": task.get("day"),
                "order": task.get("order"),
                "duration": task.get("duration"),
                "priority": task.get("priority"),
                "workedExampleCount": len(
                    task.get("studyGuide", {}).get("workedExamples", [])
                    if isinstance(task.get("studyGuide"), dict)
                    and isinstance(task.get("studyGuide", {}).get("workedExamples"), list)
                    else []
                ),
            }
            for task in tasks
        ],
    }


def _append_worked_example(task: dict[str, Any], example: dict[str, Any]) -> None:
    guide = task.get("studyGuide")
    if not isinstance(guide, dict):
        guide = {}
        task["studyGuide"] = guide

    root_examples = guide.get("workedExamples")
    if not isinstance(root_examples, list):
        root_examples = []
        guide["workedExamples"] = root_examples
    root_examples.append(copy.deepcopy(example))

    if not isinstance(guide.get("example"), dict):
        guide["example"] = {
            "title": example["title"],
            "setup": example["problem"],
            "steps": copy.deepcopy(example["steps"]),
            "conclusion": example["answer"],
        }

    sections = guide.get("sections")
    if not isinstance(sections, list):
        return
    for section in sections:
        if not isinstance(section, dict):
            continue
        section_id = str(section.get("id", ""))
        section_label = str(section.get("label", ""))
        if section_id != "worked-example" and section_label != "例题":
            continue
        section_examples = section.get("workedExamples")
        if not isinstance(section_examples, list):
            section_examples = []
            section["workedExamples"] = section_examples
        section_examples.append(copy.deepcopy(example))
        return


def apply_operations_to_copy(workspace: dict[str, Any], operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tasks = copy.deepcopy(workspace.get("tasks", []))
    by_id = {str(task.get("id")): task for task in tasks if isinstance(task, dict)}
    should_reorder = False
    for operation in operations:
        operation_type = str(operation.get("type", ""))
        task_id = str(operation.get("task_id", ""))
        task = by_id.get(task_id)
        if task is None:
            raise ValueError(f"计划中不存在任务：{task_id}")
        if operation_type == "remove_task":
            tasks = [item for item in tasks if str(item.get("id")) != task_id]
            by_id.pop(task_id, None)
            should_reorder = True
        elif operation_type == "change_duration":
            minutes = int(operation.get("minutes", 0))
            if not 5 <= minutes <= 720:
                raise ValueError("任务时长必须为 5-720 分钟")
            task["duration"] = minutes
        elif operation_type == "change_priority":
            priority = str(operation.get("priority", ""))
            if priority not in {"high", "medium", "low"}:
                raise ValueError("任务优先级无效")
            task["priority"] = priority
        elif operation_type == "move_task":
            day = int(operation.get("day", 0))
            order = int(operation.get("order", task.get("order", 1)))
            if not 1 <= day <= 30 or order < 1:
                raise ValueError("任务日期或顺序无效")
            task["day"] = day
            task["order"] = order
            should_reorder = True
        elif operation_type == "add_worked_example":
            _append_worked_example(task, _sanitize_worked_example(operation.get("example")))
        else:
            raise ValueError(f"不支持的调整操作：{operation_type}")
    if should_reorder:
        tasks.sort(key=lambda item: (int(item.get("day", 99)), int(item.get("order", 999))))
        for index, task in enumerate(tasks, start=1):
            task["order"] = index
    return tasks


def _normalize_practice_set_items(
    raw_questions: Any,
    *,
    fallback_kp: str = "",
    limit: int = 5,
) -> list[dict[str, Any]]:
    """校验并规整模型生成的专项练习题：≥4 选项、合法 answerIndex、非空题干与解析；
    打乱选项顺序并同步 answerIndex（避免正确答案固定位置）；最多 limit 题。"""
    if not isinstance(raw_questions, list):
        return []
    normalized: list[dict[str, Any]] = []
    for question in raw_questions:
        if len(normalized) >= limit:
            break
        if not isinstance(question, dict):
            continue
        options = question.get("options")
        answer_index = question.get("answerIndex")
        if not isinstance(options, list) or len(options) < 4:
            continue
        if not isinstance(answer_index, int) or not 0 <= answer_index < len(options):
            continue
        prompt = str(question.get("prompt", "")).strip()
        explanation = str(question.get("explanation", "")).strip()
        if not prompt or not explanation:
            continue
        options_text = [str(option)[:600] for option in options[:5]]
        paired = list(enumerate(options_text))
        random.shuffle(paired)
        new_answer = next(idx for idx, (orig, _) in enumerate(paired) if orig == answer_index)
        normalized.append(
            {
                "id": f"agent-practice-{uuid.uuid4().hex[:12]}",
                "type": "single",
                "score": int(question.get("score", 5)),
                "prompt": prompt[:2000],
                "options": [text for _, text in paired],
                "answerIndex": new_answer,
                "explanation": explanation[:4000],
                "knowledgePointId": str(question.get("knowledgePointId") or fallback_kp),
                "source": str(question.get("source") or "AI Agent 专项练习"),
            }
        )
    return normalized


def execute_agent_tool(
    course_id: str,
    name: str,
    arguments: dict[str, Any],
    *,
    load_workspace: Callable[[str], dict[str, Any]],
    source_run_id: str,
    save_workspace: Callable[[dict[str, Any], str, int | None], None] | None = None,
) -> dict[str, Any]:
    # save_workspace 仅被「直接落地」类写工具（generate_practice_set /
    # summarize_wrong_answers / add_worked_example）使用；只读工具与 propose_plan_change
    # 不需要它。写工具内部会校验 save_workspace is not None。
    if name == "search_materials":
        query = str(arguments.get("query", "")).strip()
        if not query:
            raise ValueError("检索问题不能为空")
        limit = max(1, min(8, int(arguments.get("limit", 6))))
        result = retrieve_material_context(course_id, query, limit=limit)
        return {"items": result["items"], "semanticUsed": result["semanticUsed"]}

    workspace = load_workspace(course_id)
    if name == "get_learning_state":
        focus = str(arguments.get("focus", ""))
        try:
            from ..study_service import build_daily_progress  # 延迟 import，避免循环依赖
            daily_progress = build_daily_progress(workspace)
        except Exception:
            daily_progress = {}
        return {
            "revision": int(workspace.get("revision", 0)),
            "course": workspace.get("course", {}),
            "onboarding": workspace.get("onboarding", {}),
            "diagnostic": workspace.get("diagnostic", {}),
            "knowledgePoints": workspace.get("knowledgePoints", []),
            "tasks": workspace.get("tasks", []),
            "wrongAnswers": workspace.get("wrongAnswers", []),
            "note": workspace.get("note", ""),
            "memories": learner_memory_context(course_id, focus, limit=6),
            "dailyProgress": daily_progress,
        }
    if name == "propose_plan_change":
        operations = arguments.get("operations")
        if not isinstance(operations, list) or not operations:
            raise ValueError("调整提案必须包含操作")
        operations = _prepare_operations(operations)
        before_tasks = copy.deepcopy(workspace.get("tasks", []))
        after_tasks = apply_operations_to_copy(workspace, operations)
        proposal = create_adjustment_proposal(
            course_id,
            base_revision=int(workspace.get("planRevision", 0)),
            title=str(arguments.get("title", "调整复习计划")).strip()[:200],
            reason=str(arguments.get("reason", "")).strip()[:2000],
            impact=str(arguments.get("impact", "")).strip()[:2000],
            operations=operations,
            before=_task_summary(before_tasks),
            after=_task_summary(after_tasks),
            source_run_id=source_run_id,
        )
        return {"proposal": proposal, "message": "提案已创建，等待用户确认；学习空间尚未修改。"}
    if name == "generate_practice_set":
        if save_workspace is None:
            raise RuntimeError("该工具需要写入权限，但未提供 save_workspace")
        items = _normalize_practice_set_items(
            arguments.get("questions"),
            fallback_kp=str(arguments.get("knowledgePointId", "")),
        )
        if not items:
            raise ValueError("生成的练习题未通过校验：每题需 ≥4 个选项、合法 answerIndex、非空题干与解析")
        current_revision = int(workspace.get("revision", 0))
        practice_questions = workspace.get("practiceQuestions")
        if not isinstance(practice_questions, list):
            practice_questions = []
            workspace["practiceQuestions"] = practice_questions
        existing_prompts = {
            str(question.get("prompt"))
            for question in practice_questions
            if isinstance(question, dict)
        }
        added = 0
        for item in items:
            if item["prompt"] in existing_prompts:
                continue
            practice_questions.append(item)
            existing_prompts.add(item["prompt"])
            added += 1
        save_workspace(workspace, course_id, current_revision)
        return {
            "added": added,
            "total": len(practice_questions),
            "message": f"已新增 {added} 道练习题到练习区（现有 {len(practice_questions)} 道）。",
        }
    if name == "summarize_wrong_answers":
        if save_workspace is None:
            raise RuntimeError("该工具需要写入权限，但未提供 save_workspace")
        summary = str(arguments.get("summary", "")).strip()
        if not summary:
            raise ValueError("错题归纳总结不能为空")
        current_revision = int(workspace.get("revision", 0))
        header = f"\n\n## 错题归纳（{datetime.now().strftime('%Y-%m-%d %H:%M')}）\n\n"
        workspace["note"] = (str(workspace.get("note") or "").strip() + header + summary[:8000]).strip()
        save_workspace(workspace, course_id, current_revision)
        return {"message": "已将错题归纳追加到课程笔记。"}
    if name == "add_worked_example":
        if save_workspace is None:
            raise RuntimeError("该工具需要写入权限，但未提供 save_workspace")
        task_id = str(arguments.get("taskId", "")).strip()
        if not task_id:
            raise ValueError("必须指定 taskId 来定位要补充例题的任务")
        example = _sanitize_worked_example(arguments.get("example"))
        task = next(
            (
                item
                for item in workspace.get("tasks", [])
                if isinstance(item, dict) and str(item.get("id")) == task_id
            ),
            None,
        )
        if task is None:
            raise ValueError(f"未找到任务：{task_id}")
        current_revision = int(workspace.get("revision", 0))
        _append_worked_example(task, example)
        save_workspace(workspace, course_id, current_revision)
        return {
            "taskId": task_id,
            "exampleId": example["id"],
            "message": f"已为「{task.get('title', task_id)}」补充例题：{example['title']}",
        }
    raise ValueError(f"未注册 Agent 工具：{name}")


def apply_proposal(
    course_id: str,
    proposal_id: str,
    *,
    load_workspace: Callable[[str], dict[str, Any]],
    save_workspace: Callable[[dict[str, Any], str, int | None], None],
) -> tuple[dict[str, Any], dict[str, Any]]:
    proposal = get_adjustment_proposal(course_id, proposal_id)
    if proposal["status"] != "pending":
        raise RuntimeError("提案已处理")
    workspace = load_workspace(course_id)
    current_revision = int(workspace.get("revision", 0))
    if int(workspace.get("planRevision", 0)) != proposal["baseRevision"]:
        raise RuntimeError("学习计划已发生变化，请重新生成调整提案")
    workspace["tasks"] = apply_operations_to_copy(workspace, proposal["operations"])
    save_workspace(workspace, course_id, current_revision)
    set_proposal_status(course_id, proposal_id, "applied")
    return workspace, get_adjustment_proposal(course_id, proposal_id)


def dismiss_proposal(course_id: str, proposal_id: str) -> dict[str, Any]:
    proposal = get_adjustment_proposal(course_id, proposal_id)
    if proposal["status"] != "pending":
        raise RuntimeError("提案已处理")
    set_proposal_status(course_id, proposal_id, "dismissed")
    return get_adjustment_proposal(course_id, proposal_id)
