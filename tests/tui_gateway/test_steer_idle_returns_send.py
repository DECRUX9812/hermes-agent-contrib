"""`/steer` via command.dispatch must fall through to next-turn send when no
turn is live: ``AIAgent.steer()`` accepts text unconditionally, so gating the
queued ack on the agent's existence alone parks the payload in
``_pending_steer`` where it is dropped on teardown."""

from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest

from tui_gateway import server


def _session(agent, *, running: bool) -> dict:
    return {
        "agent": agent,
        "session_key": "session-key",
        "history": [],
        "history_lock": threading.Lock(),
        "history_version": 0,
        "running": running,
        "attached_images": [],
    }


@pytest.fixture()
def sid():
    sid = "steer-sid"
    yield sid
    server._sessions.pop(sid, None)


def _dispatch(sid: str, arg: str) -> dict:
    return server._methods["command.dispatch"](
        "request-id",
        {"session_id": sid, "name": "steer", "arg": arg},
    )


def test_steer_idle_session_returns_send_not_queued_ack(sid):
    agent = SimpleNamespace(steer=lambda _text: True)
    server._sessions[sid] = _session(agent, running=False)

    response = _dispatch(sid, "check auth.log")

    assert response["result"] == {"type": "send", "message": "check auth.log"}


def test_steer_live_turn_queues_on_agent(sid):
    calls = {}

    def _steer(text):
        calls["text"] = text
        return True

    agent = SimpleNamespace(steer=_steer)
    server._sessions[sid] = _session(agent, running=True)

    response = _dispatch(sid, "check auth.log")

    assert calls["text"] == "check auth.log"
    assert "Steer queued" in response["result"]["output"]
