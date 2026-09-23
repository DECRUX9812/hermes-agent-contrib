"""session.compress preview: a ``--preview``/``--dry-run`` request must answer the
read-only report (``hermes_cli.partial_compress.summarize_compress_preview``) and
never touch history — regardless of whether the flag arrives inside
``focus_topic`` (TUI sends the raw arg) or as the typed ``preview`` param
(desktop)."""
import threading
from unittest.mock import MagicMock, patch


def _make_history():
    return [
        {"role": "user", "content": "a"},
        {"role": "assistant", "content": "b"},
        {"role": "user", "content": "c"},
        {"role": "assistant", "content": "d"},
    ]


def _make_session(agent, history):
    return {
        "agent": agent,
        "history_lock": threading.Lock(),
        "history": history,
        "history_version": 1,
        "running": False,
        "session_key": "sess-preview",
    }


def _make_agent():
    agent = MagicMock()
    agent._cached_system_prompt = ""
    agent.tools = None
    agent.session_id = "sess-preview"
    agent._pending_context_engine_compression_notification = None
    return agent


def _run_compress(sid, session, params):
    from tui_gateway import server

    server._sessions[sid] = session
    try:
        with (
            patch.object(server, "_sess", return_value=(session, None)),
            patch.object(server, "_session_uses_compute_host", return_value=False),
            patch.object(server, "_status_update"),
            patch(
                "agent.model_metadata.estimate_request_tokens_rough",
                return_value=100,
            ),
        ):
            return server._methods["session.compress"]("r1", {"session_id": sid, **params})
    finally:
        server._sessions.pop(sid, None)


def test_session_compress_focus_topic_preview_returns_report_no_mutation():
    """``focus_topic='--preview'`` (the raw arg the TUI/desktop sends today) must
    answer the preview report, not a fake 'compressed' result."""
    history = _make_history()
    session = _make_session(_make_agent(), list(history))

    r = _run_compress("sid-preview-arg", session, {"focus_topic": "--preview"})

    assert "error" not in r, f"preview surfaced as error: {r.get('error')}"
    result = r["result"]
    assert result["status"] == "preview"
    lines = "\n".join(result["preview"]["lines"])
    assert "Preview — no changes made." in lines
    assert "Would compress 4 of 4 message(s)" in lines
    # History untouched: same rows, same version.
    assert session["history"] == history
    assert session["history_version"] == 1
    session["agent"]._compress_context.assert_not_called()


def test_session_compress_typed_preview_param_returns_report_no_mutation():
    """The typed ``preview`` param (desktop sends it after parsing ctx.arg) must
    answer the same report; ``focus_topic`` keeps the remaining focus text."""
    history = _make_history()
    session = _make_session(_make_agent(), list(history))

    r = _run_compress(
        "sid-preview-flag",
        session,
        {"focus_topic": "database schema", "preview": True},
    )

    assert "error" not in r, f"preview surfaced as error: {r.get('error')}"
    result = r["result"]
    assert result["status"] == "preview"
    lines = "\n".join(result["preview"]["lines"])
    assert "Preview — no changes made." in lines
    assert 'Focus topic: "database schema"' in lines
    assert session["history"] == history
    assert session["history_version"] == 1
    session["agent"]._compress_context.assert_not_called()


def test_session_compress_preview_here_boundary_keeps_tail():
    """``/compress here 1 --preview`` reports the boundary split without mutating."""
    history = _make_history()
    session = _make_session(_make_agent(), list(history))

    r = _run_compress("sid-preview-here", session, {"focus_topic": "here 1 --preview"})

    assert "error" not in r, f"preview surfaced as error: {r.get('error')}"
    result = r["result"]
    assert result["status"] == "preview"
    report = result["preview"]
    assert report["partial"] is True
    assert report["tail_count"] == 2
    assert report["head_count"] == 2
    assert session["history"] == history
    session["agent"]._compress_context.assert_not_called()
