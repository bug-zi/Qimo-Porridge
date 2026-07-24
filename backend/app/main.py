from __future__ import annotations

import json
import mimetypes
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query, Request as FastAPIRequest
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .agent_runtime import (
    AgentJobWorker,
    enqueue_agent_job,
    get_agent_job,
    get_agent_run,
    get_external_source,
    initialize_agent_database,
)
from .agents.tools import apply_proposal, dismiss_proposal
from .external_source_service import (
    approve_external_source,
    dismiss_external_source,
    process_external_source_job,
    submit_external_source,
)
from .knowledge_service import (
    ensure_local_ollama_service,
    get_embedding_status,
    get_knowledge_status,
    initialize_knowledge_database,
    rebuild_course_embeddings,
    retrieve_material_context,
    save_embedding_config,
    test_embedding_connection,
)
from .mcp_gateway import discover_mcp_tools, list_mcp_servers, save_mcp_server, seed_mcp_presets
from .study_service import (
    agent_chat,
    approve_strategy_documents,
    build_material_preview,
    bootstrap_engineering_workspace,
    create_course_workspace,
    create_empty_course_workspace,
    fetch_available_model_ids,
    generate_strategy_documents,
    get_runtime_model_api_key,
    get_runtime_model_profile,
    get_strategy_documents,
    load_workspace,
    maintain_review_plan,
    mark_strategy_maintenance_pending,
    refresh_workspace_materials,
    resolve_course_material_path,
    resolve_converted_material_pdf_path,
    save_workspace,
    save_runtime_model_profile,
    save_strategy_documents,
    delete_course_material,
    save_course_setup,
    submit_course_diagnostic,
    submit_mock_answers,
    submit_practice_answer,
    submit_wrong_answer_retry,
    sync_course_knowledge,
    upload_course_material,
    upload_course_materials,
    update_workspace_state,
    update_course_prompt,
)

DATA_DIRECTORY = Path(__file__).resolve().parent.parent / "data"
DATABASE_PATH = DATA_DIRECTORY / "exam_booster.db"
ARCHIVE_RETENTION_DAYS = 7


