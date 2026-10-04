"""MCP Apps contracts (``tui_gateway/methods_mcp_apps.py``): the Desktop's door to
``tools/mcp_apps.py`` — which connected MCP tools carry a ``ui://`` app, the app document, and
tool calls the app iframe makes. Profile-scoped by ``profile`` or the owning ``session_id``."""

from __future__ import annotations

from .base import JsonValue, Params, Result
from .common import OpenModel
from .registry import method


class _AppScoped(Params):
    profile: str | None = None
    session_id: str | None = None


class McpApp(OpenModel):
    """A tool with an app. ``registry_name`` is the model-facing tool name, ``None`` for an
    app-only tool (callable from its UI, never by the model)."""

    server: str
    tool: str
    title: str
    description: str = ""
    registry_name: str | None = None
    resourceUri: str
    visibility: list[str]
    entrypoints: list[JsonValue] = []
    icons: list[JsonValue] = []


class McpAppsListResult(Result):
    apps: list[McpApp]


method("mcp_apps.list", params=_AppScoped, result=McpAppsListResult,
       doc="Tools on the connected MCP servers that carry an MCP App (``_meta.ui.resourceUri``).")


class McpAppsReadUiParams(_AppScoped):
    server: str
    uri: str


class McpAppsReadUiResult(Result):
    """``meta`` is the content item's ``_meta`` (``ui.csp``, ``ui.prefersBorder``, ``openai/ui``)."""

    uri: str
    mimeType: str
    html: str
    meta: dict[str, JsonValue] = {}


method("mcp_apps.read_ui", params=McpAppsReadUiParams, result=McpAppsReadUiResult,
       doc="The app document behind a ``ui://`` URI (other schemes are refused).")


class McpAppsCallParams(_AppScoped):
    server: str
    tool: str
    arguments: dict[str, JsonValue] = {}


class McpAppsCallResult(OpenModel):
    """The MCP ``CallToolResult`` as JSON (``content``, ``structuredContent``, ``isError``, ``_meta``)."""


method("mcp_apps.call", params=McpAppsCallParams, result=McpAppsCallResult,
       doc="A tool call made by an app iframe: same server, the tool's visibility must include "
           "``app``, and write-capable calls on an untrusted server are refused.")
