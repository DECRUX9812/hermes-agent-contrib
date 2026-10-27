"""hermes-approvals plugin.

Durable SQLite approval journal (plugin storage) kept through the stock pre/post approval and
tool-call hooks, plus the fork.approvals.* RPC methods registered through the gateway's public
``register_method`` seam.
"""

from __future__ import annotations

import importlib.abc
import importlib.util
import logging
import sys
from typing import Any

from . import hooks, journal, rpc

log = logging.getLogger(__name__)

_SERVER = "tui_gateway.server"
_installed = False


def _install(server: Any) -> None:
    global _installed
    if _installed:
        return
    names = rpc.install(server)
    _installed = True
    log.info("hermes-approvals: registered %d gateway methods", len(names))


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
                log.exception("hermes-approvals: gateway method registration failed")

        loader.exec_module = exec_module
        return spec


def register(ctx: Any = None) -> None:
    try:
        hooks.install(ctx)
    except Exception:
        log.exception("hermes-approvals: hook registration failed")
    server = sys.modules.get(_SERVER)
    try:
        if server is not None and hasattr(server, "register_method"):
            _install(server)
        elif not _installed and not any(isinstance(f, _AfterServerImport) for f in sys.meta_path):
            sys.meta_path.insert(0, _AfterServerImport())
    except Exception:
        log.exception("hermes-approvals: gateway method registration failed")
