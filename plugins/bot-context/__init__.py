"""bot-context — bot context and activity approvals, as an installable plugin.

Bot Mode's context panel knows how to show "this bot is blocked on an approval",
but that knowledge lives inside the desktop pane and inside whichever session
happens to be attached to the member. This plugin moves the *capability* to the
host, where the approval actually is:

* ``pre_approval_request`` / ``post_approval_response`` hooks index every
  approval a bot raises, with its resolved context (profile, bot title, session,
  room), so a caller can find it without being attached to that session.
* ``bot_context_*`` tools (and ``/bot-context``) resolve context, list waiting
  activity, answer it, and read the decision history.
* Answering goes through the host's own resolver, so the blocked bot wakes
  exactly as if the user had clicked the card. Nothing here can approve an
  action by writing to a database or by faking a tool result.

Ship-safety notes (why this is additive, not a rewrite):

* Nothing in the core approval path changed. The hooks it fires already existed;
  a disabled or absent plugin leaves the queue, the cards and ``approval.respond``
  byte-identical.
* The plugin's own record shape is presented both rich and in the Desktop
  group-chat wire shape (``activity["legacy"]``), so the existing bot-context
  panel can consume it without a translation layer.
* Failures are values, not exceptions: every tool returns ``{ok: false, code,
  error}``. A hook that cannot parse its payload logs and drops it; it never
  blocks the host's prompt.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any, Mapping

from . import approvals as ap
from .activities import (
    ALL_CHOICES,
    SAFE_CHOICES,
    MalformedActivity,
    STATUS_EXPIRED,
    STATUS_PENDING,
    build_activity,
    summarize,
)
from .context import BotContext, resolve_bot_context
from .ledger import Ledger, _data_dir
from .subagents import SubagentLedger

logger = logging.getLogger("plugins.bot-context")

DEFAULT_MAX_PENDING = 200
DEFAULT_RETENTION_DAYS = 3.0
DEFAULT_APPROVAL_TTL_SECONDS = 3600.0

_LEDGER: Ledger | None = None
_LEDGER_LOCK = threading.Lock()
_SUBAGENTS: SubagentLedger | None = None
_SUBAGENTS_LOCK = threading.Lock()


# ── settings ────────────────────────────────────────────────────────────────
def _setting(ctx, key: str, default: Any) -> Any:
    try:
        value = ctx.get_config(key, default)
    except Exception:  # pragma: no cover - config read must never break registration
        return default
    return default if value is None else value


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("1", "true", "yes", "on"):
            return True
        if lowered in ("0", "false", "no", "off", ""):
            return False
    return default


def _settings(ctx) -> dict[str, Any]:
    """Current settings, re-read on every use so a config edit applies without a restart.

    Every conversion is defensive: a hand-edited ``config.yaml`` value of the
    wrong type falls back to the safe default instead of breaking a tool call.
    """
    return {
        "answer_scope": ap.normalize_scope(_setting(ctx, "answer_scope", ap.SCOPE_USER)),
        "allow_permanent": _as_bool(_setting(ctx, "allow_permanent_choices", False), False),
        "max_pending": _as_int(_setting(ctx, "max_pending", DEFAULT_MAX_PENDING), DEFAULT_MAX_PENDING),
        "retention_days": _as_float(_setting(ctx, "retention_days", DEFAULT_RETENTION_DAYS),
                                    DEFAULT_RETENTION_DAYS),
        "approval_ttl_seconds": _as_float(_setting(ctx, "approval_ttl_seconds",
                                                   DEFAULT_APPROVAL_TTL_SECONDS),
                                          DEFAULT_APPROVAL_TTL_SECONDS),
    }


def _config_settings() -> dict[str, Any]:
    """Settings read from ``config.yaml`` for the standalone CLI process.

    The CLI is a separate process with no ``PluginContext``; reading the same
    ``plugins.entries.bot-context.settings`` subtree keeps it from inventing a
    second, env-only configuration surface. Environment overrides exist only
    for ad-hoc invocation and are documented in the README.
    """
    settings: dict[str, Any] = {}
    try:
        from hermes_cli.config import load_config_readonly
        config = load_config_readonly() or {}
        entry = (
            (config.get("plugins") or {}).get("entries") or {}
        ).get("bot-context") or {}
        if isinstance(entry, Mapping):
            value = entry.get("settings")
            if isinstance(value, Mapping):
                settings.update(value)
            legacy = entry.get("config")
            if isinstance(legacy, Mapping):
                for key, item in legacy.items():
                    settings.setdefault(key, item)
    except Exception:  # pragma: no cover - config read must never fail the CLI
        pass
    env = {
        "answer_scope": os.environ.get("HERMES_BOT_CONTEXT_ANSWER_SCOPE"),
        "allow_permanent_choices": os.environ.get("HERMES_BOT_CONTEXT_ALLOW_PERMANENT"),
        "max_pending": os.environ.get("HERMES_BOT_CONTEXT_MAX_PENDING"),
        "retention_days": os.environ.get("HERMES_BOT_CONTEXT_RETENTION_DAYS"),
        "approval_ttl_seconds": os.environ.get("HERMES_BOT_CONTEXT_APPROVAL_TTL_SECONDS"),
    }
    if env["allow_permanent_choices"] is not None:
        env["allow_permanent_choices"] = env["allow_permanent_choices"] in ("1", "true", "yes", "on")
    for key, value in env.items():
        if value is not None and value != "":
            settings[key] = value
    return settings


def _ledger(ctx) -> Ledger:
    """One ledger per process, following the active profile and live settings."""
    global _LEDGER
    settings = _settings(ctx)
    store = _data_dir()
    with _LEDGER_LOCK:
        if _LEDGER is None:
            _LEDGER = Ledger(
                store_dir=store,
                max_pending=settings["max_pending"],
                retention_days=settings["retention_days"],
            )
        else:
            _LEDGER.rebind(store)
            _LEDGER.configure(
                max_pending=settings["max_pending"],
                retention_days=settings["retention_days"],
            )
        return _LEDGER


def _subagents() -> SubagentLedger:
    """One process-local subagent index; children are process-local by nature."""
    global _SUBAGENTS
    with _SUBAGENTS_LOCK:
        if _SUBAGENTS is None:
            _SUBAGENTS = SubagentLedger()
        return _SUBAGENTS


def _reset_state_for_tests() -> None:
    """Drop the module-level ledgers (tests only; the host never calls this)."""
    global _LEDGER, _SUBAGENTS
    with _LEDGER_LOCK, _SUBAGENTS_LOCK:
        if _LEDGER is not None:
            _LEDGER.reset()
        _LEDGER = None
        if _SUBAGENTS is not None:
            _SUBAGENTS.reset()
        _SUBAGENTS = None


# ── hooks ───────────────────────────────────────────────────────────────────
def _on_pre_approval_request(ctx, **payload: Any) -> None:
    """Index one approval the host is about to wait on. Never raises, never blocks."""
    try:
        settings = _settings(ctx)
        ledger = _ledger(ctx)
        known = {activity.activity_id for activity in ledger.pending()}
        enriched, live_entry, answerable = ap.enrich_payload(payload, known_ids=known)
        activity = build_activity(
            enriched,
            allow_permanent=settings["allow_permanent"],
            answerable=answerable,
            source="gateway" if answerable else "local",
            choices=(ap.host_choices(live_entry, allow_permanent=settings["allow_permanent"])
                     if live_entry is not None else None),
            choices_source=("live" if live_entry is not None else "safe"),
        )
        ledger.record(activity)
        logger.debug("bot-context: tracking %s for %s (%s)",
                     activity.activity_id, activity.context.label, activity.source)
    except MalformedActivity as exc:
        logger.warning("bot-context: dropped malformed approval payload (%s %s)", exc.field, exc.reason)
        try:
            _ledger(ctx).dropped.append(
                {"reason": "malformed", "field": exc.field, "detail": exc.reason})
        except Exception:  # pragma: no cover - defensive
            pass
    except Exception:  # pragma: no cover - a hook must never disturb the host prompt
        logger.debug("bot-context: pre_approval_request handler failed", exc_info=True)


def _on_subagent_start(ctx, **payload: Any) -> None:
    """Index one child of a bot session; never blocks the delegation."""
    try:
        _subagents().start(payload)
    except Exception:  # pragma: no cover - observer hook must stay silent
        logger.debug("bot-context: subagent_start handler failed", exc_info=True)


def _on_subagent_stop(ctx, **payload: Any) -> None:
    """Keep the child's receipt (summary, status, tool steps) under its parent."""
    try:
        _subagents().stop(payload)
    except Exception:  # pragma: no cover - observer hook must stay silent
        logger.debug("bot-context: subagent_stop handler failed", exc_info=True)


