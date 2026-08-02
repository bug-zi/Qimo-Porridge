from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from ..agent_runtime import create_agent_run, fail_agent_run, finish_agent_run, record_agent_step
from .tools import TOOL_DEFINITIONS, execute_agent_tool


# Tutor Agent 单轮会话最多进行的模型步数（含工具调用步）。
# 4 步对多跳问题（查计划→找错题→关联资料→提调整）过紧，极易触发“步数上限”；
# 8 步留足余量，且仍是硬上界，防止失焦的模型无限烧 token。
MAX_TUTOR_STEPS = 8


ModelTurn = Callable[[list[dict[str, Any]], list[dict[str, Any]]], dict[str, Any]]


def run_tutor_agent(
    course_id: str,
    messages: list[dict[str, Any]],
    model_turn: ModelTurn,
    load_workspace: Callable[[str], dict[str, Any]],
    save_workspace: Callable[[dict[str, Any], str, int | None], None] | None = None,
    *,
    max_steps: int = MAX_TUTOR_STEPS,
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
            for call in tool_calls:
                name = str(call.get("name", ""))
                arguments = call.get("arguments", {})
                try:
                    result = execute_agent_tool(
                        course_id,
                        name,
                        arguments if isinstance(arguments, dict) else {},
                        load_workspace=load_workspace,
                        source_run_id=run_id,
                        save_workspace=save_workspace,
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
        # 步数用尽：不再丢 canned 文案，强制再来一轮“无工具”总结，
        # 让模型把已经检索到的资料/学习状态真正讲清楚。
        messages.append(
            {
                "role": "user",
                "content": "请根据已经检索到的资料和学习状态，直接给出结论与建议，不要再调用工具。",
            }
        )
        try:
            final_turn = model_turn(messages, [])
            reply = str(final_turn.get("content", "")).strip()
        except Exception:
            reply = ""
        if not reply:
            reply = "我已经检索了资料并核对了学习状态，但本轮思考步数较多，先在这里停下。如需继续深入，请告诉我更具体的方向。"
        finish_agent_run(run_id, {"proposalId": proposal.get("id") if proposal else "", "stepLimitReached": True})
        return {"reply": reply, "proposal": proposal, "sources": sources, "runId": run_id}
    except Exception as error:
        fail_agent_run(run_id, error)
        raise


TOOL_LABELS = {
    "search_materials": "正在检索课程资料…",
    "get_learning_state": "正在读取学习状态…",
    "propose_plan_change": "正在拟定调整提案…",
}

StreamingModelTurn = Callable[[list[dict[str, Any]], list[dict[str, Any]]], Any]


def _tool_summary(name: str, result: dict[str, Any]) -> str:
    if name == "search_materials":
        items = result.get("items")
        count = len(items) if isinstance(items, list) else 0
        return f"找到 {count} 条相关资料" if count else "未找到直接相关资料"
    if name == "get_learning_state":
        return "学习状态已读取"
    if name == "propose_plan_change":
        return "已生成待确认提案" if isinstance(result.get("proposal"), dict) else "无需调整"
    return "已完成"


def run_tutor_agent_stream(
    course_id: str,
    messages: list[dict[str, Any]],
    stream_model_turn: StreamingModelTurn,
    load_workspace: Callable[[str], dict[str, Any]],
    save_workspace: Callable[[dict[str, Any], str, int | None], None] | None = None,
    *,
    max_steps: int = MAX_TUTOR_STEPS,
):
    """流式版 tutor 循环。

    stream_model_turn(messages, tools) 是一个 generator，yield ("token", text) 增量，
    最后 yield ("turn", {content, toolCalls, assistantMessage})。
    本函数把它们重新编排为面向 SSE 的事件：
      ("step", {"step": n})
      ("token", text)
      ("tool_start", {"step", "name", "label"})
      ("tool_end", {"step", "name", "summary"})
      ("done", {"reply", "proposal", "sources", "runId"})
    """
    run_id = create_agent_run(course_id, "tutor_chat_stream", {"messageCount": len(messages)})
    proposal: dict[str, Any] | None = None
    sources: list[dict[str, Any]] = []
    # 收集本轮流式工具事件（tool_start/tool_end），随 done 回传给前端并落库进助手消息，
    # 这样对话历史里始终能看到“检索了 N 条资料 / 读取了学习状态”等行动轨迹，而不是事后只剩纯文本。
    collected_tool_events: list[dict[str, Any]] = []
    try:
        for step_index in range(1, max_steps + 1):
            yield ("step", {"step": step_index})
            content_parts: list[str] = []
            turn: dict[str, Any] | None = None
            for kind, payload in stream_model_turn(messages, TOOL_DEFINITIONS):
                if kind == "token" and isinstance(payload, str) and payload:
                    content_parts.append(payload)
                    yield ("token", payload)
                elif kind == "turn" and isinstance(payload, dict):
                    turn = payload
            if turn is None:
                reply = "".join(content_parts).strip() or "当前没有生成可用回答，请补充更具体的问题。"
                record_agent_step(run_id, step_index, "tutor", "completed", output_data={"reply": reply})
                finish_agent_run(run_id, {"proposalId": proposal.get("id") if proposal else ""})
                yield ("done", {"reply": reply, "proposal": proposal, "sources": sources, "runId": run_id, "toolEvents": collected_tool_events})
                return
            tool_calls = turn.get("toolCalls", [])
            if not tool_calls:
                reply = (str(turn.get("content", "")).strip() or "".join(content_parts).strip())
                if not reply:
                    reply = "当前没有生成可用回答，请补充更具体的问题。"
                record_agent_step(run_id, step_index, "tutor", "completed", output_data={"reply": reply})
                finish_agent_run(run_id, {"proposalId": proposal.get("id") if proposal else ""})
                yield ("done", {"reply": reply, "proposal": proposal, "sources": sources, "runId": run_id, "toolEvents": collected_tool_events})
                return

            messages.append(turn["assistantMessage"])
            for call in tool_calls:
                name = str(call.get("name", ""))
                arguments = call.get("arguments", {})
                label = TOOL_LABELS.get(name, f"正在执行 {name}…")
                tool_event: dict[str, Any] = {
                    "step": step_index,
                    "name": name,
                    "status": "running",
                    "label": label,
                    "summary": "",
                }
                collected_tool_events.append(tool_event)
                yield ("tool_start", {"step": step_index, "name": name, "label": label})
                try:
                    result = execute_agent_tool(
                        course_id,
                        name,
                        arguments if isinstance(arguments, dict) else {},
                        load_workspace=load_workspace,
                        source_run_id=run_id,
                        save_workspace=save_workspace,
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
                    summary = _tool_summary(name, result)
                except Exception as error:
                    record_agent_step(run_id, step_index, f"tool:{name}", "failed", error=error)
                    tool_content = json.dumps({"error": str(error)}, ensure_ascii=False)
                    summary = f"{name} 执行失败"
                tool_event["status"] = "done"
                tool_event["summary"] = summary
                yield ("tool_end", {"step": step_index, "name": name, "summary": summary})
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": str(call.get("id", "")),
                        "name": name,
                        "content": tool_content[:24000],
                    }
                )
        # 步数用尽：强制再来一轮“无工具”总结，边流式吐出边收尾。
        messages.append(
            {
                "role": "user",
                "content": "请根据已经检索到的资料和学习状态，直接给出结论与建议，不要再调用工具。",
            }
        )
        summary_parts: list[str] = []
        try:
            for kind, payload in stream_model_turn(messages, []):
                if kind == "token" and isinstance(payload, str) and payload:
                    summary_parts.append(payload)
                    yield ("token", payload)
        except Exception:
            pass
        reply = "".join(summary_parts).strip()
        if not reply:
            reply = "我已经检索了资料并核对了学习状态，但本轮思考步数较多，先在这里停下。如需继续深入，请告诉我更具体的方向。"
        finish_agent_run(run_id, {"proposalId": proposal.get("id") if proposal else "", "stepLimitReached": True})
        yield ("done", {"reply": reply, "proposal": proposal, "sources": sources, "runId": run_id, "toolEvents": collected_tool_events})
    except Exception as error:
        fail_agent_run(run_id, error)
        raise
