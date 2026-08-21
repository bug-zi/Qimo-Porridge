from __future__ import annotations

import ipaddress
import json
import os
import queue
import re
import shutil
import socket
import sqlite3
import subprocess
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen


DATA_DIRECTORY = Path(__file__).resolve().parent.parent / "data"
DATABASE_PATH = DATA_DIRECTORY / "exam_booster.db"
MCP_PROTOCOL_VERSION = "2025-11-25"
MCP_STDIO_TIMEOUT_SECONDS = 120
ALLOWED_STDIO_COMMANDS = {"npx", "npx.cmd", "node", "node.exe", "bunx", "bunx.cmd", "uvx", "uvx.exe"}
MCP_PRESETS = (
    {
        "id": "mcp-arxiv",
        "name": "arXiv MCP",
        "transport": "stdio",
        "command": "uvx",
        "args": ["arxiv-mcp-server"],
        "allowedTools": ["get_abstract", "read_paper"],
    },
    {
        "id": "mcp-firecrawl",
        "name": "Firecrawl MCP",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "firecrawl-mcp"],
        "allowedTools": ["firecrawl_scrape"],
    },
    {
        "id": "mcp-gitmcp",
        "name": "GitMCP（GitHub）",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "mcp-remote", "https://gitmcp.io/idosal/git-mcp"],
        "allowedTools": ["fetch_repository_documentation", "fetch_generic_url_content"],
    },
    {
        "id": "mcp-bilibili",
        "name": "Bilibili MCP",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@xzxzzx/bilibili-mcp@latest"],
        "allowedTools": ["get_video_info", "get_video_transcript", "get_video_metadata"],
    },
    {
        "id": "mcp-xiaohongshu",
        "name": "小红书 MCP",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@sillyl12324/xhs-mcp@latest"],
        "allowedTools": ["xhs_get_note"],
    },
)

# 每个 stdio MCP 服务启动时需要从后端 .env 注入的环境变量（值不落库、不回显）
MCP_ENV_INJECTIONS: dict[str, list[str]] = {
    "mcp-bilibili": ["BILIBILI_SESSDATA", "BILIBILI_BILI_JCT", "BILIBILI_DEDEUSERID"],
    "mcp-firecrawl": ["FIRECRAWL_API_KEY"],
    "mcp-xiaohongshu": ["XHS_COOKIE"],
}
BILIBILI_CREDENTIAL_FIELDS = {
    "sessdata": ("BILIBILI_SESSDATA", 512),
    "bili_jct": ("BILIBILI_BILI_JCT", 64),
    "dedeuserid": ("BILIBILI_DEDEUSERID", 32),
}


def _read_backend_env_value(name: str) -> str:
    value = os.getenv(name, "").strip()
    if value:
        return value
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, raw_value = stripped.split("=", 1)
        if key.strip() == name:
            return raw_value.strip().strip('"').strip("'")
    return ""


def _write_backend_env_values(updates: dict[str, str | None]) -> None:
    """把若干变量写入后端 .env；值为 None 表示删除该行。保留原有注释与顺序。"""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
    remaining = dict(updates)
    rewritten: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in remaining:
                value = remaining.pop(key)
                if value is not None:
                    rewritten.append(f"{key}={value}")
                continue
        rewritten.append(line)
    for key, value in remaining.items():
        if value is not None:
            rewritten.append(f"{key}={value}")
    env_path.write_text("\n".join(rewritten) + "\n", encoding="utf-8")


@contextmanager
def _connection() -> Iterator[sqlite3.Connection]:
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


def validate_public_source_url(url: str) -> str:
    normalized = url.strip()
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("外部资料网址必须是公开的 HTTP 或 HTTPS 地址")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
    except OSError as error:
        raise ValueError("无法解析外部资料网址") from error
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
            raise ValueError("外部资料网址不能指向本机或内网地址")
    return normalized


def _validate_stdio_command(command: str, args: list[str]) -> tuple[str, list[str]]:
    normalized_command = command.strip()
    command_name = Path(normalized_command).name.lower()
    if command_name not in ALLOWED_STDIO_COMMANDS:
        raise ValueError("stdio MCP 仅允许使用 npx、node、bunx 或 uvx 启动")
    normalized_args = [str(item).strip() for item in args if str(item).strip()]
    if len(normalized_args) > 20 or any(len(item) > 500 for item in normalized_args):
        raise ValueError("stdio MCP 启动参数过多或过长")
    return normalized_command, normalized_args