def _on_post_approval_response(ctx, **payload: Any) -> None:
    """Settle the activity the host just resolved (by any surface)."""
    try:
        ap.record_outcome(_ledger(ctx), payload)
    except Exception:  # pragma: no cover - defensive
        logger.debug("bot-context: post_approval_response handler failed", exc_info=True)


def _on_session_end(ctx, **payload: Any) -> None:
    """Nothing can still be pending once its session ended: settle it, don't leave ghosts."""
    try:
        session_id = str(payload.get("session_id") or "").strip()
        session_key = str(payload.get("session_key") or "").strip()
        if not session_id and not session_key:
            return
        ledger = _ledger(ctx)
        for activity in ledger.pending():
            matches = bool(session_key and activity.context.session_key == session_key) or bool(
                session_id and activity.context.session_id == session_id)
            if matches:
                ledger.settle(activity.activity_id, status=STATUS_EXPIRED, by="session_end",
                              note="the session ended before the approval was answered")
        _subagents().finish_session(session_id or session_key)
    except Exception:  # pragma: no cover - defensive
        logger.debug("bot-context: on_session_end handler failed", exc_info=True)


# ── caller context ──────────────────────────────────────────────────────────
def _session_env(name: str) -> str:
    """Read one session-scoped value (ContextVar in the gateway, env in the CLI)."""
    try:
        from gateway.session_context import get_session_env
        value = get_session_env(name, "")
    except Exception:
        import os
        value = os.environ.get(name, "")
    return value.strip() if isinstance(value, str) else ""


