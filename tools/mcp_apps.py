"""MCP Apps host support — the backend half of rendering an MCP server's own UI.

MCP Apps (modelcontextprotocol/ext-apps) lets a tool name a ``ui://`` HTML resource in
``_meta.ui.resourceUri``; the host renders it in a sandboxed iframe and the app talks back over
JSON-RPC (``tools/call``, ``resources/read``, ``ui/message`` ...). OpenAI's MCP Extensions
(docs/desktop-mcp-apps-host-proposal.md) layer entrypoints, settings and forms on the same
metadata. This module is the host's view of that metadata over the live MCP connections:

- which tools carry an app (``list_apps``) and which are app-only (``model_visible`` — a tool
  whose ``_meta.ui.visibility`` omits ``"model"`` never enters the model's tool schema);
- the app's HTML (``read_ui``: ``ui://`` only, size-capped);
- tool calls the APP makes (``call_app_tool``): same server only, the tool must list ``"app"``
  in its visibility, and write-capable calls on a ``trust: untrusted`` server are refused
  (an app click has no turn to ask approval in — fail closed).

Nothing here is a model tool; the gateway exposes it as ``mcp_apps.*`` RPC for the Desktop.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any, Dict, Optional

from tools.mcp_tool_common import _core, mcp_field

logger = logging.getLogger(__name__)

UI_SCHEME = "ui://"
MAX_UI_BYTES = 5 * 1024 * 1024
MAX_APP_RESULT_CHARS = 2 * 1024 * 1024
_DEFAULT_VISIBILITY = ("model", "app")
APP_MIME_TYPE = "text/html;profile=mcp-app"
# ``initialize`` client capability (SEP-2133 extensions): servers that branch on
# ``client_supports_apps`` send their UI metadata and app resources only when this is present.
CLIENT_EXTENSIONS = {"io.modelcontextprotocol/ui": {"mimeTypes": [APP_MIME_TYPE]}}


def _tool_meta(tool: Any) -> dict:
    meta = mcp_field(tool, "meta", "_meta")
    return meta if isinstance(meta, dict) else {}


def tool_ui(tool: Any) -> dict:
    """The tool's app descriptor: ``{resourceUri, visibility, entrypoints}`` — ``{}`` when the
    tool has no UI. Reads ``_meta.ui`` (MCP Apps) and the legacy ``openai/outputTemplate`` /
    ``ui/resourceUri`` keys earlier Apps SDK servers still emit."""
    meta = _tool_meta(tool)
    ui = meta.get("ui") if isinstance(meta.get("ui"), dict) else {}
    uri = ui.get("resourceUri") or meta.get("ui/resourceUri") or meta.get("openai/outputTemplate")
    visibility = ui.get("visibility")
    visibility = tuple(v for v in visibility if isinstance(v, str)) if isinstance(visibility, list) else None
    openai_ui = meta.get("openai/ui") if isinstance(meta.get("openai/ui"), dict) else {}
    entrypoints = [e for e in openai_ui.get("entrypoints") or [] if isinstance(e, dict) and e.get("type")]
    if not (isinstance(uri, str) and uri.startswith(UI_SCHEME)) and visibility is None:
        return {}
    out: Dict[str, Any] = {"visibility": list(visibility or _DEFAULT_VISIBILITY)}
    if isinstance(uri, str) and uri.startswith(UI_SCHEME):
        out["resourceUri"] = uri
    if entrypoints:
        out["entrypoints"] = entrypoints
    return out


def model_visible(tool: Any) -> bool:
    """False only for a tool whose declared visibility omits ``"model"`` (app-only helpers such
    as a settings writer or a mention search). Undeclared visibility means both."""
    return "model" in (tool_ui(tool).get("visibility") or _DEFAULT_VISIBILITY)


def _visible_servers() -> list[tuple[str, Any]]:
    """``(server_name, server)`` for live connections visible from the current profile scope."""
    from tools.mcp_tool_scope import _key_name
    scope = _core._mcp_registry_scope()
    with _core._lock:
        items = list(_core._servers.items())
    return [(_key_name(key), server) for key, server in items if _core._server_visible_in_scope(key, scope)]


def list_apps() -> list[dict]:
    """Every tool with an app on the connected servers, with the registry name the model sees
    (``None`` for app-only tools)."""
    from tools.mcp_tool_schema import mcp_prefixed_tool_name
    apps = []
    for server_name, server in _visible_servers():
        for tool in list(getattr(server, "_tools", None) or []):
            ui = tool_ui(tool)
            if not ui.get("resourceUri"):
                continue
            annotations = mcp_field(tool, "annotations", "annotations")
            title = (mcp_field(tool, "title", "title") or getattr(annotations, "title", None) or tool.name)
            icons = mcp_field(tool, "icons", "icons") or []
            apps.append({
                "server": server_name, "tool": tool.name, "title": str(title),
                "description": str(tool.description or ""),
                "registry_name": mcp_prefixed_tool_name(server_name, tool.name) if model_visible(tool) else None,
                "icons": [_jsonable(i) for i in icons], **ui,
            })
    return apps


def app_for_registry_name(name: str) -> Optional[dict]:
    """The app behind a model-visible MCP tool name (``mcp__server__tool``), or None. Cheap enough
    per tool completion: a scan of the connected servers' tool lists."""
    if not name.startswith("mcp__"):
        return None
    for app in list_apps():
        if app.get("registry_name") == name:
            return {k: app[k] for k in ("server", "tool", "resourceUri", "title")}
    return None


