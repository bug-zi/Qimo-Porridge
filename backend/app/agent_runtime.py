from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable


DATA_DIRECTORY = Path(__file__).resolve().parent.parent / "data"
DATABASE_PATH = DATA_DIRECTORY / "exam_booster.db"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


@contextmanager
def _connection() -> Iterator[sqlite3.Connection]:
    DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_agent_database() -> None:
    with _connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS agent_runs (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                workflow TEXT NOT NULL,
                status TEXT NOT NULL,
                input_json TEXT NOT NULL DEFAULT '{}',
                output_json TEXT NOT NULL DEFAULT '{}',
                error TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS agent_steps (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                step_index INTEGER NOT NULL,
                agent_name TEXT NOT NULL,
                status TEXT NOT NULL,
                input_json TEXT NOT NULL DEFAULT '{}',
                output_json TEXT NOT NULL DEFAULT '{}',
                error TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (run_id) REFERENCES agent_runs(id)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_steps_run
                ON agent_steps (run_id, step_index);

            CREATE TABLE IF NOT EXISTS agent_jobs (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                job_type TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 3,
                available_at TEXT NOT NULL,
                lease_until TEXT NOT NULL DEFAULT '',
                error TEXT NOT NULL DEFAULT '',
                result_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_agent_jobs_ready
                ON agent_jobs (status, available_at, created_at);

            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                artifact_type TEXT NOT NULL,
                version INTEGER NOT NULL,
                status TEXT NOT NULL,
                content_json TEXT NOT NULL,
                source_run_id TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE (course_id, artifact_type, version)
            );
            CREATE INDEX IF NOT EXISTS idx_artifacts_latest
                ON artifacts (course_id, artifact_type, version DESC);

            CREATE TABLE IF NOT EXISTS adjustment_proposals (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                status TEXT NOT NULL,
                base_revision INTEGER NOT NULL,
                title TEXT NOT NULL,
                reason TEXT NOT NULL,
                impact TEXT NOT NULL,
                operations_json TEXT NOT NULL,
                before_json TEXT NOT NULL,
                after_json TEXT NOT NULL,
                source_run_id TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT '',
                dismissed_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_adjustment_proposals_course
                ON adjustment_proposals (course_id, status, created_at DESC);

            CREATE TABLE IF NOT EXISTS external_sources (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                url TEXT NOT NULL,
                source_type TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                error TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS mcp_servers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                transport TEXT NOT NULL DEFAULT 'http',
                command TEXT NOT NULL DEFAULT '',
                args_json TEXT NOT NULL DEFAULT '[]',
                tools_json TEXT NOT NULL DEFAULT '[]',
                enabled INTEGER NOT NULL DEFAULT 1,
                allowed_tools_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        existing_columns = {
            str(row["name"])
            for row in connection.execute("PRAGMA table_info(mcp_servers)").fetchall()
        }
        for column, definition in {
            "transport": "TEXT NOT NULL DEFAULT 'http'",
            "command": "TEXT NOT NULL DEFAULT ''",
            "args_json": "TEXT NOT NULL DEFAULT '[]'",
            "tools_json": "TEXT NOT NULL DEFAULT '[]'",
        }.items():
            if column not in existing_columns:
                connection.execute(f"ALTER TABLE mcp_servers ADD COLUMN {column} {definition}")


def create_agent_run(course_id: str, workflow: str, input_data: dict[str, Any] | None = None) -> str:
    initialize_agent_database()
    run_id = f"run-{uuid.uuid4().hex}"
    timestamp = _now()
    with _connection() as connection:
        connection.execute(
            "INSERT INTO agent_runs (id, course_id, workflow, status, input_json, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?, ?)",
            (run_id, course_id, workflow, json.dumps(input_data or {}, ensure_ascii=False), timestamp, timestamp),
        )
    return run_id


def finish_agent_run(run_id: str, output: dict[str, Any] | None = None) -> None:
    with _connection() as connection:
        connection.execute(
            "UPDATE agent_runs SET status = 'completed', output_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(output or {}, ensure_ascii=False), _now(), run_id),
        )


def fail_agent_run(run_id: str, error: Exception | str) -> None:
    with _connection() as connection:
        connection.execute(
            "UPDATE agent_runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
            (str(error), _now(), run_id),
        )


def get_agent_run(run_id: str) -> dict[str, Any]:
    initialize_agent_database()
    with _connection() as connection:
        row = connection.execute("SELECT * FROM agent_runs WHERE id = ?", (run_id,)).fetchone()
        steps = connection.execute(
            "SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_index, created_at",
            (run_id,),
        ).fetchall()
    if row is None:
        raise KeyError("Agent 运行记录不存在")
    return {
        "id": str(row["id"]),
        "courseId": str(row["course_id"]),
        "workflow": str(row["workflow"]),
        "status": str(row["status"]),
        "input": json.loads(row["input_json"]),
        "output": json.loads(row["output_json"]),
        "error": str(row["error"]),
        "createdAt": str(row["created_at"]),
        "updatedAt": str(row["updated_at"]),
        "steps": [
            {
                "id": str(step["id"]),
                "index": int(step["step_index"]),
                "agent": str(step["agent_name"]),
                "status": str(step["status"]),
                "input": json.loads(step["input_json"]),
                "output": json.loads(step["output_json"]),
                "error": str(step["error"]),
            }
            for step in steps
        ],
    }


def record_agent_step(
    run_id: str,
    step_index: int,
    agent_name: str,
    status: str,
    *,
    input_data: dict[str, Any] | None = None,
    output_data: dict[str, Any] | None = None,
    error: Exception | str = "",
) -> str:
    step_id = f"step-{uuid.uuid4().hex}"
    timestamp = _now()
    with _connection() as connection:
        connection.execute(
            """
            INSERT INTO agent_steps (
                id, run_id, step_index, agent_name, status, input_json,
                output_json, error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                step_id,
                run_id,
                step_index,
                agent_name,
                status,
                json.dumps(input_data or {}, ensure_ascii=False),
                json.dumps(output_data or {}, ensure_ascii=False),
                str(error),
                timestamp,
                timestamp,
            ),
        )
    return step_id


def save_artifact(
    course_id: str,
    artifact_type: str,
    content: dict[str, Any],
    *,
    status: str = "draft",
    source_run_id: str = "",
) -> dict[str, Any]:
    initialize_agent_database()
    artifact_id = f"artifact-{uuid.uuid4().hex}"
    with _connection() as connection:
        row = connection.execute(
            "SELECT COALESCE(MAX(version), 0) FROM artifacts WHERE course_id = ? AND artifact_type = ?",
            (course_id, artifact_type),
        ).fetchone()
        version = int(row[0]) + 1
        connection.execute(
            "INSERT INTO artifacts (id, course_id, artifact_type, version, status, content_json, source_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                artifact_id,
                course_id,
                artifact_type,
                version,
                status,
                json.dumps(content, ensure_ascii=False),
                source_run_id,
                _now(),
            ),
        )
    return {"id": artifact_id, "type": artifact_type, "version": version, "status": status, "content": content}


def get_latest_artifact(course_id: str, artifact_type: str) -> dict[str, Any] | None:
    initialize_agent_database()
    with _connection() as connection:
        row = connection.execute(
            "SELECT * FROM artifacts WHERE course_id = ? AND artifact_type = ? ORDER BY version DESC LIMIT 1",
            (course_id, artifact_type),
        ).fetchone()
    if row is None:
        return None
    return {
        "id": str(row["id"]),
        "type": str(row["artifact_type"]),
        "version": int(row["version"]),
        "status": str(row["status"]),
        "content": json.loads(row["content_json"]),
        "sourceRunId": str(row["source_run_id"]),
    }


def enqueue_agent_job(
    course_id: str,
    job_type: str,
    payload: dict[str, Any],
    *,
    max_attempts: int = 3,
) -> str:
    initialize_agent_database()
    job_id = f"job-{uuid.uuid4().hex}"
    timestamp = _now()
    with _connection() as connection:
        connection.execute(
            """
            INSERT INTO agent_jobs (
                id, course_id, job_type, payload_json, status, attempts,
                max_attempts, available_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)
            """,
            (job_id, course_id, job_type, json.dumps(payload, ensure_ascii=False), max_attempts, timestamp, timestamp, timestamp),
        )
    return job_id


def get_agent_job(job_id: str) -> dict[str, Any]:
    initialize_agent_database()
    with _connection() as connection:
        row = connection.execute("SELECT * FROM agent_jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        raise KeyError("Agent 后台任务不存在")
    return {
        "id": str(row["id"]),
        "courseId": str(row["course_id"]),
        "jobType": str(row["job_type"]),
        "status": str(row["status"]),
        "attempts": int(row["attempts"]),
        "maxAttempts": int(row["max_attempts"]),
        "error": str(row["error"]),
        "result": json.loads(row["result_json"]),
        "createdAt": str(row["created_at"]),
        "updatedAt": str(row["updated_at"]),
    }


def _claim_job() -> dict[str, Any] | None:
    initialize_agent_database()
    now = _now()
    lease_until = (datetime.now() + timedelta(minutes=10)).isoformat(timespec="seconds")
    with _connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            "UPDATE agent_jobs SET status = 'queued', lease_until = '' WHERE status = 'running' AND lease_until != '' AND lease_until < ?",
            (now,),
        )
        row = connection.execute(
            "SELECT * FROM agent_jobs WHERE status = 'queued' AND available_at <= ? ORDER BY created_at LIMIT 1",
            (now,),
        ).fetchone()
        if row is None:
            connection.commit()
            return None
        connection.execute(
            "UPDATE agent_jobs SET status = 'running', attempts = attempts + 1, lease_until = ?, updated_at = ? WHERE id = ?",
            (lease_until, now, row["id"]),
        )
        connection.commit()
    return {
        "id": str(row["id"]),
        "courseId": str(row["course_id"]),
        "jobType": str(row["job_type"]),
        "payload": json.loads(row["payload_json"]),
        "attempts": int(row["attempts"]) + 1,
        "maxAttempts": int(row["max_attempts"]),
    }


def _complete_job(job_id: str, result: dict[str, Any] | None = None) -> None:
    with _connection() as connection:
        connection.execute(
            "UPDATE agent_jobs SET status = 'completed', result_json = ?, lease_until = '', updated_at = ? WHERE id = ?",
            (json.dumps(result or {}, ensure_ascii=False), _now(), job_id),
        )


def _fail_job(job: dict[str, Any], error: Exception) -> None:
    exhausted = job["attempts"] >= job["maxAttempts"]
    status = "failed" if exhausted else "queued"
    delay_seconds = min(60, 2 ** job["attempts"])
    available_at = (datetime.now() + timedelta(seconds=delay_seconds)).isoformat(timespec="seconds")
    with _connection() as connection:
        connection.execute(
            "UPDATE agent_jobs SET status = ?, error = ?, available_at = ?, lease_until = '', updated_at = ? WHERE id = ?",
            (status, str(error), available_at, _now(), job["id"]),
        )


class AgentJobWorker:
    def __init__(self, handlers: dict[str, Callable[[str, dict[str, Any]], dict[str, Any] | None]]) -> None:
        self._handlers = handlers
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="exam-booster-agent-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3)

    def _run(self) -> None:
        while not self._stop_event.is_set():
            job = _claim_job()
            if job is None:
                self._stop_event.wait(0.75)
                continue
            try:
                handler = self._handlers.get(job["jobType"])
                if handler is None:
                    raise RuntimeError(f"未注册后台任务处理器：{job['jobType']}")
                result = handler(job["courseId"], job["payload"])
                _complete_job(job["id"], result)
            except Exception as error:
                _fail_job(job, error)


def create_adjustment_proposal(
    course_id: str,
    *,
    base_revision: int,
    title: str,
    reason: str,
    impact: str,
    operations: list[dict[str, Any]],
    before: dict[str, Any],
    after: dict[str, Any],
    source_run_id: str = "",
) -> dict[str, Any]:
    initialize_agent_database()
    proposal_id = f"proposal-{uuid.uuid4().hex}"
    with _connection() as connection:
        connection.execute(
            """
            INSERT INTO adjustment_proposals (
                id, course_id, status, base_revision, title, reason, impact,
                operations_json, before_json, after_json, source_run_id, created_at
            ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                proposal_id,
                course_id,
                base_revision,
                title,
                reason,
                impact,
                json.dumps(operations, ensure_ascii=False),
                json.dumps(before, ensure_ascii=False),
                json.dumps(after, ensure_ascii=False),
                source_run_id,
                _now(),
            ),
        )
    return get_adjustment_proposal(course_id, proposal_id)


def get_adjustment_proposal(course_id: str, proposal_id: str) -> dict[str, Any]:
    with _connection() as connection:
        row = connection.execute(
            "SELECT * FROM adjustment_proposals WHERE id = ? AND course_id = ?",
            (proposal_id, course_id),
        ).fetchone()
    if row is None:
        raise KeyError("调整提案不存在")
    return {
        "id": str(row["id"]),
        "courseId": str(row["course_id"]),
        "status": str(row["status"]),
        "baseRevision": int(row["base_revision"]),
        "title": str(row["title"]),
        "reason": str(row["reason"]),
        "impact": str(row["impact"]),
        "operations": json.loads(row["operations_json"]),
        "before": json.loads(row["before_json"]),
        "after": json.loads(row["after_json"]),
    }


def set_proposal_status(course_id: str, proposal_id: str, status: str) -> None:
    if status not in {"applied", "dismissed"}:
        raise ValueError("提案状态无效")
    timestamp_column = "applied_at" if status == "applied" else "dismissed_at"
    with _connection() as connection:
        changed = connection.execute(
            f"UPDATE adjustment_proposals SET status = ?, {timestamp_column} = ? WHERE id = ? AND course_id = ? AND status = 'pending'",
            (status, _now(), proposal_id, course_id),
        ).rowcount
    if not changed:
        raise RuntimeError("提案已处理或不存在")


def create_external_source(course_id: str, url: str, source_type: str = "web") -> dict[str, Any]:
    initialize_agent_database()
    source_id = f"source-{uuid.uuid4().hex}"
    timestamp = _now()
    with _connection() as connection:
        connection.execute(
            "INSERT INTO external_sources (id, course_id, url, source_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
            (source_id, course_id, url, source_type, timestamp, timestamp),
        )
    return get_external_source(course_id, source_id)


def update_external_source(source_id: str, **fields: Any) -> None:
    allowed = {"title", "status", "content", "metadata_json", "error"}
    updates = {key: value for key, value in fields.items() if key in allowed}
    if not updates:
        return
    if "metadata_json" in updates and not isinstance(updates["metadata_json"], str):
        updates["metadata_json"] = json.dumps(updates["metadata_json"], ensure_ascii=False)
    assignments = ", ".join(f"{key} = ?" for key in updates)
    with _connection() as connection:
        connection.execute(
            f"UPDATE external_sources SET {assignments}, updated_at = ? WHERE id = ?",
            (*updates.values(), _now(), source_id),
        )


def get_external_source(course_id: str, source_id: str) -> dict[str, Any]:
    with _connection() as connection:
        row = connection.execute(
            "SELECT * FROM external_sources WHERE id = ? AND course_id = ?",
            (source_id, course_id),
        ).fetchone()
    if row is None:
        raise KeyError("外部来源不存在")
    return {
        "id": str(row["id"]),
        "courseId": str(row["course_id"]),
        "url": str(row["url"]),
        "sourceType": str(row["source_type"]),
        "title": str(row["title"]),
        "status": str(row["status"]),
        "content": str(row["content"]),
        "metadata": json.loads(row["metadata_json"]),
        "error": str(row["error"]),
    }