def caller_context() -> BotContext:
    """The bot context of the session that is calling a tool or slash command."""
    return resolve_bot_context(
        session_key=_session_env("HERMES_SESSION_KEY"),
        session_id=_session_env("HERMES_SESSION_ID"),
        platform=_session_env("HERMES_SESSION_PLATFORM"),
        surface=_session_env("HERMES_SESSION_SOURCE") or "local",
    )


def _json(payload: Mapping[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, default=str)


# ── tool handlers ───────────────────────────────────────────────────────────
def _handle_resolve(ctx, params: Mapping[str, Any], **_: Any) -> str:
    activity_id = str(params.get("request_id") or "").strip()
    ledger = _ledger(ctx)

    if activity_id:
        activity = ledger.get(activity_id)
        if activity is None:
            return _json(ap.error(
                ap.E_UNKNOWN_ACTIVITY, field="request_id",
                detail={"request_id": activity_id, "diagnostics": ledger.diagnostics()}))
        return _json({"ok": True, "activity": activity.to_dict()})

    if any(params.get(k) for k in ("session_key", "session_id", "profile")):
        context = resolve_bot_context(
            session_key=params.get("session_key"),
            session_id=params.get("session_id"),
            profile=params.get("profile"),
            surface=params.get("surface"),
        )
    else:
        # No addressing given: describe the session we are running in.
        context = caller_context()
    body: dict[str, Any] = {"ok": True, "context": context.to_dict()}
    if not context.complete:
        body["ok"] = False
        body["code"] = ap.E_MISSING_CONTEXT
        body["error"] = (
            "Could not resolve a complete bot context: "
            + (", ".join(context.missing) or "no field named a session")
            + ". Pass session_key or session_id, or run this from inside the bot's session."
        )
    return _json(body)


def _handle_activities(ctx, params: Mapping[str, Any], **_: Any) -> str:
    try:
        limit = max(1, min(200, int(params.get("limit") or 50)))
    except (TypeError, ValueError):
        limit = 50
    status = str(params.get("status") or "pending").strip().lower()
    ledger = _ledger(ctx)
    settings = _settings(ctx)
    ledger.expire_stale(settings["approval_ttl_seconds"])

    if status in ("settled", "history", "all"):
        rows = ledger.recent(
            limit=limit,
            profile=params.get("profile") or None,
            session_key=params.get("session_key") or None,
            session_id=params.get("session_id") or None,
        )
    else:
        rows = ledger.pending(
            profile=params.get("profile") or None,
            room=params.get("room") or None,
            session_key=params.get("session_key") or None,
            session_id=params.get("session_id") or None,
        )

    return _json({
        "ok": True,
        "status": status,
        "count": len(rows),
        "activities": [a.to_dict() for a in rows],
        "sessions": ledger.sessions() if status not in ("settled", "history", "all") else [],
        "store": ledger.diagnostics(),
    })


def _handle_respond(ctx, params: Mapping[str, Any], **_: Any) -> str:
    settings = _settings(ctx)
    result = ap.respond(
        str(params.get("request_id") or ""),
        str(params.get("choice") or ""),
        ledger=_ledger(ctx),
        caller=caller_context(),
        answer_scope=settings["answer_scope"],
        allow_permanent=settings["allow_permanent"],
        reason=str(params.get("reason") or ""),
    )
    return _json(result)


def _handle_history(ctx, params: Mapping[str, Any], **_: Any) -> str:
    try:
        limit = max(1, min(200, int(params.get("limit") or 20)))
    except (TypeError, ValueError):
        limit = 20
    try:
        since_hours = float(params["since_hours"]) if params.get("since_hours") is not None else None
    except (TypeError, ValueError):
        since_hours = None
    ledger = _ledger(ctx)
    rows = ledger.recent(
        limit=limit,
        since_hours=since_hours,
        profile=params.get("profile") or None,
        session_key=params.get("session_key") or None,
        session_id=params.get("session_id") or None,
    )
    return _json({
        "ok": True,
        "count": len(rows),
        "decisions": [a.to_dict() for a in rows],
        "store": ledger.diagnostics(),
    })


def _handle_subagents(ctx, params: Mapping[str, Any], **_: Any) -> str:
    parent = str(params.get("parent_session_id") or params.get("session_id") or "").strip()
    rows = _subagents().list(parent_session_id=parent or None)
    return _json({
        "ok": True,
        "count": len(rows),
        "subagents": [row.to_dict() for row in rows],
        "parent_session_id": parent or None,
    })


_TOOLS = (
    (
        "bot_context_resolve",
        "Resolve the Bot Mode context (profile, bot title, session, room) for a session or a tracked "
        "approval id. Returns exactly what it could not find instead of guessing.",
        {
            "type": "object",
            "properties": {
                "request_id": {"type": "string", "description": "Tracked approval id to resolve context for."},
                "session_key": {"type": "string", "description": "Session key to resolve (defaults to this session)."},
                "session_id": {"type": "string", "description": "Session id to resolve."},
                "profile": {"type": "string", "description": "Profile name, when already known."},
                "surface": {"type": "string", "description": "Surface that raised the request (cli/gateway/transport)."},
            },
            "additionalProperties": False,
        },
        _handle_resolve,
    ),
    (
        "bot_context_activities",
        "List bot activity approvals (pending by default): what each bot is blocked on, its profile, "
        "session and room, the choices the host will accept, and a legacy group-chat prompt shape.",
        {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["pending", "settled", "all"],
                    "description": "Which activities to list (default: pending).",
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                "profile": {"type": "string", "description": "Only activities for this bot profile."},
                "room": {"type": "string", "description": "Only activities in this hosted room."},
                "session_key": {"type": "string", "description": "Only activities for this session key."},
                "session_id": {"type": "string", "description": "Only activities for this session id."},
            },
            "additionalProperties": False,
        },
        _handle_activities,
    ),
    (
        "bot_context_respond",
        "Answer one pending bot activity approval through the host's own approval queue. Approve "
        "('once', 'session', 'always') or 'deny'. Safe failure: returns a code instead of guessing.",
        {
            "type": "object",
            "properties": {
                "request_id": {"type": "string", "description": "Activity id from bot_context_activities."},
                "choice": {"type": "string", "enum": list(ALL_CHOICES)},
                "reason": {"type": "string", "description": "Optional free-text reason relayed to the bot on deny."},
            },
            "required": ["request_id", "choice"],
            "additionalProperties": False,
        },
        _handle_respond,
    ),
    (
        "bot_context_history",
        "Recent settled bot activity approvals (approved/denied/expired), newest first.",
        {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                "since_hours": {"type": "number", "minimum": 0},
                "profile": {"type": "string"},
                "session_key": {"type": "string"},
                "session_id": {"type": "string"},
            },
            "additionalProperties": False,
        },
        _handle_history,
    ),
    (
        "bot_context_subagents",
        "List the subagents Hermes delegated inside one bot session, with their status, summary "
        "and tool-call history. Scoped to that parent session; never mixes sessions.",
        {
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "Parent session id."},
                "parent_session_id": {"type": "string", "description": "Alias for session_id."},
            },
            "additionalProperties": False,
        },
        _handle_subagents,
    ),
)


