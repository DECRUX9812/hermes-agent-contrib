"""rakazo tools — bot management via the Hermes plugin tool system."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from .bot_db import (
    add_audit,
    create_bot,
    delete_bot,
    get_audit_log,
    get_bot,
    get_bot_by_name,
    get_routine,
    list_bots,
    list_routines,
    save_routine,
    update_bot,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Schema building helpers
# ---------------------------------------------------------------------------

def _ts(seconds: float | int | None = None) -> str:
    if seconds is None:
        return datetime.now(timezone.utc).isoformat()
    try:
        dt = datetime.fromtimestamp(float(seconds), tz=timezone.utc)
        return dt.isoformat()
    except Exception:
        return ""


def _fmt_list(bots: list[dict[str, Any]]) -> str:
    if not bots:
        return "No bots found. Create one with /bots create."
    lines = [f"**{b['name']}**  (`{b['id']}`) — {b['status']}"]
    if b.get("description"):
        lines[-1] += f"\n  {b['description']}"
    lines.append(f"  Created {_ts(b['created_at'])} · Runs: {b.get('run_count', 0)}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

_TOOLSET = "rakazo"


def bot_send(args: dict[str, Any], **kwargs) -> str:
    """Send a message to an autonomous bot and get its reply.

    Args:
        bot: Name or ID of the bot to send to.
        message: The message to send.
        block: If true, wait for the bot to finish before returning.
    """
    bot_name_or_id = args.get("bot", "").strip()
    message = args.get("message", "").strip()
    block = args.get("block", False)

    if not bot_name_or_id or not message:
        return json.dumps({"success": False, "error": "bot and message are required."})

    bot = get_bot_by_name(bot_name_or_id) or get_bot(bot_name_or_id)
    if not bot:
        return json.dumps({
            "success": False,
            "error": f"Bot '{bot_name_or_id}' not found. Create with 'hermes bots create'.",
        })

    # Delegate to Hermes — start a background session for this bot
    from tools.registry import registry

    # Build the call using Hermes' internal routing
    # We use terminal to launch hermes in a new tmux session for the bot
    result = {
        "bot_id": bot["id"],
        "bot_name": bot["name"],
        "status": "started",
        "session_id": bot.get("session_id"),
    }

    if block:
        result["warning"] = "block mode launches a detached session; use non-blocking for long-running bots."
        # Fire-and-forget: write a message to the bot's session file
        # which a background worker will pick up
        _queue_message(bot["id"], message)
        logger.info("bot_send: queued message for bot %s", bot["id"])
    else:
        # Best-effort non-blocking: launch via terminal
        _launch_bot_turn(bot["id"], message)
        result["status"] = "launched"

    result["success"] = True
    return json.dumps(result)


def _launch_bot_turn(bot_id: str, message: str) -> None:
    """Launch a Hermes turn for the given bot in a detached terminal."""
    try:
        import subprocess
        home = str(__import__("hermes_constants", fromlist=["get_hermes_home"]).get_hermes_home())
        proc = subprocess.Popen(
            ["hermes", "chat", "-q", message,
             "--skip-memory",  # bots manage their own memory
             f"--session-tag=rakazo-{bot_id}"],
            env={**__import__("os").environ, "HERMES_HOME": home},
            cwd=home,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        logger.debug("Launched bot turn PID=%s for %s", proc.pid, bot_id)
    except Exception as exc:
        logger.error("Failed to launch bot turn: %s", exc)


def _queue_message(bot_id: str, message: str) -> None:
    """Write a queued message to a file for the bot's session processor."""
    import os
    queue_dir = __import__("hermes_constants", fromlist=["get_hermes_home"]).get_hermes_home() / "rakazo" / "queue"
    queue_dir.mkdir(parents=True, exist_ok=True)
    msg_file = queue_dir / f"{bot_id}.msg"
    msg_file.write_text(message, encoding="utf-8")
    # Touch a flag file to signal the worker
    (queue_dir / "flag").touch()


def bot_list(args: dict[str, Any], **kwargs) -> str:
    """List all bots."""
    bots = list_bots()
    if not bots:
        return json.dumps({"bots": [], "count": 0})
    out = []
    for b in bots:
        out.append({
            "id": b["id"],
            "name": b["name"],
            "description": b.get("description", ""),
            "status": b["status"],
            "approval_mode": b.get("approval_mode", "auto"),
            "color": b.get("color", "#7c3aed"),
            "run_count": b.get("run_count", 0),
            "created_at": _ts(b["created_at"]),
        })
    return json.dumps({"bots": out, "count": len(out)})


