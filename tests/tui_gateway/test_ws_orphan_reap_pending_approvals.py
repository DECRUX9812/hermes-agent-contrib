"""A WS-orphan reap must not silently deny an unanswered approval.

A transient WebSocket drop schedules ``_schedule_ws_orphan_reap``; when it fires
the session is popped and torn down. Before this fix the teardown withdrew every
open server→client request and resolved the approval queue ``deny`` — an
unanswered prompt was refused by nobody and the replay path
(``pending_approval`` / ``open_requests`` on resume) had nothing left to
re-deliver. Reclaim end reasons (``ws_orphan_reap`` here) must instead preserve
the pending approval so a reconnecting client can still answer it; real
user-stop paths keep cancel + deny.
"""

import threading
import types

import pytest

from tools import approval as _approval
from tools.approval_gateway_wait import _ApprovalEntry
from tui_gateway import server, server_requests


def _session(**extra):
    return {
        "agent": types.SimpleNamespace(),
        "session_key": "session-key",
        "history": [],
        "history_lock": threading.Lock(),
        "history_version": 0,
        "running": False,
        "attached_images": [],
        "image_counter": 0,
        "cols": 80,
        "slash_worker": None,
        "show_reasoning": False,
        "tool_progress_mode": "all",
        "queued_prompt": None,
        **extra,
    }


@pytest.fixture()
def pending_approval(monkeypatch):
    """One unanswered approval for ``session-key``: the queue entry the wait owns plus the
    ``approval`` server→client request the client renders. Yields ``(entry, request_id)``."""
    monkeypatch.setattr(server_requests, "_answerable", lambda sid: True)
    monkeypatch.setattr(server_requests, "_write", lambda frame: None)
    monkeypatch.setattr(server_requests, "_emit", lambda *a: None)
    key = "session-key"
    entry = _ApprovalEntry({
        "request_id": "req-pending-1",
        "command": "rm -rf /tmp/x",
        "pattern_key": "k1",
        "pattern_keys": ["k1"],
    })
    with _approval._lock:
        _approval._gateway_queues.setdefault(key, []).append(entry)
    server_requests.send_async(
        "approval", "orphan-sid",
        {"request_id": "req-pending-1", "command": "rm -rf /tmp/x"},
        lambda _result: None)
    try:
        yield entry
    finally:
        with _approval._lock:
            _approval._gateway_queues.pop(key, None)
            _approval._parked_gateway_queues.pop(key, None)
        server_requests.reset_for_tests()


@pytest.fixture()
def orphan_reap(monkeypatch):
    """Capture reap callbacks so the test fires the timer synchronously."""
    callbacks = []

    class _Timer:
        def __init__(self, _delay, callback):
            callbacks.append(callback)
            self.daemon = False

        def start(self):
            return None

        def cancel(self):
            return None

    monkeypatch.setattr(server, "_WS_ORPHAN_REAP_GRACE_S", 0.01)
    monkeypatch.setattr(server.threading, "Timer", _Timer)
    monkeypatch.setattr(server, "_session_has_active_delegations", lambda *a: False)
    monkeypatch.setattr(server, "_broadcast_global_event", lambda *a, **k: None)
    monkeypatch.setattr(server, "_session_uses_compute_host", lambda *a: False)
    return callbacks


def test_ws_orphan_reap_preserves_unanswered_approval(pending_approval, orphan_reap):
    """Idle detached session reaped with an open approval: nothing may answer it."""
    sid = "orphan-sid"
    server._sessions[sid] = _session(transport=server._detached_ws_transport)
    try:
        server._schedule_ws_orphan_reap(sid)
        orphan_reap.pop(0)()

        assert sid not in server._sessions
        # The approval was NOT denied or withdrawn — it survives for the resume replay.
        assert pending_approval.result is None
        assert _approval.get_pending_gateway_approval("session-key") is not None
        assert server_requests.open_requests(sid)
        # ...and a reconnecting client's answer still resolves it.
        assert _approval.resolve_gateway_approval(
            "session-key", "once", request_id="req-pending-1") == 1
        assert pending_approval.result == "once"
    finally:
        server._sessions.pop(sid, None)


def test_ws_orphan_reap_mid_turn_does_not_deny_pending_approval(pending_approval, orphan_reap):
    """The client-gone interrupt path must park the approval, not resolve it deny."""
    sid = "orphan-sid"
    server._sessions[sid] = _session(
        transport=server._detached_ws_transport, running=True)
    # Turn activity is stale so the reaper takes the interrupt branch immediately.
    try:
        server._schedule_ws_orphan_reap(sid)
        orphan_reap.pop(0)()

        assert sid in server._sessions  # interrupt claimed; the settle poll owns the reap
        assert server._sessions[sid]["_client_gone_interrupt_requested"]
        assert pending_approval.result is None
        assert _approval.get_pending_gateway_approval("session-key") is not None
        assert server_requests.open_requests(sid)
    finally:
        server._sessions.pop(sid, None)


def test_user_stop_still_cancels_and_denies(pending_approval, monkeypatch):
    """Control: a real interrupt (session.interrupt) keeps deny + withdraw semantics."""
    session = _session(running=True)
    monkeypatch.setattr(server, "_session_uses_compute_host", lambda *a: False)

    server._interrupt_session_turn("orphan-sid", session)

    assert pending_approval.result == "deny"
    assert _approval.get_pending_gateway_approval("session-key") is None
    assert server_requests.open_requests("orphan-sid") == []