# ── slash command ───────────────────────────────────────────────────────────
_HELP = (
    "Usage: /bot-context [list | approve <id> | deny <id> [reason] | history]\n"
    "  list     pending bot activity approvals (default)\n"
    "  approve  answer a pending activity with 'once'\n"
    "  deny     answer a pending activity with 'deny'\n"
    "  history  recent settled decisions"
)


def _slash_command(ctx, raw_args: str = "") -> str:
    args = (raw_args or "").strip().split()
    verb = args[0].lower() if args else "list"
    ledger = _ledger(ctx)
    settings = _settings(ctx)

    if verb in ("help", "-h", "--help"):
        return _HELP

    if verb in ("list", "pending"):
        ledger.expire_stale(settings["approval_ttl_seconds"])
        return summarize(ledger.pending())

    if verb in ("history", "settled"):
        rows = ledger.recent(limit=10)
        if not rows:
            return "No settled bot activity yet."
        return "\n".join(
            f"{a.activity_id[:8]}  {a.context.label}  {a.status}"
            + (f" ({a.settled_choice})" if a.settled_choice else "")
            for a in rows)

    if verb in ("approve", "deny"):
        if len(args) < 2:
            return f"{verb}: a request id is required.\n{_HELP}"
        result = ap.respond(
            args[1],
            "once" if verb == "approve" else "deny",
            ledger=ledger,
            caller=caller_context(),
            answer_scope=settings["answer_scope"],
            allow_permanent=settings["allow_permanent"],
            reason=" ".join(args[2:]),
        )
        if result.get("ok"):
            return f"{result['status']}: {result.get('bot', 'activity')} ({result.get('choice')})"
        return f"{result.get('code')}: {result.get('error')}"

    return f"Unknown subcommand {verb!r}.\n{_HELP}"