def _jsonable(value: Any) -> Any:
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        return dump(mode="json", by_alias=True, exclude_none=True)
    return value


def _find_tool(server: Any, tool_name: str) -> Any:
    return next((t for t in (getattr(server, "_tools", None) or []) if t.name == tool_name), None)


def _connected(server_name: str):
    from tools import mcp_tool_discovery as _discovery
    server = _discovery._get_connected_server_for_call(server_name)
    if server is None or server.session is None:
        raise LookupError(f"MCP server '{server_name}' is not connected")
    return server


def _run(server_name: str, server: Any, op: str, coro_factory, timeout: float = 60, *,
         side_effects: bool = False) -> Any:
    """Run on the MCP loop with the model path's auth / session-expiry recovery; a call that may
    have side effects is never replayed after a session expiry."""
    from functools import partial

    from tools import mcp_tool_loop as _loop
    from tools.mcp_tool_handlers import _handle_auth_error_and_retry, _handle_session_expired_and_retry
    call_once = lambda: _loop._run_on_mcp_loop(coro_factory, timeout=timeout)  # noqa: E731
    session_expired = partial(_handle_session_expired_and_retry, call_may_have_side_effects=side_effects)
    try:
        return call_once()
    except Exception as exc:
        for recover in (_handle_auth_error_and_retry, session_expired):
            recovered = recover(server_name, exc, call_once, op)
            if recovered is not None:
                return recovered
        raise


def read_ui(server_name: str, uri: str) -> dict:
    """The app document behind a ``ui://`` URI: ``{uri, mimeType, html, meta}`` where ``meta`` is
    the content item's ``_meta`` (``ui.csp``, ``ui.prefersBorder``, ``openai/ui`` display modes)."""
    if not isinstance(uri, str) or not uri.startswith(UI_SCHEME):
        raise ValueError("only ui:// resources can be rendered as apps")
    server = _connected(server_name)

    async def _read():
        async with server._rpc_lock:
            return await server.session.read_resource(uri)

    result = _run(server_name, server, f"resources/read {uri}", _read)
    if isinstance(result, str):  # a recoverer's tool_error text
        raise RuntimeError(json.loads(result).get("error", result))
    for item in getattr(result, "contents", None) or []:
        text = getattr(item, "text", None)
        if text is None and getattr(item, "blob", None) is not None:
            text = base64.b64decode(item.blob).decode("utf-8", errors="replace")
        if text is None:
            continue
        if len(text.encode("utf-8")) > MAX_UI_BYTES:
            raise ValueError(f"app document exceeds {MAX_UI_BYTES} bytes")
        meta = mcp_field(item, "meta", "_meta")
        return {"uri": str(getattr(item, "uri", uri)), "mimeType": mcp_field(item, "mime_type", "mimeType") or "",
                "html": text, "meta": meta if isinstance(meta, dict) else {}}
    raise LookupError(f"'{uri}' returned no document")


def call_app_tool(server_name: str, tool_name: str, arguments: Optional[dict] = None) -> dict:
    """A ``tools/call`` originated by an app iframe. Returns the full ``CallToolResult`` as JSON
    (``content``, ``structuredContent``, ``isError``, ``_meta``) — the app renders it; nothing
    reaches the transcript or the model."""
    from tools.mcp_tool_handlers import _call_tool_racing_stdio_death, _tool_is_read_only
    from tools.mcp_tool_scope import _server_key

    server = _connected(server_name)
    tool = _find_tool(server, tool_name)
    if tool is None:
        raise LookupError(f"tool '{tool_name}' is not on MCP server '{server_name}'")
    if "app" not in (tool_ui(tool).get("visibility") or _DEFAULT_VISIBILITY):
        raise PermissionError(f"tool '{tool_name}' is not callable from its app (visibility excludes 'app')")
    trust = _core._server_trust_levels.get(_server_key(server_name), _core._TRUST_FULL)
    if trust == _core._TRUST_UNTRUSTED and not _tool_is_read_only(server_name, tool_name):
        raise PermissionError(f"'{tool_name}' may modify external state and '{server_name}' is untrusted; "
                              "ask the agent to run it so you can approve it")
    args = arguments if isinstance(arguments, dict) else {}

    async def _call():
        async with server._rpc_lock:
            return await _call_tool_racing_stdio_death(server, server_name, tool_name, args)

    result = _run(server_name, server, f"tools/call {tool_name}", _call, timeout=300,
                  side_effects=not _tool_is_read_only(server_name, tool_name))
    if isinstance(result, str):
        raise RuntimeError(json.loads(result).get("error", result))
    payload = _jsonable(result)
    if len(json.dumps(payload, ensure_ascii=False, default=str)) > MAX_APP_RESULT_CHARS:
        raise ValueError("tool result too large for an app")
    return payload

