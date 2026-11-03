"""Optional gateway RPC surface for the Bot Mode UI.

Tools are for the agent; a pane needs a request/response door too. When the
gateway server is present in this process, the plugin registers four
``bot_context.*`` methods through the gateway's public ``register_method``
seam. They are the read/answer API the Desktop Bot Mode panel uses, scoped to
one session at a time so a pane can never show another session's rows.

Nothing here is required for the tools or hooks to work: an install with no
gateway (the CLI, a unit test) simply never installs the methods, and callers
fall back to the in-session approval card.
"""

from __future__ import annotations

import importlib.abc
import importlib.util
import json
import logging
import sys
from typing import Any, Mapping

logger = logging.getLogger("plugins.bot-context")

_SERVER = "tui_gateway.server"
METHODS = (
    "bot_context.activities",
    "bot_context.history",
    "bot_context.resolve",
    "bot_context.respond",
    "bot_context.sessions",
)

_installed: set[int] = set()


def _ok(rid: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rid, "result": result}


def _err(rid: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}}


def _json_result(rid: Any, text: str) -> dict[str, Any]:
    try:
        payload = json.loads(text)
    except ValueError:
        return _err(rid, -32603, "bot-context returned an unreadable result")
    return _ok(rid, payload if isinstance(payload, dict) else {"ok": True, "result": payload})


def _params(params: Any) -> dict[str, Any]:
    return dict(params) if isinstance(params, Mapping) else {}


def handle_activities(rid: Any, params: Any, ctx) -> dict[str, Any]:
    from . import _handle_activities

    return _json_result(rid, _handle_activities(ctx, _params(params)))


def handle_history(rid: Any, params: Any, ctx) -> dict[str, Any]:
    from . import _handle_history

    return _json_result(rid, _handle_history(ctx, _params(params)))


def handle_resolve(rid: Any, params: Any, ctx) -> dict[str, Any]:
    from . import _handle_resolve

    return _json_result(rid, _handle_resolve(ctx, _params(params)))


def handle_respond(rid: Any, params: Any, ctx) -> dict[str, Any]:
    from . import _handle_respond

    return _json_result(rid, _handle_respond(ctx, _params(params)))


def handle_sessions(rid: Any, params: Any, ctx) -> dict[str, Any]:
    from . import _ledger, _settings

    ledger = _ledger(ctx)
    settings = _settings(ctx)
    ledger.expire_stale(settings["approval_ttl_seconds"])
    profile = _params(params).get("profile") or None
    rows = ledger.sessions()
    if profile:
        rows = [row for row in rows if row.get("profile") == profile]
    return _ok(rid, {
        "ok": True,
        "count": len(rows),
        "sessions": rows,
        "store": ledger.diagnostics(),
    })


_HANDLERS = {
    "bot_context.activities": handle_activities,
    "bot_context.history": handle_history,
    "bot_context.resolve": handle_resolve,
    "bot_context.respond": handle_respond,
    "bot_context.sessions": handle_sessions,
}


def install(server: Any, ctx) -> list[str]:
    """Register the methods once per server; a reloaded copy replaces handlers."""
    if server is None or not hasattr(server, "register_method"):
        return []
    key = id(server)
    first = key not in _installed
    for name, handler in _HANDLERS.items():
        server.register_method(name, lambda rid, params, _h=handler: _h(rid, params, ctx))
    _installed.add(key)
    return list(METHODS) if first else []


class _AfterServerImport(importlib.abc.MetaPathFinder):
    """Install right after ``tui_gateway.server`` finishes executing."""

    def __init__(self, ctx):
        self.ctx = ctx

    def find_spec(self, fullname, path, target=None):
        if fullname != _SERVER:
            return None
        try:
            sys.meta_path.remove(self)
        except ValueError:
            pass
        spec = importlib.util.find_spec(fullname)
        if spec is None or spec.loader is None:
            return spec
        loader = spec.loader
        original = loader.exec_module

        def exec_module(module):
            original(module)
            try:
                install(module, self.ctx)
            except Exception:
                logger.exception("bot-context: gateway method registration failed")

        loader.exec_module = exec_module
        return spec


def install_when_available(ctx) -> None:
    """Install now if the gateway is already imported, else on its next import."""
    server = sys.modules.get(_SERVER)
    if server is not None:
        try:
            install(server, ctx)
        except Exception:
            logger.exception("bot-context: gateway method registration failed")
        return
    try:
        if not any(isinstance(finder, _AfterServerImport) for finder in sys.meta_path):
            sys.meta_path.insert(0, _AfterServerImport(ctx))
    except Exception:  # pragma: no cover - a meta_path race must not break the plugin
        logger.debug("bot-context: could not arm deferred RPC registration", exc_info=True)