# ── CLI ─────────────────────────────────────────────────────────────────────
def _cli_setup(parser) -> None:
    sub = parser.add_subparsers(dest="bot_context_cmd")
    sub.add_parser("status", help="Plugin settings, store path and pending count")
    pending = sub.add_parser("pending", help="List pending bot activity approvals")
    # NOT --profile: the app's global `hermes --profile <name>` flag owns that string
    # and a subcommand redeclaring it drops the whole verb.
    pending.add_argument("--bot-profile", default=None, dest="bot_profile")
    pending.add_argument("--json", action="store_true")
    history = sub.add_parser("history", help="Recent settled decisions")
    history.add_argument("--limit", type=int, default=20)
    history.add_argument("--since-hours", type=float, default=None, dest="since_hours")


class _CliCtx:
    """Minimal stand-in for PluginContext so CLI paths reuse the same handlers."""

    def __init__(self, settings: Mapping[str, Any]):
        self._settings = dict(settings)

    def get_config(self, key: str, default: Any = None) -> Any:
        return self._settings.get(key, default)


def _cli_handler(args) -> int:
    ctx = _CliCtx(_config_settings())
    ledger = _ledger(ctx)
    cmd = getattr(args, "bot_context_cmd", None) or "status"
    settings = _settings(ctx)

    if cmd == "status":
        diag = ledger.diagnostics()
        print("bot-context: installed")
        print(f"  answer_scope: {settings['answer_scope']}")
        print(f"  pending:      {diag['pending']}")
        print(f"  store:        {diag['store_path'] or '(memory only — plugin-data unavailable)'}")
        print("  answers route through the live gateway queue; this CLI process holds none.")
        return 0

    if cmd == "pending":
        rows = ledger.pending(profile=getattr(args, "bot_profile", None))
        if getattr(args, "json", False):
            print(json.dumps([a.to_dict() for a in rows], indent=2, default=str))
            return 0
        print(summarize(rows, limit=50))
        return 0

    if cmd == "history":
        rows = ledger.recent(limit=getattr(args, "limit", 20),
                             since_hours=getattr(args, "since_hours", None))
        if not rows:
            print("No settled bot activity recorded.")
            return 0
        for a in rows:
            print(f"{a.activity_id[:8]}  {a.context.label:20.20}  {a.status:18.18}  {a.settled_choice or ''}")
        return 0

    print(_HELP)
    return 0


