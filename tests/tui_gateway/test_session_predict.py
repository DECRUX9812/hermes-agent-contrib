"""``session.predict_next`` — composer predictions. Opt-in through ``auxiliary.composer_prediction``
in the profile's config.yaml; when on, one utility-model call drafts the user's next message in
their own voice from the stored transcript, without writing to it."""

from types import SimpleNamespace

import pytest

import agent.auxiliary_client as aux
from tui_gateway import server
from tui_gateway.methods_session_predict import clean_prediction


@pytest.fixture(autouse=True)
def _hermes_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    # The gateway reads config.yaml from its launch home, captured at import.
    monkeypatch.setattr(server, "_hermes_home", tmp_path)


class _Peer:
    def write(self, obj):
        return True


def _predict(session_id):
    return server.dispatch(
        {"jsonrpc": "2.0", "id": 9, "method": "session.predict_next", "params": {"session_id": session_id}}, _Peer())


def _stub_call_llm(monkeypatch, answer="ok ship it"):
    calls = []

    def fake_call_llm(task=None, *, messages=None, **kwargs):
        calls.append({"task": task, "messages": messages})
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=answer))])

    monkeypatch.setattr(aux, "call_llm", fake_call_llm)
    return calls


def _seed(tmp_path, *, enabled, last_role="assistant"):
    from hermes_state import SessionDB

    (tmp_path / "config.yaml").write_text(
        f"auxiliary:\n  composer_prediction:\n    enabled: {'true' if enabled else 'false'}\n")
    db = SessionDB(db_path=tmp_path / "state.db")
    try:
        db.create_session("sess-p", "desktop")
        db.append_message("sess-p", "user", "yo can u fix the header thx")
        db.append_message("sess-p", "assistant", "Header fixed. Want me to deploy it?")
        if last_role == "user":
            db.append_message("sess-p", "user", "wait")
    finally:
        db.close()
    return "sess-p"


def test_predicts_in_the_users_voice_when_enabled_and_leaves_the_transcript_alone(tmp_path, monkeypatch):
    sid = _seed(tmp_path, enabled=True)
    calls = _stub_call_llm(monkeypatch, answer='User: "ok ship it"')

    res = _predict(sid)

    assert res["result"] == {"text": "ok ship it"}, res
    assert calls[0]["task"] == "composer_prediction"
    prompt = calls[0]["messages"][-1]["content"]
    # The user's own lines ride along as style samples, the assistant's last word as context.
    assert "- yo can u fix the header thx" in prompt and "Want me to deploy it?" in prompt
    assert len(server._get_db().get_messages_as_conversation(sid)) == 2


def test_disabled_by_config_answers_empty_without_a_model_call(tmp_path, monkeypatch):
    sid = _seed(tmp_path, enabled=False)
    calls = _stub_call_llm(monkeypatch)

    assert _predict(sid)["result"] == {"text": ""}
    assert calls == []


def test_no_prediction_while_the_user_spoke_last(tmp_path, monkeypatch):
    sid = _seed(tmp_path, enabled=True, last_role="user")
    calls = _stub_call_llm(monkeypatch)

    assert _predict(sid)["result"] == {"text": ""}
    assert calls == []


def test_clean_prediction_drops_answers_that_are_not_a_single_message():
    assert clean_prediction("Sure!\n\nHere is a long plan with many steps") == ""
    assert clean_prediction("x" * 400) == ""
    assert clean_prediction("  “deploy it”  ") == "deploy it"
