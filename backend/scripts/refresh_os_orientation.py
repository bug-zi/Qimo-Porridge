# -*- coding: utf-8 -*-
"""强制重建操作系统课程的第0天·复习导引（主线重排后内容已过时）。

走真实链路 ensure_orientation_task(force=True)：签名缓存失效 → LLM 重生成 →
校验（phases 覆盖全部天数、dependencyLayers 分层合法）→ 落 workspace。
旧导引的 completed 状态会被保留。

运行：cd backend && .venv\\Scripts\\python scripts\\refresh_os_orientation.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import study_service

COURSE_ID = "course-1786245204742"


def main() -> None:
    workspace = study_service.ensure_orientation_task(COURSE_ID, force=True)
    orientation = next(
        t for t in workspace["tasks"] if str(t.get("kind", "")) == "orientation"
    )
    guide = orientation["studyGuide"]["orientation"]
    print(f"导引任务状态：{orientation['status']}（沿用旧完成状态）")
    print("新阶段划分：")
    for phase in guide["phases"]:
        print(f"  {phase['dayRange']}  {phase['title']} —— {phase['goal']}")
    print("新依赖分层：")
    for layer in guide["dependencyLayers"]:
        print(f"  L{layer['level']} {layer['title']}: {'、'.join(layer['knowledgePoints'])}")


if __name__ == "__main__":
    main()
