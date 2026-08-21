# -*- coding: utf-8 -*-
"""对操作系统课程执行一次策略文档维护（把 reviewPlan 主线刷成重排后的新主线）。

走真实链路 maintain_review_plan：compact_state 现在携带 modules + 新任务表，
prompt 要求主线与模块顺序完全一致。文档更新后再由调用方重建复习导引。

运行：cd backend && .venv\\Scripts\\python scripts\\maintain_os_review_plan.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import study_service

COURSE_ID = "course-1786245204742"


def main() -> None:
    study_service.maintain_review_plan(COURSE_ID, "用户确认调整复习计划（四大模块重排）")
    plan = study_service._read_strategy_document(COURSE_ID, "reviewPlan")
    print("维护后的 reviewPlan 开头：")
    print(plan[:600])


if __name__ == "__main__":
    main()
