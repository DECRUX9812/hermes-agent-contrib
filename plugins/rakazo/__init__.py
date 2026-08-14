"""rakazo plugin — persistent autonomous bots for Hermes.

Inspired by Rakazo (github.com/elie222/rakazo): each bot has one thread, one
sandboxed workspace, memory, cron routines, and a full audit log of every
action it takes.

Design — bridge to existing Hermes systems instead of reimplementing:

* **Thread** → a Hermes session (SessionDB). ``bot_send`` posts a message to
  the bot's session and runs the agent loop. The bot keeps its conversation
  history across invocations just like any Hermes session.
* **Sandbox** → the bot's home directory under ``$HERMES_HOME/rakazo/bots/
  <bot_id>/workspace/``. Terminal commands run there by default when the bot
  is active. For stronger isolation, the user can point a bot at a Docker env.
* **Routines** → Hermes cron jobs with ``attach_to_session`` so the routine
  fires into the bot's session thread. ``bot_routines`` creates/lists/deletes
  them via the cron tool.
* **Memory** → per-bot memory files under
  ``$HERMES_HOME/rakazo/bots/<bot_id>/memory/`` + integration with whatever
  memory provider is configured. ``bot_memory`` read/writes/searches.
* **Audit log** → every tool call a bot makes is recorded with timestamp,
  tool name, arguments, and result. The ``pre_tool_call`` hook tags the
  running session with the active bot ID; ``post_tool_call`` appends to the
  audit log.
* **Approval** → per-bot tool approval. A bot with ``approval_mode: strict``
  requires the user to approve dangerous tool calls (terminal, write_file,
  patch) via the standard Hermes approval flow. ``approval_mode: auto``
  runs everything (the default for trusted bots).

CLI: ``hermes bots <verb>`` — list, show, create, delete, send, routines.

No external dependencies — pure stdlib + Hermes plugin API.
"""

from __future__ import annotations

import logging

from .bot_db import init_db
from .plugin_hooks import register_hooks
from .tools import register_all_tools

logger = logging.getLogger(__name__)


def register(ctx):
    """Entry point called by PluginManager at discovery time."""
    init_db()
    register_all_tools(ctx)
    register_hooks(ctx)
    # Register CLI subcommand: hermes bots <verb>
    from .cli import register_cli, bots_command

    ctx.register_cli_command(
        name="bots",
        help="Manage persistent autonomous bots (Rakazo).",
        setup_fn=register_cli,
        handler_fn=bots_command,
        description="Create, list, inspect, and send messages to autonomous bots.",
    )
    logger.info("rakazo plugin registered")
