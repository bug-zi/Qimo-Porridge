from __future__ import annotations

import copy
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
            "description": "生成等待用户确认的计划调整提案。该工具不会直接修改计划。",
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
                                    "enum": ["remove_task", "change_duration", "change_priority", "move_task"],
                                },
                                "task_id": {"type": "string"},
                                "minutes": {"type": "integer", "minimum": 5, "maximum": 720},
                                "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                                "day": {"type": "integer", "minimum": 1, "maximum": 30},
                                "order": {"type": "integer", "minimum": 1, "maximum": 100},
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
]


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
            }
            for task in tasks
        ],
    }


def apply_operations_to_copy(workspace: dict[str, Any], operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tasks = copy.deepcopy(workspace.get("tasks", []))
    by_id = {str(task.get("id")): task for task in tasks if isinstance(task, dict)}
    for operation in operations:
        operation_type = str(operation.get("type", ""))
        task_id = str(operation.get("task_id", ""))
        task = by_id.get(task_id)
        if task is None:
            raise ValueError(f"计划中不存在任务：{task_id}")
        if operation_type == "remove_task":
            tasks = [item for item in tasks if str(item.get("id")) != task_id]
            by_id.pop(task_id, None)
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
        else:
            raise ValueError(f"不支持的调整操作：{operation_type}")
    tasks.sort(key=lambda item: (int(item.get("day", 99)), int(item.get("order", 999))))
    for index, task in enumerate(tasks, start=1):
        task["order"] = index
    return tasks


def execute_agent_tool(
    course_id: str,
    name: str,
    arguments: dict[str, Any],
    *,
    load_workspace: Callable[[str], dict[str, Any]],
    source_run_id: str,
) -> dict[str, Any]:
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
        }
    if name == "propose_plan_change":
        operations = arguments.get("operations")
        if not isinstance(operations, list) or not operations:
            raise ValueError("调整提案必须包含操作")
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
        return {"proposal": proposal, "message": "提案已创建，等待用户确认；计划尚未修改。"}
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
