"""导出演示站数据快照。

用法（先启动本地后端 uvicorn app.main:app --port 8000）：

    cd backend
    python scripts/export_demo_snapshot.py [--base-url http://127.0.0.1:8000] [--out ../web/src/demo/snapshot.json]

从只读端点拉取全部演示数据，清洗敏感信息后写入 web/public/demo/snapshot.json，
供前端 demo 模式运行时 fetch。清洗规则见 _sanitize_* 函数。
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

# 预览 kind 为 image / pdf 的材料不进快照（demo 站无法提供二进制文件，
# 前端会拼出指向本地后端的 iframe/img URL 导致白屏，见 ModuleView.tsx 消费点）。
SAFE_PREVIEW_KINDS = {"text", "sheet", "unsupported"}

DEMO_BASE_URL = "https://api.example.com/v1"
DEMO_AVAILABLE_MODELS = ["gpt-5.4", "deepseek-v4", "glm-5.1"]

DEMO_USER_PROFILE = (
    "偏好简洁直击要点的讲解，例题优先；薄弱点集中在证明题与综合应用，"
    "希望多安排错题复练；每天晚间学习效率最高。"
)


def api_get(base_url: str, path: str) -> object:
    request = Request(f"{base_url}{path}", headers={"Accept": "application/json"})
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def encode_material_path(relative_path: str) -> str:
    return "/".join(quote(part) for part in relative_path.split("/"))


def sanitize_runtime_model(payload: dict) -> dict:
    payload["baseUrl"] = DEMO_BASE_URL
    payload["connected"] = True
    payload["hasApiKey"] = True
    payload["availableModels"] = DEMO_AVAILABLE_MODELS
    return payload


def sanitize_mcp_servers(payload: object) -> list:
    # 端点直接返回数组。仅保留 stdio + npx/uvx 启动的预设服务（包名形式，无本机路径）
    servers = payload if isinstance(payload, list) else (payload.get("servers") or [])
    safe_servers = []
    for server in servers:
        if server.get("transport") != "stdio":
            # http 传输的 endpoint query 可能携带 token，一并剔除
            continue
        if (server.get("command") or "").strip() not in {"npx", "uvx"}:
            continue
        safe_servers.append(server)
    return safe_servers


def sanitize_user_profile(payload: dict) -> dict:
    payload["content"] = DEMO_USER_PROFILE
    return payload


def sanitize_archive(payload: object, now: datetime) -> list:
    # 端点直接返回 ArchiveItem 数组（main.py:1787）
    items = payload if isinstance(payload, list) else (payload.get("items") or [])
    for item in items:
        deleted_at = _parse_datetime(item.get("deletedAt")) or now - timedelta(hours=2)
        purge_after = deleted_at + timedelta(days=7)
        item["deletedAt"] = _format_datetime(deleted_at)
        item["purgeAfter"] = _format_datetime(purge_after)
    return items


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _format_datetime(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def sanitize_workspace(workspace: dict, now: datetime) -> dict:
    # 只保留纯文本可预览材料；pdf/image 走不到 demo 的预览分支
    materials = workspace.get("materials") or []
    workspace["materials"] = [m for m in materials if m.get("previewStatus") in {"ready", "converted", "limited"}]
    # onboarding 阶段拉到 planned，避免演示站一打开就掉进 setup 向导
    onboarding = workspace.get("onboarding")
    if isinstance(onboarding, dict):
        onboarding["status"] = "planned"
    return workspace


def strip_materials_without_preview(workspace: dict, preview_map: dict[str, dict]) -> None:
    keep: list[dict] = []
    for material in workspace.get("materials") or []:
        preview = preview_map.get(material.get("relativePath"))
        if preview is None:
            continue
        if preview.get("kind") not in SAFE_PREVIEW_KINDS:
            continue
        keep.append(material)
    workspace["materials"] = keep


def main() -> int:
    parser = argparse.ArgumentParser(description="导出演示站数据快照")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--out", default=None, help="输出 JSON 路径，默认 web/public/demo/snapshot.json")
    args = parser.parse_args()

    out_path = Path(args.out) if args.out else Path(__file__).resolve().parents[2] / "web" / "public" / "demo" / "snapshot.json"
    base_url = args.base_url.rstrip("/")

    now = datetime.now(timezone.utc)

    print(f"[export] base_url={base_url}")
    courses = api_get(base_url, "/api/courses")
    if not courses:
        print("[export] 没有任何课程，先在本地后端创建演示课程再导出。", file=sys.stderr)
        return 1

    snapshot: dict = {
        "exportedAt": _format_datetime(now),
        "courses": courses,
        "workspaces": {},
        "mindMaps": {},
        "strategyDocuments": {},
        "knowledgeStatus": {},
        "materialPreviews": {},
        "archive": {},
        "runtimeModel": {},
        "userProfile": {},
        "embeddingProfile": {},
        "mcpServers": {},
    }

    total_previews = 0
    for course in courses:
        course_id = course["id"]
        print(f"[export] course {course_id}")

        workspace = api_get(base_url, f"/api/courses/{course_id}/workspace")
        sanitize_workspace(workspace, now)
        snapshot["workspaces"][course_id] = workspace

        mind_map = api_get(base_url, f"/api/courses/{course_id}/mind-map")
        snapshot["mindMaps"][course_id] = mind_map

        strategy = api_get(base_url, f"/api/courses/{course_id}/strategy-documents")
        snapshot["strategyDocuments"][course_id] = strategy

        knowledge = api_get(base_url, f"/api/courses/{course_id}/knowledge/status")
        snapshot["knowledgeStatus"][course_id] = knowledge

        glossary = api_get(base_url, f"/api/courses/{course_id}/glossary")
        snapshot.setdefault("glossaries", {})[course_id] = glossary

        preview_map: dict[str, dict] = {}
        for material in workspace.get("materials") or []:
            relative_path = material.get("relativePath")
            if not relative_path:
                continue
            try:
                preview = api_get(base_url, f"/api/courses/{course_id}/materials/preview/{encode_material_path(relative_path)}")
            except Exception as error:  # noqa: BLE001 - 单个材料失败不阻断导出
                print(f"[export]   preview 失败 {relative_path}: {error}", file=sys.stderr)
                continue
            preview_map[relative_path] = preview
            total_previews += 1
        snapshot["materialPreviews"][course_id] = preview_map

        # 二次过滤：workspace 材料清单与预览 kind 双重校验后才保留
        strip_materials_without_preview(workspace, preview_map)

    snapshot["archive"] = sanitize_archive(api_get(base_url, "/api/archive"), now)
    snapshot["runtimeModel"] = sanitize_runtime_model(api_get(base_url, "/api/runtime-model"))
    snapshot["userProfile"] = sanitize_user_profile(api_get(base_url, "/api/user-profile"))
    snapshot["embeddingProfile"] = api_get(base_url, "/api/knowledge/embedding")
    snapshot["mcpServers"] = sanitize_mcp_servers(api_get(base_url, "/api/mcp/servers"))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as file:
        json.dump(snapshot, file, ensure_ascii=False, indent=2)

    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"[export] 完成：{len(courses)} 门课程、{total_previews} 份材料预览 → {out_path}（{size_mb:.1f} MB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
