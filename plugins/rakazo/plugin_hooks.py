"""Plugin lifecycle hooks for rakazo.

pre_tool_call  — routes per-bot tool approval and tags the audit log.
post_tool_call — appends to the audit log after a bot's tool executes.
on_session_end — marks the bot as idle when its session finishes.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any

from .bot_db import add_audit, get_bot, list_bots, update_bot

logger = logging.getLogger(__name__)

# Thread-local for the active bot ID during a bot's session
_local = threading.local()

# Tools that require approval in strict mode
_DANGEROUS_TOOLS = {
    "terminal", "shell_exec", "write_file", "patch", "execute_code",
    "browser_exec", "cronjob", "delegate_task",
}


def set_active_bot(bot_id: str | None) -> None:
    """Tag the current thread as running on behalf of a bot."""
    if bot_id:
        _local.bot_id = bot_id
    else:
        _local.bot_id = None


def get_active_bot() -> str | None:
    return getattr(_local, "bot_id", None)


def register_hooks(ctx):
    """Register all rakazo lifecycle hooks."""

    def _pre_tool_call(tool_name: str, tool_args: dict, **kw):
        bot_id = get_active_bot()
        if not bot_id:
            return None  # not a bot session

        bot = get_bot(bot_id)
        if not bot:
            return None

        # In strict mode, block dangerous tools unless approved
        if bot.get("approval_mode") == "strict" and tool_name in _DANGEROUS_TOOLS:
            return {
                "directive": "block",
                "message": (
                    f"Bot '{bot['name']}' is in strict approval mode. "
                    f"Tool '{tool_name}' requires explicit user approval. "
                    f"Use 'hermes bots approve {bot_id} {tool_name}' to approve."
                ),
            }
        return None  # allow

    def _post_tool_call(tool_name: str, tool_args: dict, result: str, **kw):
        bot_id = get_active_bot()
        if not bot_id:
            return None

        # Truncate result for audit log
        result_summary = str(result)[:2000]
        add_audit(
            bot_id=bot_id,
            tool_name=tool_name,
            tool_args=tool_args,
            result_summary=result_summary,
            approved=True,
            approved_by="auto",
        )
        return None

    def _on_session_end(session_id: str = "", **kw):
        bot_id = get_active_bot()
        if bot_id:
            update_bot(bot_id, status="idle")
            set_active_bot(None)
        return None

    ctx.register_hook("pre_tool_call", _pre_tool_call)
    ctx.register_hook("post_tool_call", _post_tool_call)
    ctx.register_hook("on_session_end", _on_session_end)
