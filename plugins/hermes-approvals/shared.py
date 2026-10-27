"""One process-wide state for every copy of this plugin's modules.

Hermes can import the plugin more than once in a process: a second plugin manager for the
same profile evicts ``hermes_plugins.hermes_approvals`` from ``sys.modules`` and re-executes it,
and another profile gets its own ``__home_<digest>`` copy. Each copy would otherwise keep its
own caches, so a prompt remembered by one copy's hook could be answered by another copy's RPC
handler that never saw it. Every copy reads and writes this one object instead.
"""

from __future__ import annotations

import sys
import threading
import types
from collections import OrderedDict

_KEY = "_hermes_approvals_process_state"
VERSION = 1


def _new() -> types.ModuleType:
    state = types.ModuleType(_KEY)
    state.version = VERSION
    state.lock = threading.Lock()
    state.tool_names = OrderedDict()      # tool_call_id -> tool name, for the pending row
    state.allowed_calls = OrderedDict()   # tool_call_id -> None, calls this process allowed
    state.live_keys = OrderedDict()       # request_id -> queue key of a prompt still waiting
    state.sweep_lock = threading.Lock()
    state.swept_paths = set()             # journal files already swept in this process
    state.install_lock = threading.Lock()
    state.registered = {}                 # id(server) -> method names registered on it
    return state


def get() -> types.ModuleType:
    """The process's state; created once (``dict.setdefault`` is atomic under the GIL)."""
    state = sys.modules.get(_KEY)
    if state is None or getattr(state, "version", None) != VERSION:
        candidate = _new()
        state = sys.modules.setdefault(_KEY, candidate)
        if getattr(state, "version", None) != VERSION:
            sys.modules[_KEY] = state = candidate
    return state
