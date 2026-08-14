"""Bot session runner — drives a bot in an isolated Hermes session.

Each bot is a session that uses the configured model, has its own
context, and runs inside its workspace directory. The runner:
  1. Sets up the workspace (cwd) so terminal/file commands default there
  2. Marks the active bot in plugin hooks (for audit routing)
  3. Spawns the agent loop
"""

from __future__ import annotations

import logging
import os
from typing import Any

from .plugin_hooks import set_active_bot

logger = logging.getLogger(__name__)


def run_bot_session_interactive(bot: dict[str, Any], initial_message: str = "") -> None:
    """Spawn an interactive Hermes session for the given bot.

    Implementation notes:
    * Uses ``hermes chat -q`` to send the initial message (non-TTY mode)
    * If no message, falls back to ``hermes chat --session <bot_id>``
    * The agent loop runs once per session; the user can keep chatting
      by running additional ``bot_send`` calls.
    """
    import subprocess
    from hermes_constants import get_hermes_home

    workspace = bot.get("workspace_path", "")
    if not os.path.isdir(workspace):
        os.makedirs(workspace, exist_ok=True)

    home = str(get_hermes_home())
    env = {**os.environ, "HERMES_HOME": home}
    if workspace:
        env["TERMINAL_CWD"] = workspace

    # Tag the bot as active for the hooks
    set_active_bot(bot["id"])

    cmd = ["hermes"]
    if initial_message:
        cmd += ["chat", "-q", initial_message, "--skip-memory"]
    else:
        cmd += ["chat"]
    cmd += [f"--session-tag=rakazo-{bot['id']}"]

    logger.info("Launching Hermes session for bot %s", bot["id"])
    try:
        result = subprocess.run(
            cmd,
            env=env,
            cwd=workspace or home,
        )
        set_active_bot(None)
        return result.returncode
    except KeyboardInterrupt:
        set_active_bot(None)
        raise
