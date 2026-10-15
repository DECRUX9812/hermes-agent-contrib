"""Read-only persisted computer activity for Bot Mode."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method
_profile_scoped = _registry.profile_scoped
_OUTPUT_TAIL_BYTES = 4 * 1024
_DIFF_MAX_BYTES = 16 * 1024


@_profile_scoped
@method("fork.computer.timeline")
def fork_computer_timeline(rid, params: dict) -> dict:
    profile = str(params.get("profile") or "").strip()
    session_id = str(params.get("session_id") or "").strip()
    if not profile or not session_id:
        return _err(rid, 4002, "profile and session_id are required")
    try:
        from hermes_constants import get_hermes_home
        from hermes_state_registry import acquire, release_or_close

        db = acquire(Path(get_hermes_home()) / "state.db")
        try:
            if db.get_session(session_id) is None:
                return _err(rid, 4044, "session not found")
            messages = db.get_messages(session_id, include_ancestors=True)
            limit = min(500, max(1, int(params.get("limit") or 200)))
            steps, todos = _fork_computer_build_timeline(messages, limit)
        finally:
            release_or_close(db)
        return _ok(rid, {"session_id": session_id, "steps": steps, "todos": todos})
    except (TypeError, ValueError) as exc:
        return _err(rid, 4002, f"invalid timeline request: {exc}")
    except Exception as exc:
        logging.getLogger(__name__).exception("fork.computer.timeline failed")
        return _err(rid, 5000, f"could not read computer timeline: {exc}")


def _fork_computer_build_timeline(messages: list[dict], limit: int) -> tuple[list[dict], list[dict]]:
    result_rows = {}
    for position, message in enumerate(messages):
        if message.get("role") == "tool" and message.get("tool_call_id"):
            result_rows.setdefault(str(message["tool_call_id"]), []).append((position, message))
    calls = []
    todo_ids = set()
    try:
        from tools.todo_tool import is_todo_tool_call
    except ImportError:
        is_todo_tool_call = lambda call: False
    for position, message in enumerate(messages):
        if message.get("role") != "assistant":
            continue
        for call in message.get("tool_calls") or []:
            if not isinstance(call, dict) or not call.get("id"):
                continue
            tool_id = str(call["id"])
            call_name, args = _fork_computer_call_fields(call)
            calls.append((position, message, tool_id, call_name, args))
            if is_todo_tool_call(call):
                todo_ids.add(tool_id)

    todos = []
    candidates = []
    for position, message, tool_id, name, args in calls:
        row = next((entry for entry in result_rows.get(tool_id, []) if entry[0] > position), None)
        result_message = row[1] if row else None
        if tool_id in todo_ids and result_message is not None:
            parsed = _fork_computer_parse_json(result_message.get("content"))
            if isinstance(parsed, dict) and isinstance(parsed.get("todos"), list):
                todos = [
                    {"id": str(todo.get("id") or ""), "content": str(todo.get("content") or ""),
                     "status": str(todo.get("status") or "")}
                    for todo in parsed["todos"] if isinstance(todo, dict)
                ]
        candidates.append(_fork_computer_step(
            message, tool_id, name, args, result_message))
    selected = candidates[-limit:]
    for index, step in enumerate(selected):
        step["index"] = index
    return selected, todos


def _fork_computer_call_fields(call: dict) -> tuple[str, dict]:
    fn = call.get("function") if isinstance(call.get("function"), dict) else {}
    name = str(fn.get("name") or call.get("name") or "unknown")
    raw = fn.get("arguments", call.get("arguments"))
    args = _fork_computer_parse_json(raw)
    return name, args if isinstance(args, dict) else {}


def _fork_computer_step(message: dict, tool_id: str, name: str, args: dict,
                        result_message: dict | None) -> dict:
    kind = _fork_computer_kind(name)
    result_value = result_message.get("content") if result_message is not None else None
    result_data = _fork_computer_parse_json(result_value)
    result_data = result_data if isinstance(result_data, dict) else {}
    detail = {}
    output = _fork_computer_text(result_value)
    if output:
        detail["output_tail"] = _fork_computer_cap(output, _OUTPUT_TAIL_BYTES)
    if kind == "terminal":
        command = _fork_computer_first_text(args, result_data, keys=("command", "cmd", "script", "code"))
        if command:
            detail["command"] = command
    elif kind == "file":
        path = _fork_computer_first_text(args, result_data, keys=("path", "file_path", "filename", "target"))
        if path:
            detail["path"] = path
        diff = _fork_computer_first_text(args, result_data, keys=("diff", "inline_diff", "patch", "unified_diff"))
        if not diff and isinstance(result_value, str) and result_value.startswith(("--- ", "diff --git ")):
            diff = result_value
        if diff:
            detail["diff"] = _fork_computer_cap(diff, _DIFF_MAX_BYTES)
    elif kind == "browser":
        url = _fork_computer_first_text(args, result_data, keys=("url", "current_url", "page_url"))
        page_title = _fork_computer_first_text(result_data, args, keys=("page_title", "title"))
        screenshot = _fork_computer_first_text(
            result_data, args, keys=("screenshot_path", "screenshot", "image_path"))
        if url:
            detail["url"] = url
        if page_title:
            detail["page_title"] = page_title
        if screenshot:
            detail["screenshot_path"] = screenshot
    title = _fork_computer_title(name, kind, args, result_data, detail)
    at = _fork_computer_at(message.get("timestamp"))
    duration = None
    if result_message is not None:
        duration = _fork_computer_duration(message.get("timestamp"), result_message.get("timestamp"))
    return {
        "id": tool_id,
        "index": 0,
        "tool": name,
        "kind": kind,
        "title": title,
        "status": "running" if result_message is None else _fork_computer_status(result_value, result_data),
        "at": at,
        "duration_s": duration,
        "detail": detail,
    }


def _fork_computer_kind(name: str) -> str:
    lowered = name.lower()
    if lowered.startswith("browser_"):
        return "browser"
    if lowered in {"terminal", "execute_code", "process_manage", "process"} or lowered.startswith(
            ("terminal_", "process_")):
        return "terminal"
    if lowered.startswith(("web_", "search_")) or lowered == "search":
        return "search"
    file_ops = ("write", "edit", "patch", "replace")
    tokens = lowered.replace("-", "_").split("_")
    if lowered in {"apply_patch", "str_replace_editor", "file_write", "file_edit", "file_patch"} or (
            any(token in file_ops for token in tokens) and ("file" in tokens or tokens[0] in file_ops)):
        return "file"
    return "other"


def _fork_computer_title(name: str, kind: str, args: dict, result_data: dict, detail: dict) -> str:
    if kind == "terminal":
        command = detail.get("command")
        return f"Ran {command.splitlines()[0]}"[:120] if command else "Ran a terminal command"
    if kind == "file":
        path = detail.get("path")
        verb = "Wrote" if "write" in name.lower() else "Edited"
        return f"{verb} {path}"[:120] if path else f"{verb} a file"
    if kind == "browser":
        url = detail.get("url")
        host = urlsplit(url).netloc if url else ""
        return f"Opened {host or url}"[:120] if url else "Opened a browser page"
    if kind == "search":
        query = _fork_computer_first_text(args, result_data, keys=("query", "q"))
        return f"Searched {query}"[:120] if query else "Searched the web"
    return f"Used {name.replace('_', ' ')}"[:120]


def _fork_computer_first_text(*sources: dict, keys: tuple[str, ...]) -> str | None:
    for source in sources:
        for key in keys:
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _fork_computer_parse_json(value):
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return None
    return None


def _fork_computer_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return str(value)


def _fork_computer_cap(value: str, limit: int) -> str:
    raw = value.encode("utf-8", errors="replace")
    if len(raw) <= limit:
        return value
    return raw[-limit:].decode("utf-8", errors="ignore")


def _fork_computer_status(result, data: dict) -> str:
    if data.get("success") is False or data.get("ok") is False or data.get("error"):
        return "error"
    if isinstance(result, str) and result.lstrip().lower().startswith(("error:", "failed:")):
        return "error"
    return "done"


def _fork_computer_at(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, UTC).isoformat()
    return str(value)


def _fork_computer_duration(start, end) -> float | None:
    first, last = _fork_computer_timestamp(start), _fork_computer_timestamp(end)
    if first is None or last is None or last < first:
        return None
    return round(last - first, 3)


def _fork_computer_timestamp(value) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    try:
        return float(value)
    except ValueError:
        try:
            return datetime.fromisoformat(value).timestamp()
        except ValueError:
            return None


def register(server) -> None:
    bind_module(globals(), server)