# ── registration ────────────────────────────────────────────────────────────
def register(ctx) -> None:
    """Wire hooks, tools, the slash command and the CLI subcommand."""
    for name, description, schema, handler in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="bot_context",
            schema={"name": name, "description": description, "parameters": schema},
            handler=lambda params, _h=handler, **kw: _h(ctx, params, **kw),
            description=description,
            emoji="🤖",
        )

    ctx.register_hook("pre_approval_request", lambda **kw: _on_pre_approval_request(ctx, **kw))
    ctx.register_hook("post_approval_response", lambda **kw: _on_post_approval_response(ctx, **kw))
    ctx.register_hook("on_session_end", lambda **kw: _on_session_end(ctx, **kw))
    ctx.register_hook("subagent_start", lambda **kw: _on_subagent_start(ctx, **kw))
    ctx.register_hook("subagent_stop", lambda **kw: _on_subagent_stop(ctx, **kw))

    ctx.register_command("bot-context", lambda raw_args="": _slash_command(ctx, raw_args),
                         description="Bot activity approvals: list, approve, deny, history",
                         args_hint="[list|approve <id>|deny <id>|history]")

    ctx.register_cli_command(
        name="bot-context",
        help="Bot activity approvals (status, pending, history)",
        setup_fn=_cli_setup,
        handler_fn=_cli_handler,
        description="List and inspect bot activity approvals tracked by the "
                    "bot-context plugin. Answering happens in-session "
                    "(/bot-context approve <id>) or through the bot_context_respond tool, "
                    "because approvals live in the process that is holding the wait.",
    )

    # The Desktop Bot Mode pane reads through these when a gateway is present.
    # Optional by design: tools/hooks/commands work without it.
    try:
        from . import rpc
        rpc.install_when_available(ctx)
    except Exception:  # pragma: no cover - RPC is additive, never required
        logger.debug("bot-context: RPC surface unavailable", exc_info=True)

    logger.info("bot-context: registered (scope=%s, tools=%d)",
                _settings(ctx)["answer_scope"], len(_TOOLS))


__all__ = [
    "SAFE_CHOICES",
    "_reset_state_for_tests",
    "caller_context",
    "register",
]
