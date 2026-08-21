# -*- coding: utf-8 -*-
"""验证 OS 课程重排结果：无 DAG 违规、无跨模块回边。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import study_service, study_scheduler

ws = study_service.load_workspace("course-1786245204742", refresh_materials=False)
tasks, points = ws["tasks"], ws["knowledgePoints"]
print("DAG violations:", study_scheduler.find_dag_violations(tasks, points))
mods = {m["id"]: m["order"] for m in ws["modules"]}
by_id = {p["id"]: p for p in points}
back_edges = []
for p in points:
    for pre in p.get("prerequisites", []):
        src = by_id.get(pre)
        if src is None:
            continue
        a, b = mods.get(src["moduleId"]), mods.get(p["moduleId"])
        if a and b and a > b:
            back_edges.append(f"{src['name']}(mod{a}) -> {p['name']}(mod{b})")
print("跨模块回边:", back_edges or "无")
print("schedulingWarnings:", ws.get("schedulingWarnings"))
print("modules:", [(m["title"], m["order"]) for m in ws["modules"]])
