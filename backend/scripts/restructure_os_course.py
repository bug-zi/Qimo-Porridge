# -*- coding: utf-8 -*-
"""对操作系统课程落地"先内存管理再进程管理"的四大模块重排。

走真实的提案→采纳链路（create_adjustment_proposal → apply_proposal），
与 AI 伴学 Agent 在前端提交 restructure_modules 提案、用户点「采纳」完全同路。

方案（用户在对话中确认）：
  一、内存管理      二、进程管理      三、文件系统管理   四、输入输出设备管理   五、综合冲刺
依赖调整（跨模块前置必须与新主线方向一致，否则主线模式回退）：
  - 虚拟地址空间 ← 进程线程基础：删除（改为无前置，模块内自足）
  - inode ← I/O 控制方式：反转（I/O 控制方式依赖 inode，同在 io 模块内保持层序）
  - I/O 管理与 SPOOLing ← 自旋锁（进程模块）：删除（文件系统/I/O 模块不再依赖进程模块）
  - 跨章节综合 ← banker-request 等四模块收尾：保留（冲刺模块在最末，方向一致）
运行：cd backend && .venv\\Scripts\\python scripts\\restructure_os_course.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import study_service
from app.agents.tools import apply_proposal
from app.agent_runtime import create_adjustment_proposal

COURSE_ID = "course-1786245204742"

# 新主线：模块 → 知识点 id（对话确认的四模块 + 综合冲刺）。
RESTRUCTURE = {
    "type": "restructure_modules",
    "modules": [
        {
            "id": "memory-management",
            "title": "内存管理",
            "pointIds": [
                "virtual-address-space",
                "paging-address-translation",
                "page-replacement",
                "page-replacement-extended",
            ],
        },
        {
            "id": "process-management",
            "title": "进程管理",
            "pointIds": [
                "system-call-mode-switch",
                "interrupt-trap-frame",
                "process-thread-basics",
                "fork-process-creation",
                "cpu-scheduling",
                "context-switch",
                "locks-concurrency",
                "deadlock-conditions",
                "banker-safety",
                "banker-request",
            ],
        },
        {
            "id": "file-system",
            "title": "文件系统管理",
            "pointIds": [
                "inode-index-blocks",
                "free-space-ext2",
                "boot-shell-pipe",
            ],
        },
        {
            "id": "io-device",
            "title": "输入输出设备管理",
            "pointIds": [
                "io-spooling",
                "io-control-device-independence",
            ],
        },
        {
            "id": "integrated-sprint",
            "title": "综合冲刺",
            "pointIds": ["cross-topic-integration"],
        },
    ],
    "prerequisitesOverride": {
        # 内存管理不再依赖进程模块：模块内链条 虚拟地址→分页→置换 保留。
        "virtual-address-space": [],
        # I/O：SPOOLing 脱钩进程锁；I/O 控制方式改为依赖 SPOOLing（同模块层序）。
        "io-spooling": [],
        "io-control-device-independence": ["io-spooling"],
        # 文件系统：inode 脱钩 I/O 控制方式，改为无前置（文件模块先于 I/O 模块）。
        "inode-index-blocks": ["system-call-mode-switch"],
        # 综合冲刺依赖收尾知识点：方向与主线一致，保留。
        "cross-topic-integration": [
            "banker-request",
            "page-replacement",
            "io-spooling",
            "inode-index-blocks",
        ],
    },
}


def main() -> None:
    workspace = study_service.load_workspace(COURSE_ID, refresh_materials=False)
    known = {
        str(point.get("id", ""))
        for point in workspace.get("knowledgePoints", [])
        if isinstance(point, dict)
    }
    listed = [pid for module in RESTRUCTURE["modules"] for pid in module["pointIds"]]
    missing = known - set(listed)
    extra = set(listed) - known
    if missing or extra:
        raise SystemExit(f"知识点覆盖校验失败 missing={sorted(missing)} extra={sorted(extra)}")

    proposal = create_adjustment_proposal(
        COURSE_ID,
        base_revision=int(workspace.get("planRevision", 0)),
        title="重排为四大标准模块：内存→进程→文件系统→I/O",
        reason=(
            "用户要求按标准课程结构划分模块并先复习内存管理："
            "一级模块改为 内存管理/进程管理/文件系统管理/输入输出设备管理/综合冲刺，"
            "跨模块前置依赖按新主线方向调整，任务由调度器按新主线确定性重排。"
        ),
        impact=(
            "全部任务按「内存→进程→文件系统→I/O→冲刺」新主线重新装包到 12 天复习日；"
            "模块内仍遵守前置依赖（如 分页地址转换 先于 页面置换）。"
        ),
        operations=[RESTRUCTURE],
        before={"totalMinutes": sum(int(t.get("duration", 0)) for t in workspace.get("tasks", []))},
        after={},
        source_run_id="",
    )
    print(f"提案已创建：{proposal['id']}")
    new_workspace, applied = apply_proposal(
        COURSE_ID,
        proposal["id"],
        load_workspace=lambda value: study_service.load_workspace(value, refresh_materials=False),
        save_workspace=study_service.save_workspace,
    )
    print(f"提案已应用，状态：{applied['status']}")
    modules = new_workspace["modules"]
    print("新模块主线：", " → ".join(m["title"] for m in modules))
    by_kp = {str(p.get("id")): str(p.get("name")) for p in new_workspace["knowledgePoints"]}
    for item in sorted(new_workspace["tasks"], key=lambda t: (t["day"], t["order"])):
        kp_name = by_kp.get(str(item.get("knowledgePointId") or ""), "-")
        print(f"  第{item['day']:>2}天 #{item['order']:<3} {item['title']}（{kp_name}）")


if __name__ == "__main__":
    main()