def save_mcp_server(
    name: str,
    endpoint: str,
    allowed_tools: list[str],
    server_id: str = "",
    *,
    transport: str = "http",
    command: str = "",
    args: list[str] | None = None,
) -> dict[str, Any]:
    normalized_transport = transport.strip().lower()
    normalized_endpoint = endpoint.strip()
    normalized_command = command.strip()
    normalized_args = list(args or [])
    if normalized_transport == "http":
        parsed = urlparse(normalized_endpoint)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("MCP 服务地址无效")
        normalized_command = ""
        normalized_args = []
    elif normalized_transport == "stdio":
        normalized_command, normalized_args = _validate_stdio_command(normalized_command, normalized_args)
        normalized_endpoint = ""
    else:
        raise ValueError("MCP 传输方式仅支持 http 或 stdio")
    normalized_tools = list(dict.fromkeys(tool.strip() for tool in allowed_tools if tool.strip()))
    if not normalized_tools:
        raise ValueError("至少需要授权一个 MCP 工具")
    resolved_id = server_id or f"mcp-{uuid.uuid4().hex}"
    from .agent_runtime import initialize_agent_database

    initialize_agent_database()
    from datetime import datetime

    timestamp = datetime.now().isoformat(timespec="seconds")
    with _connection() as connection:
        connection.execute(
            """
            INSERT INTO mcp_servers (
                id, name, endpoint, transport, command, args_json,
                enabled, allowed_tools_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                endpoint = excluded.endpoint,
                transport = excluded.transport,
                command = excluded.command,
                args_json = excluded.args_json,
                allowed_tools_json = excluded.allowed_tools_json,
                updated_at = excluded.updated_at
            """,
            (
                resolved_id,
                name.strip(),
                normalized_endpoint,
                normalized_transport,
                normalized_command,
                json.dumps(normalized_args, ensure_ascii=False),
                json.dumps(normalized_tools, ensure_ascii=False),
                timestamp,
                timestamp,
            ),
        )
    return get_mcp_server(resolved_id)


