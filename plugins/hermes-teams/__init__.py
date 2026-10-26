"""Bot Mode v3: roles, team templates and team runs on core primitives.

A role is a profile template (SOUL.md + optional model). A bot is a profile made from a role, so the
canonical Bot Chat invariant (one ``Bot Chat`` session per profile) holds unchanged. A team run is a
Kanban task graph: one task per template step, assigned to the step role's profile, gated on the
steps it needs. The Kanban dispatcher runs it; this plugin only writes the graph and reads it back.

``teams.*`` methods register on the TUI gateway server through its public ``register_method`` seam.
The server module may be imported after plugins load, so registration waits for it with a one-shot
import hook instead of importing the gateway into processes that never serve it.
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
    from . import rpc

    names = rpc.install(server)
    _installed = True
    log.info("hermes-teams: registered %d gateway methods", len(names))


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
                log.exception("hermes-teams: gateway method registration failed")

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
        log.exception("hermes-teams: gateway method registration failed")
