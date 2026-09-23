"""/refine from slash.exec must run against the LIVE session's agent and history. Without a live
handler it falls through to the _SlashWorker, whose fresh HermesCLI has an empty
conversation_history and always answers "Nothing to refine yet" (#93918)."""

from __future__ import annotations

import threading
import types
from unittest.mock import MagicMock, patch

from tui_gateway import server
from tui_gateway.transport import StdioTransport


def _live_session(agent, history):
    return {
        "agent": agent, "session_key": "refine-key", "history": list(history),
        "history_lock": threading.Lock(), "running": False,
        "transport": StdioTransport(lambda: None, threading.Lock()),
        "cwd": "", "source": "desktop",
    }


class _ExplodingWorker:
    def __init__(self, *args, **kwargs):
        raise AssertionError("slash worker must not spawn for live /refine")


def _slash_exec(sid, command):
    return server.handle_request(
        {"id": "1", "method": "slash.exec",
         "params": {"command": command, "session_id": sid}})


def test_slash_exec_refine_dispatches_background_review_on_live_session(monkeypatch):
    sid = "refine-sid"
    agent = types.SimpleNamespace(
        valid_tool_names={"skill_manage"},
        _spawn_background_review=MagicMock())
    history = [{"role": "user", "content": "hi"}]
    session = _live_session(agent, history)
    server._sessions[sid] = session
    monkeypatch.setattr(server, "_SlashWorker", _ExplodingWorker)

    token = server.bind_transport(session["transport"])
    try:
        with patch.object(server, "_session_uses_compute_host", return_value=False):
            resp = _slash_exec(sid, "refine tighten memory")
    finally:
        server.reset_transport(token)
        server._sessions.pop(sid, None)

    out = resp["result"]["output"]
    assert out.startswith("⚗ Reviewing this conversation in the background")
    assert "(focus: tighten memory)" in out
    agent._spawn_background_review.assert_called_once()
    kwargs = agent._spawn_background_review.call_args.kwargs
    assert kwargs["messages_snapshot"] == history
    assert kwargs["review_memory"] is True
    assert kwargs["review_skills"] is True
    assert kwargs["focus"] == "tighten memory"
    assert kwargs["explicit"] is True


def test_slash_exec_refine_empty_conversation_reports_nothing_to_refine(monkeypatch):
    sid = "refine-empty-sid"
    agent = types.SimpleNamespace(
        valid_tool_names=set(),
        _spawn_background_review=MagicMock())
    session = _live_session(agent, [])
    server._sessions[sid] = session
    monkeypatch.setattr(server, "_SlashWorker", _ExplodingWorker)

    token = server.bind_transport(session["transport"])
    try:
        with patch.object(server, "_session_uses_compute_host", return_value=False):
            resp = _slash_exec(sid, "refine")
    finally:
        server.reset_transport(token)
        server._sessions.pop(sid, None)

    assert resp["result"]["output"] == "Nothing to refine yet — the conversation is empty."
    agent._spawn_background_review.assert_not_called()