def seed_mcp_presets() -> None:
    from .agent_runtime import initialize_agent_database

    initialize_agent_database()
    from datetime import datetime

    timestamp = datetime.now().isoformat(timespec="seconds")
    with _connection() as connection:
        for preset in MCP_PRESETS:
            connection.execute(
                """
                INSERT OR IGNORE INTO mcp_servers (
                    id, name, endpoint, transport, command, args_json, tools_json,
                    enabled, allowed_tools_json, created_at, updated_at
                ) VALUES (?, ?, '', ?, ?, ?, '[]', 1, ?, ?, ?)
                """,
                (
                    preset["id"],
                    preset["name"],
                    preset["transport"],
                    preset["command"],
                    json.dumps(preset["args"], ensure_ascii=False),
                    json.dumps(preset["allowedTools"], ensure_ascii=False),
                    timestamp,
                    timestamp,
                ),
            )
            if preset["id"] == "mcp-arxiv":
                connection.execute(
                    """
                    UPDATE mcp_servers
                    SET allowed_tools_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (json.dumps(preset["allowedTools"], ensure_ascii=False), timestamp, preset["id"]),
                )


def get_mcp_server(server_id: str) -> dict[str, Any]:
    from .agent_runtime import initialize_agent_database

    initialize_agent_database()
    with _connection() as connection:
        row = connection.execute("SELECT * FROM mcp_servers WHERE id = ? AND enabled = 1", (server_id,)).fetchone()
    if row is None:
        raise KeyError("MCP 服务不存在或未启用")
    return {
        "id": str(row["id"]),
        "name": str(row["name"]),
        "endpoint": str(row["endpoint"]),
        "transport": str(row["transport"]),
        "command": str(row["command"]),
        "args": json.loads(row["args_json"]),
        "tools": json.loads(row["tools_json"]),
        "allowedTools": json.loads(row["allowed_tools_json"]),
    }


def list_mcp_servers() -> list[dict[str, Any]]:
    from .agent_runtime import initialize_agent_database

    initialize_agent_database()
    with _connection() as connection:
        rows = connection.execute("SELECT id FROM mcp_servers WHERE enabled = 1 ORDER BY name").fetchall()
    return [get_mcp_server(str(row["id"])) for row in rows]


def _parse_response(body: bytes, content_type: str) -> dict[str, Any]:
    text = body.decode("utf-8").strip()
    if not text:
        return {}
    if "text/event-stream" in content_type:
        payloads = []
        for line in text.splitlines():
            if line.startswith("data:"):
                payloads.append(json.loads(line.removeprefix("data:").strip()))
        if not payloads:
            raise RuntimeError("MCP 服务没有返回可解析的事件")
        return payloads[-1]
    return json.loads(text)


class McpHttpClient:
    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint
        self.session_id = ""
        self.request_id = 0

    def _post(self, method: str, params: dict[str, Any], *, notification: bool = False) -> dict[str, Any]:
        self.request_id += 1
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notification:
            payload["id"] = self.request_id
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        request = Request(
            self.endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urlopen(request, timeout=60) as response:
            session_id = response.headers.get("Mcp-Session-Id")
            if session_id:
                self.session_id = session_id
            return _parse_response(response.read(), response.headers.get("Content-Type", ""))

    def initialize(self) -> dict[str, Any]:
        response = self._post(
            "initialize",
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "exam-booster", "version": "0.2.0"},
            },
        )
        if response.get("error"):
            raise RuntimeError(str(response["error"]))
        self._post("notifications/initialized", {}, notification=True)
        return response.get("result", {})

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.initialize()
        response = self._post("tools/call", {"name": name, "arguments": arguments})
        if response.get("error"):
            raise RuntimeError(str(response["error"]))
        result = response.get("result", {})
        if result.get("isError"):
            raise RuntimeError("MCP 工具执行失败")
        return result

    def list_tools(self) -> list[dict[str, Any]]:
        self.initialize()
        response = self._post("tools/list", {})
        if response.get("error"):
            raise RuntimeError(str(response["error"]))
        return list(response.get("result", {}).get("tools", []))

    def close(self) -> None:
        return None


class McpStdioClient:
    def __init__(self, command: str, args: list[str], env_names: list[str] | None = None) -> None:
        executable = shutil.which(command)
        if not executable:
            raise RuntimeError(f"未找到 MCP 启动命令：{command}，请先安装 Node.js 18+")
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        environment = os.environ.copy()
        injection_names = list(env_names or [])
        if "tavily" in " ".join([command, *args]).lower():
            injection_names.append("TAVILY_API_KEY")
        for name in injection_names:
            if not environment.get(name):
                value = _read_backend_env_value(name)
                if value:
                    environment[name] = value
        self.process = subprocess.Popen(
            [executable, *args],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=creation_flags,
            env=environment,
        )
        self.request_id = 0
        self.messages: queue.Queue[dict[str, Any]] = queue.Queue()
        self.stderr_lines: queue.Queue[str] = queue.Queue(maxsize=40)
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    def _read_stdout(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict):
                self.messages.put(message)

    def _read_stderr(self) -> None:
        assert self.process.stderr is not None
        for line in self.process.stderr:
            if self.stderr_lines.full():
                try:
                    self.stderr_lines.get_nowait()
                except queue.Empty:
                    pass
            self.stderr_lines.put(line.strip())

    def _request(self, method: str, params: dict[str, Any], *, notification: bool = False) -> dict[str, Any]:
        if self.process.poll() is not None:
            detail = "；".join(list(self.stderr_lines.queue)[-3:])
            raise RuntimeError(f"MCP 进程已退出{f'：{detail}' if detail else ''}")
        self.request_id += 1
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notification:
            payload["id"] = self.request_id
        assert self.process.stdin is not None
        self.process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        self.process.stdin.flush()
        if notification:
            return {}
        while True:
            try:
                response = self.messages.get(timeout=MCP_STDIO_TIMEOUT_SECONDS)
            except queue.Empty as error:
                raise RuntimeError(f"MCP 工具调用超时：{method}") from error
            if response.get("id") == self.request_id:
                return response

    def initialize(self) -> dict[str, Any]:
        response = self._request(
            "initialize",
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "exam-booster", "version": "0.2.0"},
            },
        )
        if response.get("error"):
            raise RuntimeError(str(response["error"]))
        self._request("notifications/initialized", {}, notification=True)
        return response.get("result", {})

    def list_tools(self) -> list[dict[str, Any]]:
        self.initialize()
        response = self._request("tools/list", {})
        if response.get("error"):
            raise RuntimeError(str(response["error"]))
        return list(response.get("result", {}).get("tools", []))

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.initialize()
        response = self._request("tools/call", {"name": name, "arguments": arguments})
        if response.get("error"):
            raise RuntimeError(str(response["error"]))
        result = response.get("result", {})
        if result.get("isError"):
            text, _ = extract_mcp_text(result)
            try:
                error_data = json.loads(text)
            except json.JSONDecodeError:
                error_data = None
            if isinstance(error_data, dict):
                message = str(error_data.get("message_zh") or error_data.get("message") or text)
                steps = error_data.get("next_steps_zh") or error_data.get("next_steps") or []
                if isinstance(steps, list) and steps:
                    message = f"{message}\n" + "\n".join(str(step) for step in steps)
                raise RuntimeError(message)
            raise RuntimeError(text)
        return result

    def close(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()


def _create_mcp_client(server: dict[str, Any]) -> McpHttpClient | McpStdioClient:
    if server["transport"] == "stdio":
        return McpStdioClient(server["command"], server["args"], MCP_ENV_INJECTIONS.get(server["id"], []))
    return McpHttpClient(server["endpoint"])


def discover_mcp_tools(server_id: str) -> dict[str, Any]:
    server = get_mcp_server(server_id)
    client = _create_mcp_client(server)
    try:
        tools = client.list_tools()
    finally:
        client.close()
    with _connection() as connection:
        connection.execute(
            "UPDATE mcp_servers SET tools_json = ? WHERE id = ?",
            (json.dumps(tools, ensure_ascii=False), server_id),
        )
    return get_mcp_server(server_id)


def call_mcp_tool(server_id: str, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    server = get_mcp_server(server_id)
    allowed_tools = server["allowedTools"]
    if tool_name not in allowed_tools:
        raise PermissionError(f"MCP 工具未获授权：{tool_name}")
    if server_id == "mcp-gitmcp":
        return _call_gitmcp_tool(server, tool_name, arguments)
    if server_id == "mcp-arxiv":
        return _call_arxiv_tool(server, tool_name, arguments)
    client = _create_mcp_client(server)
    try:
        return client.call_tool(tool_name, arguments)
    finally:
        client.close()


def _github_repo_remote_url(url: str) -> str:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if hostname != "github.com":
        raise ValueError("GitMCP 仅支持 github.com 仓库地址")
    path_parts = [unquote(part) for part in parsed.path.split("/") if part]
    if len(path_parts) < 2:
        raise ValueError("GitHub 地址需包含 owner/repo")
    owner = path_parts[0].strip()
    repo = path_parts[1].strip().removesuffix(".git")
    if not owner or not repo or owner.startswith(".") or repo.startswith("."):
        raise ValueError("GitHub 仓库地址无效")
    return f"https://gitmcp.io/{owner}/{repo}"


def _github_readable_content_url(url: str) -> str:
    parsed = urlparse(url)
    path_parts = [unquote(part) for part in parsed.path.split("/") if part]
    owner = path_parts[0].strip()
    repo = path_parts[1].strip().removesuffix(".git")
    if len(path_parts) >= 5 and path_parts[2] == "blob":
        branch = path_parts[3]
        file_path = "/".join(path_parts[4:])
        return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{file_path}"
    return f"https://raw.githubusercontent.com/{owner}/{repo}/HEAD/README.md"


def extract_arxiv_id(value: str) -> str:
    normalized = value.strip()
    parsed = urlparse(normalized)
    if parsed.scheme in {"http", "https"}:
        hostname = (parsed.hostname or "").lower()
        if not hostname.endswith("arxiv.org"):
            raise ValueError("arXiv MCP 仅支持 arxiv.org 地址或 arXiv 论文 ID")
        path_parts = [unquote(part) for part in parsed.path.split("/") if part]
        if len(path_parts) >= 2 and path_parts[0] in {"abs", "pdf"}:
            normalized = path_parts[1].removesuffix(".pdf")
        else:
            raise ValueError("arXiv 地址需为 /abs/{paper_id} 或 /pdf/{paper_id}")
    normalized = normalized.removesuffix(".pdf")
    if not re.fullmatch(r"(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?)", normalized):
        raise ValueError("arXiv 论文 ID 格式无效")
    return normalized


def _call_gitmcp_tool(server: dict[str, Any], tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    remote_url = str(arguments.get("_gitmcpRemoteUrl") or "").strip()
    if not remote_url:
        raise ValueError("缺少 GitMCP 仓库地址")
    client = McpStdioClient(server["command"], ["-y", "mcp-remote", remote_url])
    try:
        if tool_name == "fetch_repository_documentation":
            content_url = str(arguments.get("_gitmcpContentUrl") or "").strip()
            if not content_url:
                raise ValueError("缺少 GitHub 可读取内容地址")
            return client.call_tool("fetch_generic_url_content", {"url": content_url})
        return client.call_tool(
            tool_name,
            {key: value for key, value in arguments.items() if not key.startswith("_gitmcp")},
        )
    finally:
        client.close()


def _call_arxiv_tool(server: dict[str, Any], tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    client = _create_mcp_client(server)
    try:
        try:
            return client.call_tool(tool_name, arguments)
        except RuntimeError as error:
            if tool_name != "read_paper" or "download_paper" not in str(error):
                raise
            return client.call_tool("download_paper", arguments)
    finally:
        client.close()


def build_source_tool_arguments(server_id: str, tool_name: str, url: str) -> dict[str, Any]:
    if server_id == "mcp-arxiv":
        paper_id = extract_arxiv_id(url)
        if tool_name in {"read_paper", "get_abstract"}:
            arguments: dict[str, Any] = {"paper_id": paper_id}
            if tool_name == "read_paper":
                arguments["max_chars"] = 200_000
            return arguments
        raise ValueError(f"无法将 arXiv 资料网址映射到 MCP 工具参数：{tool_name}")
    if server_id == "mcp-firecrawl" and tool_name == "firecrawl_scrape":
        return {"url": url, "formats": ["markdown"], "onlyMainContent": True}
    if server_id == "mcp-gitmcp":
        remote_url = _github_repo_remote_url(url)
        content_url = _github_readable_content_url(url)
        if tool_name == "fetch_repository_documentation":
            return {"_gitmcpRemoteUrl": remote_url, "_gitmcpContentUrl": content_url, "_originalUrl": url}
        if tool_name == "fetch_generic_url_content":
            return {"_gitmcpRemoteUrl": remote_url, "url": content_url}
        raise ValueError(f"无法将 GitHub 资料网址映射到 MCP 工具参数：{tool_name}")
    if server_id == "mcp-bilibili":
        arguments: dict[str, Any] = {"bvid_or_url": url}
        if tool_name == "get_video_transcript":
            arguments["fallback_to_description"] = True
        return arguments
    if server_id == "mcp-xiaohongshu" and tool_name == "xhs_get_note":
        parsed = urlparse(url)
        if parsed.hostname and parsed.hostname.lower().endswith("xhslink.com"):
            request = Request(url, headers={"User-Agent": "Mozilla/5.0"}, method="GET")
            with urlopen(request, timeout=20) as response:
                expanded_url = response.geturl()
            validate_public_source_url(expanded_url)
            parsed = urlparse(expanded_url)
        path_parts = [unquote(part) for part in parsed.path.split("/") if part]
        note_id = ""
        for marker in ("explore", "discovery", "item"):
            if marker in path_parts and path_parts.index(marker) + 1 < len(path_parts):
                note_id = path_parts[path_parts.index(marker) + 1]
        if not note_id and path_parts:
            note_id = path_parts[-1]
        query = parse_qs(parsed.query)
        xsec_token = (query.get("xsec_token") or query.get("xsecToken") or [""])[0]
        if not note_id or not xsec_token:
            raise ValueError("小红书链接需为展开后的完整笔记地址，并包含 xsec_token 参数")
        return {"noteId": note_id, "xsecToken": xsec_token, "describeImages": False}

    server = get_mcp_server(server_id)
    tools = server.get("tools") or []
    tool = next((item for item in tools if item.get("name") == tool_name), None)
    properties = (tool or {}).get("inputSchema", {}).get("properties", {})
    if "url" in properties or not properties:
        return {"url": url}
    if "bvid_or_url" in properties:
        return {"bvid_or_url": url}
    raise ValueError(f"无法将资料网址映射到 MCP 工具参数：{tool_name}")


def extract_mcp_text(result: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        content = structured.get("content") or structured.get("text") or structured.get("markdown")
        if isinstance(content, str) and content.strip():
            return content.strip(), structured
    texts: list[str] = []
    for item in result.get("content", []):
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text" and isinstance(item.get("text"), str):
            texts.append(item["text"])
        resource = item.get("resource")
        if isinstance(resource, dict) and isinstance(resource.get("text"), str):
            texts.append(resource["text"])
    content = "\n\n".join(texts).strip()
    if not content:
        raise RuntimeError("MCP 工具没有返回可导入的文本内容")
    try:
        parsed_content = json.loads(content)
    except json.JSONDecodeError:
        parsed_content = None
    if isinstance(parsed_content, dict) and isinstance(parsed_content.get("content"), str):
        metadata = dict(parsed_content)
        extracted_content = str(metadata.pop("content")).strip()
        if extracted_content:
            return extracted_content, metadata
    return content, structured if isinstance(structured, dict) else {}


def get_bilibili_credential_status() -> dict[str, Any]:
    """本地快速检查：只看凭据是否配置，不回显任何 Cookie 值、不访问网络。"""
    values = {
        field: _read_backend_env_value(env_name)
        for field, (env_name, _) in BILIBILI_CREDENTIAL_FIELDS.items()
    }
    source = "app" if all(values.values()) else ""
    if not source:
        global_config = Path.home() / ".bilibili-mcp" / "config.json"
        if global_config.exists():
            try:
                parsed = json.loads(global_config.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                parsed = None
            if isinstance(parsed, dict) and all(parsed.get(key) for key in ("sessdata", "bili_jct", "dedeuserid")):
                source = "global_config"
    return {"configured": bool(source == "app"), "source": source or "none"}


def save_bilibili_credentials(sessdata: str, bili_jct: str, dedeuserid: str) -> dict[str, Any]:
    normalized = {"sessdata": sessdata.strip(), "bili_jct": bili_jct.strip(), "dedeuserid": dedeuserid.strip()}
    if not all(normalized.values()):
        raise ValueError("SESSDATA、bili_jct、DedeUserID 三个字段都不能为空")
    if not re.fullmatch(r"[0-9a-fA-F]{32}", normalized["bili_jct"]):
        raise ValueError("bili_jct 格式无效：应为 32 位十六进制字符串（CSRF token）")
    if not normalized["dedeuserid"].isdigit():
        raise ValueError("DedeUserID 格式无效：应为纯数字（你的 B 站 UID）")
    for field, (_, max_length) in BILIBILI_CREDENTIAL_FIELDS.items():
        if len(normalized[field]) > max_length:
            raise ValueError(f"{field} 长度超过上限 {max_length} 字符，请确认复制的是完整 Cookie 值")
    _write_backend_env_values(
        {env_name: normalized[field] for field, (env_name, _) in BILIBILI_CREDENTIAL_FIELDS.items()}
    )
    return get_bilibili_credential_status()


def clear_bilibili_credentials() -> dict[str, Any]:
    _write_backend_env_values({env_name: None for env_name, _ in BILIBILI_CREDENTIAL_FIELDS.values()})
    return get_bilibili_credential_status()


def verify_bilibili_credentials() -> dict[str, Any]:
    """调用 bilibili-mcp 自带的 check_bilibili_credentials 工具做真实登录校验（会启动 npx 子进程）。"""
    server = get_mcp_server("mcp-bilibili")
    client = McpStdioClient(server["command"], server["args"], MCP_ENV_INJECTIONS.get(server["id"], []))
    try:
        result = client.call_tool("check_bilibili_credentials", {})
    finally:
        client.close()
    text, _ = extract_mcp_text(result)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict):
        logged_in = parsed.get("logged_in")
        if logged_in is None:
            logged_in = parsed.get("loggedIn")
        if logged_in is None:
            logged_in = parsed.get("logged")
        steps = parsed.get("next_steps_zh") or parsed.get("next_steps") or []
        message = str(parsed.get("message_zh") or parsed.get("message") or "")
        if not message:
            # bilibili-mcp 的 check 工具只返回状态字段，不含 message；合成友好提示
            message = "B 站登录有效，凭据可用。" if logged_in else "登录无效：Cookie 已过期或未登录，请从浏览器重新获取。"
        return {
            "loggedIn": bool(logged_in) if logged_in is not None else None,
            "message": message,
            "nextSteps": [str(step) for step in steps] if isinstance(steps, list) else [],
        }
    return {"loggedIn": None, "message": text, "nextSteps": []}
