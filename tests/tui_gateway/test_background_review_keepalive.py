"""A detached session whose skill/memory review fork is still running must survive the ws-orphan reap.

The review runs on a daemon thread after the user's turn has closed: ``session["running"]`` is
already False while a provider call and its skill/memory writes are still in flight. The reaper's
idle arm then ended the session out from under it — agent.log for desktop session ``local-ede…``
has the review turn starting 15:27:54 and the session ending ``ws_orphan_reap`` at 15:28:24, with
the fork's tool work still logging past the end.

Bounded by design: ``finish_background_review_run`` clears ``agent._background_review_run``, so
the next grace reaps normally — this can only defer, never pin.
"""

from __future__ import annotations

import importlib
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture()
def hermes_home(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    yield home


@pytest.fixture()
def server(hermes_home):
    with patch.dict("sys.modules", {"hermes_cli.env_loader": MagicMock(),
                                    "hermes_cli.banner": MagicMock()}):
        mod = importlib.import_module("tui_gateway.server")
        yield mod
        mod._sessions.clear()
        mod._pending_ws_reaps.clear()


class _Timer:
    created: list = []

    def __init__(self, delay, callback):
        self.delay, self.callback = delay, callback
        _Timer.created.append(self)

    def start(self):
        pass

    def cancel(self):
        pass


@pytest.fixture()
def detached(server, monkeypatch):
    _Timer.created = []
    monkeypatch.setattr(server.threading, "Timer", _Timer)
    monkeypatch.setattr(server, "_WS_ORPHAN_REAP_GRACE_S", 20)
    monkeypatch.setattr(server, "_session_has_active_delegations", lambda *a: False)
    monkeypatch.setattr(server, "_session_owns_live_wakeup_schedule", lambda *a: False)
    monkeypatch.setattr(server, "_session_owns_pending_process_notification", lambda *a: False)
    popped = []
    monkeypatch.setattr(server, "_teardown_popped_session", lambda s, **kw: popped.append(s))

    agent = MagicMock(spec=["_background_review_run"])
    agent._background_review_run = object()  # a review fork is mid-call
    sid = "sid-review"
    session = {
        "session_key": "desktop-review-session",
        "transport": server._detached_ws_transport,
        "running": False,
        "history_lock": threading.Lock(),
        "last_active": 0.0,
        "created_at": 0.0,
        "agent": agent,
    }
    server._sessions[sid] = session
    return sid, session, popped


def _fire(server, sid):
    server._schedule_ws_orphan_reap(sid)
    _Timer.created[-1].callback()


def test_inflight_review_defers_the_reap(server, detached):
    sid, session, popped = detached

    _fire(server, sid)

    assert server._sessions.get(sid) is session and not popped
    assert server._pending_ws_reaps[sid] is _Timer.created[-1]  # re-armed, re-checked next grace


def test_reap_proceeds_once_the_review_finishes(server, detached):
    sid, session, popped = detached
    _fire(server, sid)
    assert not popped

    session["agent"]._background_review_run = None  # finish_background_review_run cleared it
    _Timer.created[-1].callback()

    assert sid not in server._sessions and popped == [session]


def test_session_without_a_review_is_reaped_as_before(server, detached):
    sid, session, popped = detached
    session["agent"]._background_review_run = None

    _fire(server, sid)

    assert sid not in server._sessions and popped == [session]


def test_agent_less_session_still_reaps(server, detached):
    sid, session, popped = detached
    session.pop("agent")

    _fire(server, sid)

    assert sid not in server._sessions and popped == [session]
