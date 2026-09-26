"""``session.ask`` — the companion thread: a one-shot utility-model answer over the stored
transcript. Covers the read-only transcript pick (stored id/prefix, live runtime id), the
prior-exchange replay, transcript truncation, and the error paths — the handler must never
write to the session it reads.
"""

import threading
from types import SimpleNamespace

import pytest

import agent.auxiliary_client as aux
from tui_gateway import server


@pytest.fixture(autouse=True)
def _hermes_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))


class _Peer:
    def write(self, obj):
        return True


def _ask(params):
    return server.dispatch({"jsonrpc": "2.0", "id": 7, "method": "session.ask", "params": params}, _Peer())


def _stub_call_llm(monkeypatch, answer="it scaffolded src/api.py"):
    calls = []

    def fake_call_llm(task=None, *, messages=None, **kwargs):
        calls.append({"task": task, "messages": messages, **kwargs})
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=answer))])

    monkeypatch.setattr(aux, "call_llm", fake_call_llm)
    return calls


def _seed_session(tmp_path, session_id="sess-ask-1"):
    from hermes_state import SessionDB

    db = SessionDB(db_path=tmp_path / "state.db")
    try:
        db.create_session(session_id, "desktop")
        db.append_message(session_id, "user", "scaffold the api")
        db.append_message(session_id, "assistant", "created src/api.py",
                          tool_calls=[{"id": "t1", "type": "function",
                                       "function": {"name": "write_file", "arguments": "{}"}}])
        db.append_message(session_id, "tool", "wrote 80 lines", tool_name="write_file")
        db.append_message(session_id, "assistant", "done — src/api.py is up")
    finally:
        db.close()
    return session_id


def test_ask_answers_over_the_stored_transcript_without_writing_to_it(tmp_path, monkeypatch):
    sid = _seed_session(tmp_path)
    calls = _stub_call_llm(monkeypatch)

    res = _ask({"session_id": sid, "question": "what did it build?"})

    assert res["result"]["answer"] == "it scaffolded src/api.py", res
    assert res["result"]["resolved_id"] == sid
    assert res["result"]["messages_considered"] >= 3
    assert res["result"]["truncated"] is False
    wire = calls[0]
    assert wire["task"] == "session_ask"
    user_block = wire["messages"][-1]["content"]
    assert "scaffold the api" in user_block and "wrote 80 lines" in user_block
    assert "[calls write_file]" in user_block or "write_file" in user_block
    # Read-only: the transcript must be byte-identical afterwards.
    rows = server._get_db().get_messages_as_conversation(sid)
    assert len(rows) == 4 and "session.ask" not in str(rows)


def test_ask_resolves_a_prefix_and_replays_prior_exchanges(tmp_path, monkeypatch):
    sid = _seed_session(tmp_path)
    calls = _stub_call_llm(monkeypatch)

    res = _ask({"session_id": sid[:8], "question": "and the tests?",
                "history": [{"question": "what did it build?", "answer": "it scaffolded src/api.py"},
                            {"question": "", "answer": "half-empty pair is dropped"}]})

    assert res["result"]["resolved_id"] == sid
    user_block = calls[0]["messages"][-1]["content"]
    assert "Earlier questions and answers" in user_block
    assert "half-empty pair" not in user_block


def test_ask_uses_the_live_sessions_stored_rows(tmp_path, monkeypatch):
    """A live runtime id resolves through ``_sessions`` to its session key — the DURABLE rows,
    not a mutable in-flight history, are what get digested."""
    sid = _seed_session(tmp_path)
    _stub_call_llm(monkeypatch)
    runtime_id = "ui-runtime-9"
    server._sessions[runtime_id] = {
        "session_key": sid, "history": [{"role": "user", "content": "in-flight, unpersisted"}],
        "history_lock": threading.Lock(), "running": True}
    try:
        res = _ask({"session_id": runtime_id, "question": "summarize it"})
    finally:
        server._sessions.pop(runtime_id, None)
    assert res["result"]["resolved_id"] == sid, res


def test_ask_rejects_missing_question_and_unknown_session(tmp_path, monkeypatch):
    _seed_session(tmp_path)
    _stub_call_llm(monkeypatch)

    missing = _ask({"session_id": "sess-ask-1"})
    assert missing["error"]["code"] == 4033
    unknown = _ask({"session_id": "nope-nope", "question": "hi"})
    assert unknown["error"]["code"] == 4001


def test_ask_reports_model_failure_without_touching_the_transcript(tmp_path, monkeypatch):
    sid = _seed_session(tmp_path)

    def boom(task=None, **kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(aux, "call_llm", boom)
    res = _ask({"session_id": sid, "question": "what happened?"})
    assert res["error"]["code"] == 5030
    assert "provider down" in res["error"]["message"]
    assert len(server._get_db().get_messages_as_conversation(sid)) == 4


def test_digest_keeps_head_and_tail_and_marks_truncated(monkeypatch):
    from tui_gateway.methods_session_ask import _digest_transcript

    messages = [{"role": "user", "content": f"turn {i}: " + "x" * 400}
                for i in range(200)]
    digest, considered, truncated = _digest_transcript(messages)
    assert truncated and considered < 200
    assert "turn 0" in digest and "turn 199" in digest and "omitted" in digest
    small = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hey"}]
    digest, considered, truncated = _digest_transcript(small)
    assert not truncated and considered == 2
