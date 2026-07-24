from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from ..agent_runtime import create_agent_run, fail_agent_run, finish_agent_run, record_agent_step
from .tools import TOOL_DEFINITIONS, execute_agent_tool


ModelTurn = Callable[[list[dict[str, Any]], list[dict[str, Any]]], dict[str, Any]]


def run_tutor_agent(
    course_id: str,
    messages: list[dict[str, Any]],
    model_turn: ModelTurn,
    load_workspace: Callable[[str], dict[str, Any]],
    *,
    max_steps: int = 4,
) -> dict[str, Any]:
    run_id = create_agent_run(course_id, "tutor_chat", {"messageCount": len(messages)})
    proposal: dict[str, Any] | None = None
    sources: list[dict[str, Any]] = []
    try:
        for step_index in range(1, max_steps + 1):
            turn = model_turn(messages, TOOL_DEFINITIONS)
            tool_calls = turn.get("toolCalls", [])
            if not tool_calls:
                reply = str(turn.get("content", "")).strip()
                if not reply:
                    reply = "当前没有生成可用回答，请补充更具体的问题。"
                record_agent_step(run_id, step_index, "tutor", "completed", output_data={"reply": reply})
                finish_agent_run(run_id, {"proposalId": proposal.get("id") if proposal else ""})
                return {"reply": reply, "proposal": proposal, "sources": sources, "runId": run_id}

            messages.append(turn["assistantMessage"])
            for call in tool_calls[:2]:
                name = str(call.get("name", ""))
                arguments = call.get("arguments", {})
                try:
                    result = execute_agent_tool(
                        course_id,
                        name,
                        arguments if isinstance(arguments, dict) else {},
                        load_workspace=load_workspace,
                        source_run_id=run_id,
                    )
                    if isinstance(result.get("proposal"), dict):
                        proposal = result["proposal"]
                    if name == "search_materials" and isinstance(result.get("items"), list):
                        sources.extend(item for item in result["items"] if isinstance(item, dict))
                    record_agent_step(
                        run_id,
                        step_index,
                        f"tool:{name}",
                        "completed",
                        input_data=arguments if isinstance(arguments, dict) else {},
                        output_data={"proposalId": proposal.get("id") if proposal else "", "resultKeys": list(result)},
                    )
                    tool_content = json.dumps(result, ensure_ascii=False)
                except Exception as error:
                    record_agent_step(run_id, step_index, f"tool:{name}", "failed", error=error)
                    tool_content = json.dumps({"error": str(error)}, ensure_ascii=False)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": str(call.get("id", "")),
                        "name": name,
                        "content": tool_content[:24000],
                    }
                )
        reply = "我已完成资料和学习状态检查，但本轮达到工具执行步数上限。"
        finish_agent_run(run_id, {"proposalId": proposal.get("id") if proposal else "", "stepLimitReached": True})
        return {"reply": reply, "proposal": proposal, "sources": sources, "runId": run_id}
    except Exception as error:
        fail_agent_run(run_id, error)
        raise