def _maintain_plan_job(course_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    maintain_review_plan(course_id, str(payload.get("event", "学习状态变化")))
    return {"maintained": True}


def _approve_strategy_documents_job(course_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    approve_strategy_documents(
        course_id,
        str(payload.get("reviewPlan", "")),
        str(payload.get("coursePrompt", "")),
        expected_review_plan_version=int(payload.get("reviewPlanVersion", 0)),
        expected_course_prompt_version=int(payload.get("coursePromptVersion", 0)),
    )
    return {"courseId": course_id, "planned": True}


AGENT_JOB_WORKER = AgentJobWorker(
    {
        "maintain_review_plan": _maintain_plan_job,
        "external_source_import": process_external_source_job,
        "approve_strategy_documents": _approve_strategy_documents_job,
    }
)


def get_connection() -> sqlite3.Connection:
    DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS courses (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                exam_date TEXT NOT NULL,
                target_score INTEGER NOT NULL,
                daily_hours REAL NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS plan_tasks (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                title TEXT NOT NULL,
                duration INTEGER NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                priority TEXT NOT NULL,
                status TEXT NOT NULL,
                FOREIGN KEY (course_id) REFERENCES courses(id)
            );

            CREATE TABLE IF NOT EXISTS archived_items (
                id TEXT PRIMARY KEY,
                item_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                title TEXT NOT NULL,
                course_id TEXT,
                course_name TEXT,
                payload TEXT NOT NULL,
                deleted_at TEXT NOT NULL,
                purge_after TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        seed_completed = connection.execute(
            "SELECT value FROM app_metadata WHERE key = ?",
            ("seed_courses_initialized",),
        ).fetchone()
        existing_course = connection.execute(
            "SELECT id FROM courses WHERE id = ?",
            ("data-structure",),
        ).fetchone()
        if seed_completed is None and existing_course is None:
            connection.execute(
                """
                INSERT INTO courses (
                    id, name, exam_date, target_score, daily_hours, progress, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "data-structure",
                    "数据结构",
                    "2026-07-31",
                    85,
                    4,
                    61,
                    datetime.now().isoformat(timespec="seconds"),
                ),
            )
            connection.executemany(
                """
                INSERT INTO plan_tasks (id, course_id, title, duration, progress, priority, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        "task-graph",
                        "data-structure",
                        "图的遍历与最短路径",
                        120,
                        10,
                        "high",
                        "pending",
                    ),
                    (
                        "task-sort",
                        "data-structure",
                        "排序算法",
                        90,
                        5,
                        "high",
                        "pending",
                    ),
                ],
            )
        if seed_completed is None:
            connection.execute(
                "INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)",
                ("seed_courses_initialized", "true"),
            )


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    initialize_knowledge_database()
    ensure_local_ollama_service()
    initialize_agent_database()
    seed_mcp_presets()
    try:
        sync_course_knowledge()
    except Exception:
        pass
    AGENT_JOB_WORKER.start()
    try:
        yield
    finally:
        AGENT_JOB_WORKER.stop()


app = FastAPI(
    title="期末粥加速器本地服务",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CourseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    exam_date: str
    target_score: int = Field(ge=0, le=100)
    daily_hours: float = Field(gt=0, le=24)


class CourseResponse(CourseCreate):
    id: str
    progress: int


class PlanTaskResponse(BaseModel):
    id: str
    course_id: str
    title: str
    duration: int
    progress: int
    priority: Literal["high", "medium", "low"]
    status: Literal["pending", "in-progress", "completed"]


class ModelProfileTestRequest(BaseModel):
    base_url: str = Field(min_length=8, max_length=500)
    api_key: str = Field(default="", max_length=500)
    model: str = Field(default="", max_length=200)


class ModelProfileTestResponse(BaseModel):
    success: bool
    message: str
    available_models: list[str] = Field(default_factory=list)


class RuntimeModelUpdateRequest(BaseModel):
    base_url: str = Field(min_length=8, max_length=500)
    api_key: str = Field(default="", max_length=500)
    model: str = Field(min_length=1, max_length=200)


class EmbeddingConfigRequest(BaseModel):
    enabled: bool = True
    base_url: str = Field(min_length=8, max_length=500)
    model: str = Field(min_length=1, max_length=200)


class EngineeringBootstrapRequest(BaseModel):
    force: bool = False
    target_score: int = Field(default=80, ge=60, le=100)
    daily_hours: float = Field(default=2, gt=0, le=12)
    days: int = Field(default=3, ge=1, le=14)


class CourseSetupRequest(BaseModel):
    course_name: str = Field(min_length=1, max_length=80)
    exam_date: str = Field(default="", max_length=80)
    target_score: int = Field(ge=0, le=100)
    target_text: str = Field(default="", max_length=200)
    daily_hours: float = Field(gt=0, le=12)
    days: int = Field(ge=1, le=14)
    exam_format: str = Field(default="", max_length=1000)
    remarks: str = Field(default="", max_length=2000)


class PracticeAnswerRequest(BaseModel):
    question_id: str = Field(min_length=1, max_length=120)
    answer_index: int = Field(ge=0)
    mode: Literal["主线学习", "刷题练习"] = "刷题练习"


class WrongAnswerRetryRequest(BaseModel):
    answer_index: int = Field(ge=0)


class MockSubmitRequest(BaseModel):
    answers: dict[str, int]


class DiagnosticSubmitRequest(BaseModel):
    answers: dict[str, int]


class AgentChatRequest(BaseModel):
    message: str = Field(min_length=1)


class WorkspaceUpdateRequest(BaseModel):
    tasks: list[dict[str, Any]] | None = None
    wrong_answers: list[dict[str, Any]] | None = None
    note: str | None = None


class StrategyDocumentsUpdateRequest(BaseModel):
    review_plan: str = Field(min_length=1)
    course_prompt: str = Field(min_length=1)
    review_plan_version: int = Field(ge=0)
    course_prompt_version: int = Field(ge=0)


class CoursePromptUpdateRequest(BaseModel):
    course_prompt: str = Field(min_length=1)
    version: int = Field(ge=0)


class McpServerUpdateRequest(BaseModel):
    id: str = Field(default="", max_length=120)
    name: str = Field(min_length=1, max_length=120)
    transport: Literal["http", "stdio"] = "http"
    endpoint: str = Field(default="", max_length=1000)
    command: str = Field(default="", max_length=300)
    args: list[str] = Field(default_factory=list, max_length=20)
    allowed_tools: list[str] = Field(min_length=1, max_length=40)


class ExternalSourceRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2000)
    mcp_server_id: str = Field(min_length=1, max_length=120)
    tool_name: str = Field(min_length=1, max_length=200)
    source_type: Literal["web", "video", "note"] = "web"


class ArchiveItemResponse(BaseModel):
    id: str
    item_type: Literal["course", "wrong-answer"]
    entity_id: str
    title: str
    course_id: str | None = None
    course_name: str | None = None
    deleted_at: str
    purge_after: str


class WrongAnswerArchiveResponse(BaseModel):
    workspace: dict[str, Any]
    archive_item: ArchiveItemResponse


def row_to_course(row: sqlite3.Row) -> CourseResponse:
    return CourseResponse(
        id=row["id"],
        name=row["name"],
        exam_date=row["exam_date"],
        target_score=row["target_score"],
        daily_hours=row["daily_hours"],
        progress=row["progress"],
    )


def course_payload_to_response(course: dict[str, Any]) -> CourseResponse:
    return CourseResponse(
        id=course["id"],
        name=course["name"],
        exam_date=course.get("exam_date", course.get("examDate")),
        target_score=course.get("target_score", course.get("targetScore")),
        daily_hours=course.get("daily_hours", course.get("dailyHours")),
        progress=course.get("progress", 0),
    )


def row_to_archive_item(row: sqlite3.Row) -> ArchiveItemResponse:
    return ArchiveItemResponse(
        id=row["id"],
        item_type=row["item_type"],
        entity_id=row["entity_id"],
        title=row["title"],
        course_id=row["course_id"],
        course_name=row["course_name"],
        deleted_at=row["deleted_at"],
        purge_after=row["purge_after"],
    )


def include_strategy_document_content(course_id: str, workspace: dict[str, Any]) -> dict[str, Any]:
    try:
        documents = get_strategy_documents(course_id)
    except (FileNotFoundError, ValueError):
        return workspace
    return {**workspace, "strategyDocuments": documents}


def purge_expired_archive_items(connection: sqlite3.Connection) -> None:
    connection.execute(
        "DELETE FROM archived_items WHERE purge_after <= ?",
        (datetime.now().isoformat(timespec="seconds"),),
    )


def list_active_archive_items(connection: sqlite3.Connection) -> list[ArchiveItemResponse]:
    purge_expired_archive_items(connection)
    rows = connection.execute(
        """
        SELECT id, item_type, entity_id, title, course_id, course_name, deleted_at, purge_after
        FROM archived_items
        ORDER BY deleted_at DESC
        """
    ).fetchall()
    return [row_to_archive_item(row) for row in rows]


def create_archive_item(
    connection: sqlite3.Connection,
    *,
    item_type: Literal["course", "wrong-answer"],
    entity_id: str,
    title: str,
    payload: dict[str, Any],
    course_id: str | None = None,
    course_name: str | None = None,
) -> ArchiveItemResponse:
    deleted_at = datetime.now().isoformat(timespec="seconds")
    archive_id = f"archive-{item_type}-{entity_id}-{int(datetime.now().timestamp() * 1000)}"
    purge_after = (datetime.fromisoformat(deleted_at) + timedelta(days=ARCHIVE_RETENTION_DAYS)).isoformat(
        timespec="seconds",
    )
    connection.execute(
        """
        INSERT INTO archived_items (
            id, item_type, entity_id, title, course_id, course_name, payload, deleted_at, purge_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            archive_id,
            item_type,
            entity_id,
            title,
            course_id,
            course_name,
            json.dumps(payload, ensure_ascii=False),
            deleted_at,
            purge_after,
        ),
    )
    return ArchiveItemResponse(
        id=archive_id,
        item_type=item_type,
        entity_id=entity_id,
        title=title,
        course_id=course_id,
        course_name=course_name,
        deleted_at=deleted_at,
        purge_after=purge_after,
    )


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "exam-booster-local-api"}


@app.get("/api/courses", response_model=list[CourseResponse])
def list_courses() -> list[CourseResponse]:
    with get_connection() as connection:
        purge_expired_archive_items(connection)
        rows = connection.execute(
            """
            SELECT id, name, exam_date, target_score, daily_hours, progress
            FROM courses
            ORDER BY created_at ASC
            """
        ).fetchall()
    courses = [row_to_course(row) for row in rows]
    for course in courses:
        try:
            load_workspace(course.id, refresh_materials=False)
        except FileNotFoundError:
            create_course_workspace(
                {
                    "id": course.id,
                    "name": course.name,
                    "examDate": course.exam_date,
                    "targetScore": course.target_score,
                    "dailyHours": course.daily_hours,
                    "progress": course.progress,
                    "color": "#3973e8",
                    "icon": "system",
                }
            )
    return courses


@app.post("/api/courses", response_model=CourseResponse, status_code=201)
def create_course(payload: CourseCreate) -> CourseResponse:
    course_id = f"course-{int(datetime.now().timestamp() * 1000)}"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO courses (
                id, name, exam_date, target_score, daily_hours, progress, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                course_id,
                payload.name,
                payload.exam_date,
                payload.target_score,
                payload.daily_hours,
                0,
                datetime.now().isoformat(timespec="seconds"),
            ),
        )
    response = CourseResponse(id=course_id, progress=0, **payload.model_dump())
    create_course_workspace(
        {
            "id": course_id,
            "name": payload.name,
            "examDate": payload.exam_date,
            "targetScore": payload.target_score,
            "dailyHours": payload.daily_hours,
            "progress": 0,
            "color": "#3973e8",
            "icon": "system",
        }
    )
    return response


@app.get("/api/courses/{course_id}/workspace")
def course_workspace(course_id: str) -> dict[str, Any]:
    try:
        return include_strategy_document_content(course_id, load_workspace(course_id))
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/courses/{course_id}/search")
def search_course(course_id: str, q: str = Query(min_length=1, max_length=200)) -> dict[str, Any]:
    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="请输入搜索关键词")

    try:
        workspace = load_workspace(course_id, refresh_materials=False)
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    results: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add_result(
        result_id: str,
        result_type: str,
        module: str,
        title: str,
        excerpt: str,
        source: str = "",
    ) -> None:
        if result_id in seen or len(results) >= 30:
            return
        seen.add(result_id)
        results.append(
            {
                "id": result_id,
                "type": result_type,
                "module": module,
                "title": title,
                "excerpt": excerpt.strip()[:240],
                "source": source,
            }
        )

    try:
        material_matches = retrieve_material_context(course_id, query, limit=8)["items"]
    except (RuntimeError, ValueError, sqlite3.Error):
        material_matches = []
    for item in material_matches:
        add_result(
            f"material-{item['chunkId']}",
            "material",
            "materials",
            str(item["citation"]),
            str(item["content"]),
            str(item["source"]),
        )

    terms = [term for term in query.lower().split() if term]

    def matches(*values: Any) -> bool:
        text = " ".join(str(value) for value in values if value is not None).lower()
        return all(term in text for term in terms)

    for point in workspace.get("knowledgePoints", []):
        if matches(point.get("name"), point.get("summary"), point.get("source")):
            add_result(
                f"knowledge-{point.get('id', point.get('name', ''))}",
                "knowledge",
                "overview",
                str(point.get("name", "知识点")),
                str(point.get("summary", "")),
                str(point.get("source", "")),
            )

    note = str(workspace.get("note", ""))
    if matches(note):
        lowered_note = note.lower()
        match_at = min((lowered_note.find(term) for term in terms if term in lowered_note), default=0)
        excerpt_start = max(0, match_at - 70)
        add_result("course-note", "note", "notes", "课程复习笔记", note[excerpt_start:excerpt_start + 240])

    for wrong_answer in workspace.get("wrongAnswers", []):
        if matches(
            wrong_answer.get("title"),
            wrong_answer.get("tag"),
            wrong_answer.get("mistakeType"),
            wrong_answer.get("source"),
        ):
            add_result(
                f"wrong-answer-{wrong_answer.get('id', wrong_answer.get('title', ''))}",
                "wrong-answer",
                "errors",
                str(wrong_answer.get("title", "错题")),
                str(wrong_answer.get("mistakeType", "")),
                str(wrong_answer.get("source", wrong_answer.get("tag", ""))),
            )

    question_groups = (
        ("practiceQuestions", "practice", "刷题练习"),
        ("mockQuestions", "mock", "模拟卷"),
        ("diagnosticQuestions", "overview", "摸底测试"),
    )
    for field, module, source_label in question_groups:
        for question in workspace.get(field, []):
            if matches(
                question.get("prompt"),
                question.get("explanation"),
                question.get("source"),
                *question.get("options", []),
            ):
                add_result(
                    f"question-{field}-{question.get('id', question.get('prompt', ''))}",
                    "question",
                    module,
                    str(question.get("prompt", "练习题")),
                    str(question.get("explanation", "")),
                    str(question.get("source", source_label)),
                )

    return {"query": query, "results": results}


@app.post("/api/courses/{course_id}/setup")
def configure_course(course_id: str, payload: CourseSetupRequest) -> dict[str, Any]:
    try:
        workspace = save_course_setup(payload.model_dump(), course_id)
        with get_connection() as connection:
            connection.execute(
                """
                UPDATE courses
                SET name = ?, exam_date = ?, target_score = ?, daily_hours = ?
                WHERE id = ?
                """,
                (
                    workspace["course"]["name"],
                    workspace["course"]["examDate"],
                    workspace["course"]["targetScore"],
                    workspace["course"]["dailyHours"],
                    course_id,
                ),
            )
        return include_strategy_document_content(course_id, workspace)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/api/courses/{course_id}/diagnostic/submit")
def submit_course_diagnostic_answers(course_id: str, payload: DiagnosticSubmitRequest) -> dict[str, Any]:
    try:
        return include_strategy_document_content(course_id, submit_course_diagnostic(payload.answers, course_id))
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/courses/{course_id}/strategy-documents")
def course_strategy_documents(course_id: str) -> dict[str, Any]:
    try:
        return get_strategy_documents(course_id)
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/courses/{course_id}/strategy-documents/generate")
def generate_course_strategy_documents(course_id: str) -> dict[str, Any]:
    try:
        return generate_strategy_documents(course_id)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.put("/api/courses/{course_id}/strategy-documents")
def update_course_strategy_documents(
    course_id: str,
    payload: StrategyDocumentsUpdateRequest,
) -> dict[str, Any]:
    try:
        return save_strategy_documents(
            course_id,
            payload.review_plan,
            payload.course_prompt,
            expected_review_plan_version=payload.review_plan_version,
            expected_course_prompt_version=payload.course_prompt_version,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/api/courses/{course_id}/strategy-documents/approve")
def approve_course_strategy_documents(
    course_id: str,
    payload: StrategyDocumentsUpdateRequest,
) -> dict[str, Any]:
    try:
        return include_strategy_document_content(
            course_id,
            approve_strategy_documents(
                course_id,
                payload.review_plan,
                payload.course_prompt,
                expected_review_plan_version=payload.review_plan_version,
                expected_course_prompt_version=payload.course_prompt_version,
            ),
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except RuntimeError as error:
        status_code = 409 if "已被更新" in str(error) else 502
        raise HTTPException(status_code=status_code, detail=str(error)) from error


@app.post("/api/courses/{course_id}/strategy-documents/approve-job", status_code=202)
def enqueue_course_strategy_approval(
    course_id: str,
    payload: StrategyDocumentsUpdateRequest,
) -> dict[str, Any]:
    try:
        job_id = enqueue_agent_job(
            course_id,
            "approve_strategy_documents",
            {
                "reviewPlan": payload.review_plan,
                "coursePrompt": payload.course_prompt,
                "reviewPlanVersion": payload.review_plan_version,
                "coursePromptVersion": payload.course_prompt_version,
            },
            max_attempts=1,
        )
        return {"jobId": job_id, "courseId": course_id}
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.put("/api/courses/{course_id}/course-prompt")
def save_course_prompt(course_id: str, payload: CoursePromptUpdateRequest) -> dict[str, Any]:
    try:
        return update_course_prompt(
            course_id,
            payload.course_prompt,
            expected_version=payload.version,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.get("/api/courses/{course_id}/materials/preview/{material_path:path}")
def preview_course_material(course_id: str, material_path: str) -> dict[str, Any]:
    try:
        return build_material_preview(material_path, course_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/courses/{course_id}/materials/file/{material_path:path}")
def open_course_material(course_id: str, material_path: str) -> FileResponse:
    try:
        file_path = resolve_course_material_path(material_path, course_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return FileResponse(
        file_path,
        media_type=mimetypes.guess_type(file_path.name)[0] or "application/octet-stream",
        filename=file_path.name,
        content_disposition_type="inline",
    )


@app.get("/api/courses/{course_id}/materials/converted-file/{material_path:path}")
def open_converted_course_material(course_id: str, material_path: str) -> FileResponse:
    try:
        file_path = resolve_converted_material_pdf_path(material_path, course_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=f"{Path(material_path).stem}.pdf",
        content_disposition_type="inline",
    )


@app.post("/api/courses/{course_id}/materials/upload-batch")
async def upload_course_material_batch(
    course_id: str,
    request: FastAPIRequest,
) -> dict[str, Any]:
    try:
        payload = await request.body()
        header_end = payload.find(b"\n")
        if header_end <= 0:
            raise ValueError("批量上传数据格式无效")
        manifest_length = int(payload[:header_end].decode("ascii"))
        manifest_start = header_end + 1
        manifest_end = manifest_start + manifest_length
        manifest = json.loads(payload[manifest_start:manifest_end].decode("utf-8"))
        if not isinstance(manifest, list):
            raise ValueError("批量上传清单格式无效")
        files: list[tuple[str, bytes]] = []
        offset = manifest_end
        for item in manifest:
            if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not isinstance(item.get("size"), int):
                raise ValueError("批量上传清单字段无效")
            next_offset = offset + item["size"]
            if next_offset > len(payload):
                raise ValueError("批量上传文件内容不完整")
            files.append((item["name"], payload[offset:next_offset]))
            offset = next_offset
        if offset != len(payload):
            raise ValueError("批量上传数据长度不匹配")
        workspace = upload_course_materials(files, course_id)
        if mark_strategy_maintenance_pending(course_id, "课程资料发生变化"):
            enqueue_agent_job(course_id, "maintain_review_plan", {"event": "课程资料发生变化"})
        return workspace
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.delete("/api/courses/{course_id}/materials/{material_path:path}")
def delete_generic_course_material(
    course_id: str,
    material_path: str,
) -> dict[str, Any]:
    try:
        workspace = delete_course_material(material_path, course_id)
        if mark_strategy_maintenance_pending(course_id, "课程资料发生变化"):
            enqueue_agent_job(course_id, "maintain_review_plan", {"event": "课程资料发生变化"})
        return workspace
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/courses/{course_id}/materials/rescan")
def rescan_course_materials(
    course_id: str,
) -> dict[str, Any]:
    try:
        workspace = refresh_workspace_materials(course_id)
        if mark_strategy_maintenance_pending(course_id, "课程资料重新解析"):
            enqueue_agent_job(course_id, "maintain_review_plan", {"event": "课程资料重新解析"})
        return workspace
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.put("/api/courses/{course_id}/workspace")
def update_course_workspace(
    course_id: str,
    payload: WorkspaceUpdateRequest,
) -> dict[str, Any]:
    try:
        before = load_workspace(course_id, refresh_materials=False)
        completed_before = sum(item.get("status") == "completed" for item in before.get("tasks", []))
        workspace = update_workspace_state(
            tasks=payload.tasks,
            wrong_answers=payload.wrong_answers,
            note=payload.note,
            course_id=course_id,
        )
        completed_after = sum(item.get("status") == "completed" for item in workspace.get("tasks", []))
        if completed_after > completed_before and mark_strategy_maintenance_pending(course_id, "复习任务完成"):
            enqueue_agent_job(course_id, "maintain_review_plan", {"event": "复习任务完成"})
        return workspace
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/courses/{course_id}/practice/answer")
def answer_course_practice(course_id: str, payload: PracticeAnswerRequest) -> dict[str, Any]:
    try:
        return submit_practice_answer(payload.question_id, payload.answer_index, payload.mode, course_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


def _archive_course_wrong_answer(course_id: str, wrong_answer_id: str) -> WrongAnswerArchiveResponse:
    try:
        workspace = load_workspace(course_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    wrong_answers = workspace.get("wrongAnswers", [])
    wrong_answer = next((item for item in wrong_answers if item.get("id") == wrong_answer_id), None)
    if wrong_answer is None:
        raise HTTPException(status_code=404, detail="错题不存在")

    course = workspace.get("course", {})
    with get_connection() as connection:
        archive_item = create_archive_item(
            connection,
            item_type="wrong-answer",
            entity_id=wrong_answer_id,
            title=wrong_answer.get("title", "未命名错题"),
            course_id=course_id,
            course_name=course.get("name"),
            payload={"wrongAnswer": wrong_answer},
        )
        workspace["wrongAnswers"] = [item for item in wrong_answers if item.get("id") != wrong_answer_id]
        save_workspace(workspace, course_id)
    return WrongAnswerArchiveResponse(workspace=workspace, archive_item=archive_item)


@app.delete(
    "/api/courses/{course_id}/wrong-answers/{wrong_answer_id}",
    response_model=WrongAnswerArchiveResponse,
)
def archive_course_wrong_answer(course_id: str, wrong_answer_id: str) -> WrongAnswerArchiveResponse:
    return _archive_course_wrong_answer(course_id, wrong_answer_id)


@app.post("/api/courses/{course_id}/wrong-answers/{wrong_answer_id}/retry")
def retry_course_wrong_answer(
    course_id: str,
    wrong_answer_id: str,
    payload: WrongAnswerRetryRequest,
) -> dict[str, Any]:
    try:
        result = submit_wrong_answer_retry(wrong_answer_id, payload.answer_index, course_id)
        if result.get("correct") and mark_strategy_maintenance_pending(course_id, "错题复练完成"):
            enqueue_agent_job(course_id, "maintain_review_plan", {"event": "错题复练完成"})
        return result
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/courses/{course_id}/mock/submit")
def submit_course_mock(
    course_id: str,
    payload: MockSubmitRequest,
) -> dict[str, Any]:
    try:
        result = submit_mock_answers(payload.answers, course_id)
        if mark_strategy_maintenance_pending(course_id, "模拟卷提交"):
            enqueue_agent_job(course_id, "maintain_review_plan", {"event": "模拟卷提交"})
        return result
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/courses/{course_id}/agent/chat")
def chat_with_course_agent(
    course_id: str,
    payload: AgentChatRequest,
) -> dict[str, Any]:
    try:
        message = payload.message.strip()
        return agent_chat(message, course_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/courses/{course_id}/adjustment-proposals/{proposal_id}/apply")
def apply_course_adjustment_proposal(course_id: str, proposal_id: str) -> dict[str, Any]:
    try:
        workspace, proposal = apply_proposal(
            course_id,
            proposal_id,
            load_workspace=lambda value: load_workspace(value, refresh_materials=False),
            save_workspace=save_workspace,
        )
        if mark_strategy_maintenance_pending(course_id, "用户确认调整复习计划"):
            enqueue_agent_job(course_id, "maintain_review_plan", {"event": "用户确认调整复习计划"})
        return {"workspace": workspace, "proposal": proposal}
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/api/courses/{course_id}/adjustment-proposals/{proposal_id}/dismiss")
def dismiss_course_adjustment_proposal(course_id: str, proposal_id: str) -> dict[str, Any]:
    try:
        return dismiss_proposal(course_id, proposal_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.get("/api/agent-runs/{run_id}")
def agent_run_status(run_id: str) -> dict[str, Any]:
    try:
        return get_agent_run(run_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/agent-jobs/{job_id}")
def agent_job_status(job_id: str) -> dict[str, Any]:
    try:
        return get_agent_job(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/mcp/servers")
def mcp_servers() -> list[dict[str, Any]]:
    return list_mcp_servers()


@app.put("/api/mcp/servers")
def update_mcp_server(payload: McpServerUpdateRequest) -> dict[str, Any]:
    try:
        return save_mcp_server(
            payload.name,
            payload.endpoint,
            payload.allowed_tools,
            payload.id,
            transport=payload.transport,
            command=payload.command,
            args=payload.args,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/mcp/servers/{server_id}/discover")
def discover_mcp_server_tools(server_id: str) -> dict[str, Any]:
    try:
        return discover_mcp_tools(server_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (RuntimeError, OSError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/api/courses/{course_id}/external-sources", status_code=202)
def import_external_course_source(course_id: str, payload: ExternalSourceRequest) -> dict[str, Any]:
    try:
        load_workspace(course_id, refresh_materials=False)
        return submit_external_source(
            course_id,
            payload.url,
            server_id=payload.mcp_server_id,
            tool_name=payload.tool_name,
            source_type=payload.source_type,
        )
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (ValueError, KeyError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/api/courses/{course_id}/external-sources/{source_id}")
def external_course_source(course_id: str, source_id: str) -> dict[str, Any]:
    try:
        return get_external_source(course_id, source_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/courses/{course_id}/external-sources/{source_id}/approve")
def approve_external_course_source(course_id: str, source_id: str) -> dict[str, Any]:
    try:
        return approve_external_source(course_id, source_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.post("/api/courses/{course_id}/external-sources/{source_id}/dismiss")
def dismiss_external_course_source(course_id: str, source_id: str) -> dict[str, Any]:
    try:
        return dismiss_external_source(course_id, source_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@app.delete("/api/courses/{course_id}", response_model=ArchiveItemResponse)
def archive_course(course_id: str) -> ArchiveItemResponse:
    with get_connection() as connection:
        purge_expired_archive_items(connection)
        course = connection.execute(
            """
            SELECT id, name, exam_date, target_score, daily_hours, progress, created_at
            FROM courses
            WHERE id = ?
            """,
            (course_id,),
        ).fetchone()
        if course is not None:
            plan_tasks = connection.execute(
                """
                SELECT id, course_id, title, duration, progress, priority, status
                FROM plan_tasks
                WHERE course_id = ?
                """,
                (course_id,),
            ).fetchall()
            archive_item = create_archive_item(
                connection,
                item_type="course",
                entity_id=course_id,
                title=course["name"],
                course_id=course_id,
                course_name=course["name"],
                payload={
                    "storage": "database",
                    "course": dict(course),
                    "planTasks": [dict(task) for task in plan_tasks],
                },
            )
            connection.execute("DELETE FROM plan_tasks WHERE course_id = ?", (course_id,))
            connection.execute("DELETE FROM courses WHERE id = ?", (course_id,))
            return archive_item

    try:
        workspace = load_workspace()
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="课程不存在") from error

    workspace_course = workspace.get("course", {})
    if workspace_course.get("id") != course_id:
        raise HTTPException(status_code=404, detail="课程不存在")

    with get_connection() as connection:
        archive_item = create_archive_item(
            connection,
            item_type="course",
            entity_id=course_id,
            title=workspace_course.get("name", "未命名课程"),
            course_id=course_id,
            course_name=workspace_course.get("name"),
            payload={
                "storage": "workspace",
                "workspace": workspace,
            },
        )
        workspace["course"] = {
            **workspace_course,
            "archivedAt": archive_item.deleted_at,
        }
        save_workspace(workspace)
    return archive_item


@app.get("/api/courses/{course_id}/plan", response_model=list[PlanTaskResponse])
def get_course_plan(course_id: str) -> list[PlanTaskResponse]:
    with get_connection() as connection:
        course = connection.execute(
            "SELECT id FROM courses WHERE id = ?",
            (course_id,),
        ).fetchone()
        if course is None:
            raise HTTPException(status_code=404, detail="课程不存在")
        rows = connection.execute(
            """
            SELECT id, course_id, title, duration, progress, priority, status
            FROM plan_tasks
            WHERE course_id = ?
            ORDER BY priority DESC, title ASC
            """,
            (course_id,),
        ).fetchall()
    return [PlanTaskResponse(**dict(row)) for row in rows]


@app.post("/api/model-profiles/test", response_model=ModelProfileTestResponse)
def test_model_profile(payload: ModelProfileTestRequest) -> ModelProfileTestResponse:
    base_url = payload.base_url.strip().rstrip("/")
    parsed_url = urlparse(base_url)
    if parsed_url.scheme not in ("http", "https") or not parsed_url.netloc:
        raise HTTPException(status_code=422, detail="Base URL 必须是合法的 HTTP 或 HTTPS 地址")

    api_key = payload.api_key.strip() or get_runtime_model_api_key()
    if not api_key:
        return ModelProfileTestResponse(
            success=False,
            message="请先填写 API Key 或保存本机 API Key",
        )

    try:
        available_models = fetch_available_model_ids(base_url, api_key)
        selected_model = payload.model.strip()
        if selected_model and available_models and selected_model not in available_models:
            return ModelProfileTestResponse(
                success=False,
                message="连接成功，但当前模型不在可用列表中",
                available_models=available_models,
            )
        model_count = len(available_models)
        message = f"连接成功，已读取 {model_count} 个可用模型" if model_count else "连接成功，但未读取到可用模型列表"
        return ModelProfileTestResponse(
            success=True,
            message=message,
            available_models=available_models,
        )
    except HTTPError as error:
        return ModelProfileTestResponse(
            success=False,
            message=f"模型服务返回 HTTP {error.code}，请检查 API Key 和服务地址",
        )
    except URLError:
        return ModelProfileTestResponse(
            success=False,
            message="无法连接模型服务，请检查 Base URL、网络或本地代理",
        )
    except TimeoutError:
        return ModelProfileTestResponse(
            success=False,
            message="连接超时，请检查服务是否可用",
        )
    except ValueError:
        return ModelProfileTestResponse(
            success=False,
            message="模型服务返回内容无法解析，请确认 /models 接口兼容 OpenAI 格式",
        )


@app.get("/api/runtime-model")
def runtime_model() -> dict[str, str | bool | list[str]]:
    return get_runtime_model_profile()


@app.put("/api/runtime-model")
def update_runtime_model(payload: RuntimeModelUpdateRequest) -> dict[str, str | bool | list[str]]:
    base_url = payload.base_url.strip().rstrip("/")
    parsed_url = urlparse(base_url)
    if parsed_url.scheme not in ("http", "https") or not parsed_url.netloc:
        raise HTTPException(status_code=422, detail="Base URL 必须是合法的 HTTP 或 HTTPS 地址")
    if not payload.api_key.strip() and not get_runtime_model_api_key():
        raise HTTPException(status_code=422, detail="请先填写 API Key")
    return save_runtime_model_profile(base_url, payload.api_key, payload.model)


@app.get("/api/knowledge/status")
def knowledge_status() -> dict[str, Any]:
    return get_knowledge_status("engineering-economics")


@app.get("/api/courses/{course_id}/knowledge/status")
def course_knowledge_status(course_id: str) -> dict[str, Any]:
    return get_knowledge_status(course_id)


@app.post("/api/courses/{course_id}/knowledge/reindex")
def reindex_course_knowledge(course_id: str) -> dict[str, Any]:
    try:
        sync_course_knowledge(course_id)
        return rebuild_course_embeddings(course_id)
    except (RuntimeError, HTTPError, URLError, TimeoutError, OSError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/knowledge/embedding")
def embedding_status() -> dict[str, Any]:
    return get_embedding_status()


@app.put("/api/knowledge/embedding")
def update_embedding_config(payload: EmbeddingConfigRequest) -> dict[str, Any]:
    try:
        return save_embedding_config(
            {
                "enabled": payload.enabled,
                "baseUrl": payload.base_url,
                "model": payload.model,
            }
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/knowledge/embedding/test")
def test_saved_embedding() -> dict[str, Any]:
    return test_embedding_connection()


@app.post("/api/knowledge/embedding/reindex")
def reindex_knowledge() -> dict[str, Any]:
    try:
        sync_course_knowledge("engineering-economics")
        return rebuild_course_embeddings("engineering-economics")
    except (RuntimeError, HTTPError, URLError, TimeoutError, OSError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/engineering-economics/workspace")
def engineering_workspace() -> dict[str, Any]:
    try:
        return load_workspace()
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/engineering-economics/setup/draft")
def create_engineering_draft_workspace() -> dict[str, Any]:
    return create_empty_course_workspace()


@app.post("/api/engineering-economics/setup")
def save_engineering_course_setup(payload: CourseSetupRequest) -> dict[str, Any]:
    try:
        return save_course_setup(payload.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/api/engineering-economics/diagnostic/submit")
def submit_engineering_course_diagnostic(payload: DiagnosticSubmitRequest) -> dict[str, Any]:
    try:
        return submit_course_diagnostic(payload.answers)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/engineering-economics/materials/preview/{material_path:path}")
def preview_engineering_material(material_path: str) -> dict[str, Any]:
    try:
        return build_material_preview(material_path)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/engineering-economics/materials/file/{material_path:path}")
def open_engineering_material(material_path: str) -> FileResponse:
    try:
        file_path = resolve_course_material_path(material_path)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    return FileResponse(
        file_path,
        media_type=media_type,
        filename=file_path.name,
        content_disposition_type="inline",
    )


@app.get("/api/engineering-economics/materials/converted-file/{material_path:path}")
def open_converted_engineering_material(material_path: str) -> FileResponse:
    try:
        file_path = resolve_converted_material_pdf_path(material_path)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=f"{Path(material_path).stem}.pdf",
        content_disposition_type="inline",
    )


@app.post("/api/engineering-economics/materials/upload")
async def upload_engineering_material(filename: str, request: FastAPIRequest) -> dict[str, Any]:
    try:
        content = await request.body()
        return upload_course_material(filename, content)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/engineering-economics/materials/upload-batch")
async def upload_engineering_material_batch(request: FastAPIRequest) -> dict[str, Any]:
    try:
        payload = await request.body()
        header_end = payload.find(b"\n")
        if header_end <= 0:
            raise ValueError("批量上传数据格式无效")
        manifest_length = int(payload[:header_end].decode("ascii"))
        manifest_start = header_end + 1
        manifest_end = manifest_start + manifest_length
        manifest = json.loads(payload[manifest_start:manifest_end].decode("utf-8"))
        if not isinstance(manifest, list):
            raise ValueError("批量上传清单格式无效")

        files: list[tuple[str, bytes]] = []
        offset = manifest_end
        for item in manifest:
            if not isinstance(item, dict):
                raise ValueError("批量上传清单格式无效")
            filename = item.get("name")
            size = item.get("size")
            if not isinstance(filename, str) or not isinstance(size, int) or size < 0:
                raise ValueError("批量上传清单字段无效")
            next_offset = offset + size
            if next_offset > len(payload):
                raise ValueError("批量上传文件内容不完整")
            files.append((filename, payload[offset:next_offset]))
            offset = next_offset
        if offset != len(payload):
            raise ValueError("批量上传数据长度不匹配")
        return upload_course_materials(files)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.delete("/api/engineering-economics/materials/{material_path:path}")
def delete_engineering_material(material_path: str) -> dict[str, Any]:
    try:
        return delete_course_material(material_path)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/engineering-economics/materials/rescan")
def rescan_engineering_materials() -> dict[str, Any]:
    try:
        return refresh_workspace_materials(force_reparse=True)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.put("/api/engineering-economics/workspace")
def update_engineering_workspace(payload: WorkspaceUpdateRequest) -> dict[str, Any]:
    try:
        return update_workspace_state(
            tasks=payload.tasks,
            wrong_answers=payload.wrong_answers,
            note=payload.note,
        )
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.delete(
    "/api/engineering-economics/wrong-answers/{wrong_answer_id}",
    response_model=WrongAnswerArchiveResponse,
)
def archive_wrong_answer(wrong_answer_id: str) -> WrongAnswerArchiveResponse:
    return _archive_course_wrong_answer("engineering-economics", wrong_answer_id)


@app.get("/api/archive", response_model=list[ArchiveItemResponse])
def list_archive() -> list[ArchiveItemResponse]:
    with get_connection() as connection:
        return list_active_archive_items(connection)


@app.post("/api/archive/{archive_id}/restore")
def restore_archive_item(archive_id: str) -> dict[str, Any]:
    with get_connection() as connection:
        purge_expired_archive_items(connection)
        row = connection.execute(
            "SELECT * FROM archived_items WHERE id = ?",
            (archive_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="归档内容不存在或已超过 7 天")

        payload = json.loads(row["payload"])
        item_type = row["item_type"]
        if item_type == "course":
            if payload.get("storage") == "workspace":
                workspace = payload["workspace"]
                restored_course_id = str(workspace.get("course", {}).get("id", ""))
                save_workspace(workspace, restored_course_id)
                course = course_payload_to_response(workspace["course"])
                connection.execute("DELETE FROM archived_items WHERE id = ?", (archive_id,))
                return {
                    "item_type": item_type,
                    "course": course.model_dump(),
                    "workspace": workspace,
                    "archive_items": [item.model_dump() for item in list_active_archive_items(connection)],
                }

            course_payload = payload["course"]
            connection.execute(
                """
                INSERT OR REPLACE INTO courses (
                    id, name, exam_date, target_score, daily_hours, progress, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    course_payload["id"],
                    course_payload["name"],
                    course_payload["exam_date"],
                    course_payload["target_score"],
                    course_payload["daily_hours"],
                    course_payload.get("progress", 0),
                    course_payload.get("created_at", datetime.now().isoformat(timespec="seconds")),
                ),
            )
            connection.execute("DELETE FROM plan_tasks WHERE course_id = ?", (course_payload["id"],))
            connection.executemany(
                """
                INSERT OR REPLACE INTO plan_tasks (
                    id, course_id, title, duration, progress, priority, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        task["id"],
                        task["course_id"],
                        task["title"],
                        task["duration"],
                        task.get("progress", 0),
                        task["priority"],
                        task["status"],
                    )
                    for task in payload.get("planTasks", [])
                ],
            )
            connection.execute("DELETE FROM archived_items WHERE id = ?", (archive_id,))
            return {
                "item_type": item_type,
                "course": course_payload_to_response(course_payload).model_dump(),
                "archive_items": [item.model_dump() for item in list_active_archive_items(connection)],
            }

        if item_type == "wrong-answer":
            course_id = str(row["course_id"] or "")
            if not course_id:
                raise HTTPException(status_code=422, detail="归档错题缺少课程信息")
            try:
                workspace = load_workspace(course_id)
            except FileNotFoundError as error:
                raise HTTPException(status_code=404, detail=str(error)) from error

            wrong_answer = payload["wrongAnswer"]
            wrong_answers = workspace.setdefault("wrongAnswers", [])
            if not any(item.get("id") == wrong_answer.get("id") for item in wrong_answers):
                workspace["wrongAnswers"] = [wrong_answer, *wrong_answers]
            save_workspace(workspace, course_id)
            connection.execute("DELETE FROM archived_items WHERE id = ?", (archive_id,))
            return {
                "item_type": item_type,
                "workspace": workspace,
                "archive_items": [item.model_dump() for item in list_active_archive_items(connection)],
            }

    raise HTTPException(status_code=422, detail="归档类型暂不支持恢复")


@app.post("/api/engineering-economics/bootstrap")
def bootstrap_engineering(
    payload: EngineeringBootstrapRequest,
) -> dict[str, Any]:
    if payload.target_score != 80 or payload.daily_hours != 2 or payload.days != 3:
        raise HTTPException(
            status_code=422,
            detail="当前工程经济学冲刺方案固定为 3 天、每天 2 小时、目标 80+",
        )
    return bootstrap_engineering_workspace(force=payload.force)


@app.post("/api/engineering-economics/practice/answer")
def answer_engineering_practice(payload: PracticeAnswerRequest) -> dict[str, Any]:
    try:
        return submit_practice_answer(payload.question_id, payload.answer_index, payload.mode)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/engineering-economics/wrong-answers/{wrong_answer_id}/retry")
def retry_engineering_wrong_answer(wrong_answer_id: str, payload: WrongAnswerRetryRequest) -> dict[str, Any]:
    try:
        return submit_wrong_answer_retry(wrong_answer_id, payload.answer_index)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/engineering-economics/mock/submit")
def submit_engineering_mock(payload: MockSubmitRequest) -> dict[str, Any]:
    try:
        return submit_mock_answers(payload.answers)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/api/engineering-economics/agent/chat")
def chat_with_engineering_agent(payload: AgentChatRequest) -> dict[str, Any]:
    try:
        return agent_chat(payload.message.strip())
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
