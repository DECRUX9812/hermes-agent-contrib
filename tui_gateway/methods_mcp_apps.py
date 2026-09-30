"""MCP Apps JSON-RPC handlers (``mcp_apps.*``) — the Desktop's door to ``tools/mcp_apps.py``.

Bodies are rebound onto server.py's globals (method_ctx.bind_module). Every handler binds the
owning profile (``profile`` or the session's ``session_id``): MCP connections are per profile, and
a lazy server may connect here, so the scope must carry secrets too — ``server._profile_scoped``
binds the full ``_session_profile_runtime_scope`` (home + secret + terminal), resolving
``profile`` through the same ``_profile_home`` the ``mcp.servers.*`` wrapper uses.
Refusals the app can show verbatim are 414x; unexpected failures are 5140.
"""

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method
_profile_scoped = _registry.profile_scoped


def _mcp_apps_run(rid, fn):
    try:
        return _ok(rid, fn())
    except PermissionError as e:
        return _err(rid, 4141, str(e))
    except (LookupError, ValueError) as e:
        return _err(rid, 4140, str(e))
    except Exception as e:
        return _err(rid, 5140, str(e))


def _mcp_apps_str(params: dict, key: str) -> str:
    value = str(params.get(key) or "").strip()
    if not value:
        raise ValueError(f"{key} required")
    return value


@method("mcp_apps.list")
@_profile_scoped
def _(rid, params: dict) -> dict:
    from tools import mcp_apps
    return _mcp_apps_run(rid, lambda: {"apps": mcp_apps.list_apps()})


@method("mcp_apps.read_ui")
@_profile_scoped
def _(rid, params: dict) -> dict:
    from tools import mcp_apps
    return _mcp_apps_run(rid, lambda: mcp_apps.read_ui(_mcp_apps_str(params, "server"), _mcp_apps_str(params, "uri")))


@method("mcp_apps.call")
@_profile_scoped
def _(rid, params: dict) -> dict:
    from tools import mcp_apps
    args = params.get("arguments")
    return _mcp_apps_run(rid, lambda: mcp_apps.call_app_tool(
        _mcp_apps_str(params, "server"), _mcp_apps_str(params, "tool"), args if isinstance(args, dict) else {}))


def register(server) -> None:
    bind_module(globals(), server, skip=("_",))
