"""The desktop client's create/send keys pass the wire contract (no 4000 "out of sync").

The desktop sends ``request_id`` on session.create and ``submission_id`` on prompt.submit.
Both were refused as unknown keys, so every new chat and every prompt failed.
"""

from tui_gateway.contracts import registry
from tui_gateway.methods_session import _create_idempotency_key


def _problem(method: str, params: dict):
    return registry.validate_params(registry.METHODS[method], params)[1]


def test_session_create_accepts_request_id():
    assert _problem("session.create", {"profile": "default", "source": "desktop", "request_id": "r-1"}) is None


def test_prompt_submit_accepts_submission_id():
    assert _problem("prompt.submit", {"session_id": "s", "text": "hi", "submission_id": "sub-1"}) is None


def test_unknown_keys_are_still_refused():
    assert "nope" in (_problem("session.create", {"nope": 1}) or "")
    assert "nope" in (_problem("prompt.submit", {"session_id": "s", "text": "hi", "nope": 1}) or "")


def test_request_id_maps_onto_idempotency_key():
    assert _create_idempotency_key({"request_id": "r-1"}) == "r-1"
    assert _create_idempotency_key({"idempotency_key": "k-1", "request_id": "r-1"}) == "k-1"
    assert _create_idempotency_key({}) is None


# ── prompt.submit answers as a canonical admission receipt ────────────────────────────────────

def _receipt(resp, params):
    from tui_gateway.methods_prompt import _with_admission_receipt
    return _with_admission_receipt(resp, params)


def test_admitted_submit_carries_the_receipt_destination_the_client_checks():
    params = {"session_id": "s-1", "submission_id": "sub-9", "text": "hi"}
    out = _receipt({"jsonrpc": "2.0", "id": 1, "result": {"status": "streaming", "user_row_id": 4}}, params)
    result = out["result"]
    # The desktop refuses a receipt unless ref.session_id echoes the sent id and admission_id is a string.
    assert result["ref"] == {"profile_id": "default", "session_id": "s-1"}
    assert result["admission_id"] == "sub-9"
    assert result["status"] == "streaming" and result["user_row_id"] == 4


def test_a_ledger_admission_id_wins_and_a_missing_submission_id_still_gets_one():
    queued = _receipt({"result": {"status": "queued", "admission_id": "adm-1"}},
                      {"session_id": "s", "submission_id": "sub", "profile": "coder"})["result"]
    assert queued["admission_id"] == "adm-1" and queued["ref"]["profile_id"] == "coder"
    bare = _receipt({"result": {"status": "streaming"}}, {"session_id": "s"})["result"]
    assert isinstance(bare["admission_id"], str) and bare["admission_id"]


def test_errors_and_the_voice_stop_reply_pass_through_unchanged():
    err = {"jsonrpc": "2.0", "id": 1, "error": {"code": 4009, "message": "session busy"}}
    assert _receipt(dict(err), {"session_id": "s", "submission_id": "x"}) == err
    stopped = {"result": {"voice_stopped": True}}
    assert _receipt(stopped, {"session_id": "s", "submission_id": "x"}) == {"result": {"voice_stopped": True}}


def test_the_result_contract_accepts_the_receipt_fields():
    from tui_gateway.contracts.prompt_voice import PromptSubmitResult
    r = PromptSubmitResult.model_validate(
        {"status": "streaming", "admission_id": "a", "ref": {"profile_id": "default", "session_id": "s"}})
    assert r.ref == {"profile_id": "default", "session_id": "s"}