def bot_status(args: dict[str, Any], **kwargs) -> str:
    """Get status of a specific bot."""
    bot_name_or_id = args.get("bot", "").strip()
    bot = get_bot_by_name(bot_name_or_id) or get_bot(bot_name_or_id)
    if not bot:
        return json.dumps({"error": f"Bot '{bot_name_or_id}' not found."})
    last_audit = get_audit_log(bot["id"], limit=3)
    return json.dumps({
        "id": bot["id"],
        "name": bot["name"],
        "description": bot.get("description", ""),
        "status": bot["status"],
        "approval_mode": bot.get("approval_mode", "auto"),
        "model": bot.get("model"),
        "session_id": bot.get("session_id"),
        "workspace_path": bot.get("workspace_path", ""),
        "run_count": bot.get("run_count", 0),
        "last_run_at": _ts(bot.get("last_run_at")),
        "created_at": _ts(bot["created_at"]),
        "recent_audit": last_audit,
    })


def bot_create(args: dict[str, Any], **kwargs) -> str:
    """Create a new bot."""
    name = args.get("name", "").strip()
    if not name:
        return json.dumps({"success": False, "error": "name is required."})
    if get_bot_by_name(name):
        return json.dumps({"success": False, "error": f"Bot '{name}' already exists."})
    bot = create_bot(
        name=name,
        description=args.get("description", ""),
        instructions=args.get("instructions", ""),
        color=args.get("color", "#7c3aed"),
        approval_mode=args.get("approval_mode", "auto"),
        model=args.get("model", ""),
        notify_on_finish=args.get("notify_on_finish", True),
        parent_bot_id=args.get("parent_bot_id") or None,
    )
    return json.dumps({
        "success": True,
        "bot": {
            "id": bot["id"],
            "name": bot["name"],
            "description": bot["description"],
            "approval_mode": bot["approval_mode"],
        },
    })


def bot_delete(args: dict[str, Any], **kwargs) -> str:
    """Delete a bot."""
    bot_name_or_id = args.get("bot", "").strip()
    bot = get_bot_by_name(bot_name_or_id) or get_bot(bot_name_or_id)
    if not bot:
        return json.dumps({"success": False, "error": f"Bot '{bot_name_or_id}' not found."})
    ok = delete_bot(bot["id"])
    return json.dumps({"success": ok, "bot_id": bot["id"]})


def bot_routines(args: dict[str, Any], **kwargs) -> str:
    """List routines for a bot."""
    bot_name_or_id = args.get("bot", "").strip()
    bot = get_bot_by_name(bot_name_or_id) or get_bot(bot_name_or_id)
    if not bot:
        return json.dumps({"success": False, "error": f"Bot '{bot_name_or_id}' not found."})
    routines = list_routines(bot["id"])
    return json.dumps({
        "bot_id": bot["id"],
        "bot_name": bot["name"],
        "routines": routines,
    })


def bot_memory(args: dict[str, Any], **kwargs) -> str:
    """Read bot memory files.

    Args:
        bot: Bot name or ID.
        path: Relative path in the bot's memory directory.
    """
    bot_name_or_id = args.get("bot", "").strip()
    bot = get_bot_by_name(bot_name_or_id) or get_bot(bot_name_or_id)
    if not bot:
        return json.dumps({"success": False, "error": f"Bot '{bot_name_or_id}' not found."})
    from pathlib import Path
    import os
    base = Path(os.environ.get("HERMES_HOME", __import__("hermes_constants", fromlist=["get_hermes_home"]).get_hermes_home())) / "rakazo" / "bots" / bot["id"] / "memory"
    rel = args.get("path", ".")
    target = (base / rel).resolve()
    if not str(target).startswith(str(base)):
        return json.dumps({"success": False, "error": "Path escapes bot memory dir."})
    if target.is_dir():
        items = sorted([str(p.relative_to(base)) for p in target.iterdir()])
        return json.dumps({"items": items})
    if target.is_file():
        return target.read_text()
    return json.dumps({"success": False, "error": "File not found."})


