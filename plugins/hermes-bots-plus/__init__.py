"""Gateway half of hermes-bots-plus (Bot Mode 2.0 from the hermes-plus fork).

Nous main's gateway has no ``bots_team.*`` / ``bots_mailbox.*`` JSON-RPC methods, which the
desktop plugin's Team page, room lead and mailbox call. This plugin registers them on the
TUI gateway server through its public ``register_method`` seam. The stores are the fork's own
(``bot_team.py`` / ``bot_mailbox.py``, JSON files under the install root), so data written by a
fork install reads back unchanged.

The server module may be imported after plugins load, so registration waits for it with a
one-shot import hook instead of importing the gateway into processes that never serve it.
"""

from __future__ import annotations

import importlib.abc
import importlib.util
import logging
import sys
from typing import Any

log = logging.getLogger(__name__)

_SERVER = "tui_gateway.server"
_installed = False


def _install(server: Any) -> None:
    global _installed
    if _installed:
        return
    from . import rpc_mailbox, rpc_team

    names = rpc_team.install(server) + rpc_mailbox.install(server)
    _installed = True
    log.info("hermes-bots-plus: registered %d gateway methods", len(names))


class _AfterServerImport(importlib.abc.MetaPathFinder):
    """Runs ``_install`` right after ``tui_gateway.server`` finishes executing."""

    def find_spec(self, fullname, path, target=None):
        if fullname != _SERVER:
            return None
        sys.meta_path.remove(self)
        spec = importlib.util.find_spec(fullname)
        if spec is None or spec.loader is None:
            return spec
        loader = spec.loader
        original = loader.exec_module

        def exec_module(module):
            original(module)
            try:
                _install(module)
            except Exception:
                log.exception("hermes-bots-plus: gateway method registration failed")

        loader.exec_module = exec_module
        return spec


def register(ctx: Any = None) -> None:
    server = sys.modules.get(_SERVER)
    try:
        if server is not None and hasattr(server, "register_method"):
            _install(server)
        elif not _installed and not any(isinstance(f, _AfterServerImport) for f in sys.meta_path):
            sys.meta_path.insert(0, _AfterServerImport())
    except Exception:
        log.exception("hermes-bots-plus: gateway method registration failed")
