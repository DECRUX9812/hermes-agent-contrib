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