def bot_audit(args: dict[str, Any], **kwargs) -> str:
    """Get audit log for a bot.

    Args:
        bot: Bot name or ID.
        limit: Number of entries (default 50).
        offset: Skip this many (default 0).
    """
    bot_name_or_id = args.get("bot", "").strip()
    bot = get_bot_by_name(bot_name_or_id) or get_bot(bot_name_or_id)
    if not bot:
        return json.dumps({"success": False, "error": f"Bot '{bot_name_or_id}' not found."})
    limit = int(args.get("limit", 50))
    offset = int(args.get("offset", 0))
    entries = get_audit_log(bot["id"], limit=limit, offset=offset)
    return json.dumps({"bot_id": bot["id"], "entries": entries, "total": len(entries)})


# ---------------------------------------------------------------------------
# Schema definitions
# ---------------------------------------------------------------------------

BOOTSTRAP_SCHEMA = [
    ("bot_list", {
        "name": "bot_list",
        "description": "List all autonomous bots.",
        "parameters": {"type": "object", "properties": {}},
    }),
    ("bot_status", {
        "name": "bot_status",
        "description": "Get status of a specific bot.",
        "parameters": {
            "type": "object",
            "properties": {
                "bot": {"type": "string", "description": "Bot name or ID."},
            },
            "required": ["bot"],
        },
    }),
    ("bot_create", {
        "name": "bot_create",
        "description": "Create a new autonomous bot.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Unique name for the bot."},
                "description": {"type": "string", "default": "", "description": "Short description."},
                "instructions": {"type": "string", "default": "", "description": "Bot system prompt / personality."},
                "color": {"type": "string", "default": "#7c3aed", "description": "Avatar color hex."},
                "approval_mode": {"type": "string", "enum": ["auto", "strict"], "default": "auto",
                                  "description": "auto=runs unattended, strict=asks per dangerous tool."},
                "model": {"type": "string", "default": "", "description": "Optional model override."},
                "notify_on_finish": {"type": "boolean", "default": True},
            },
            "required": ["name"],
        },
    }),
    ("bot_delete", {
        "name": "bot_delete",
        "description": "Delete a bot and its workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "bot": {"type": "string", "description": "Bot name or ID."},
            },
            "required": ["bot"],
        },
    }),
    ("bot_send", {
        "name": "bot_send",
        "description": "Send a message to a bot for processing.",
        "parameters": {
            "type": "object",
            "properties": {
                "bot": {"type": "string", "description": "Bot name or ID."},
                "message": {"type": "string", "description": "Message to send."},
                "block": {"type": "boolean", "default": False, "description": "Wait for completion (detached)."},
            },
            "required": ["bot", "message"],
        },
    }),
    ("bot_routines", {
        "name": "bot_routines",
        "description": "List cron routines attached to a bot.",
        "parameters": {
            "type": "object",
            "properties": {
                "bot": {"type": "string", "description": "Bot name or ID."},
            },
            "required": ["bot"],
        },
    }),
    ("bot_memory", {
        "name": "bot_memory",
        "description": "Read files from a bot's persistent memory directory.",
        "parameters": {
            "type": "object",
            "properties": {
                "bot": {"type": "string", "description": "Bot name or ID."},
                "path": {"type": "string", "default": ".", "description": "Path relative to bot memory dir."},
            },
            "required": ["bot"],
        },
    }),
    ("bot_audit", {
        "name": "bot_audit",
        "description": "Get the audit log for a bot (every tool call it made).",
        "parameters": {
            "type": "object",
            "properties": {
                "bot": {"type": "string", "description": "Bot name or ID."},
                "limit": {"type": "integer", "default": 50},
                "offset": {"type": "integer", "default": 0},
            },
            "required": ["bot"],
        },
    }),
]


def register_all_tools(ctx):
    """Register all rakazo tools with the Hermes registry via ctx.register_tool()."""
    for tool_name, schema in BOOTSTRAP_SCHEMA:
        handler_map = {
            "bot_list": bot_list,
            "bot_status": bot_status,
            "bot_create": bot_create,
            "bot_delete": bot_delete,
            "bot_send": bot_send,
            "bot_routines": bot_routines,
            "bot_memory": bot_memory,
            "bot_audit": bot_audit,
        }
        handler = handler_map[tool_name]
        ctx.register_tool(
            name=tool_name,
            toolset=_TOOLSET,
            schema=schema,
            handler=handler,
        )
