"""Mobile companion router (roadmap #45): pairing, overview, respond, reply."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

pytest.importorskip("httpx", reason="TestClient needs httpx")

from hermes_cli.web_routers import mobile


@pytest.fixture()
def client(monkeypatch):
    mobile._reset_for_tests()
    monkeypatch.setattr("hermes_cli.web_server._SESSION_TOKEN", "test-session-token", raising=False)
    app = FastAPI()
    app.state.auth_required = False
    app.include_router(mobile.router)
    return TestClient(app)


def _fake_sessions(monkeypatch, entries):
    """Seed ``server._sessions`` with the fields the overview reads."""
    sessions = {sid: dict(rec) for sid, rec in entries}
    monkeypatch.setattr("tui_gateway.server._sessions", sessions, raising=False)


def _open_request(monkeypatch, sid, method="approval", params=None):
    """Insert a real ServerRequest so the overview reads the production path."""
    from tui_gateway import server_requests

    req = server_requests.ServerRequest(sid, method, params or {"command": "rm -rf /tmp/x",
                                                              "choices": ["once", "session", "deny"]})
    server_requests._open[req.id] = req
    return req


@pytest.fixture(autouse=True)
def _clean_requests():
    from tui_gateway import server_requests

    with server_requests._lock:
        saved = dict(server_requests._open)
        server_requests._open.clear()
    yield
    with server_requests._lock:
        server_requests._open.clear()
        server_requests._open.update(saved)


def test_pairing_round_trip(client):
    mint = client.post("/api/mobile/pairing")
    assert mint.status_code == 200
    code = mint.json()["code"]
    assert len(code) == 6 and code.isdigit()

    pair = client.post("/api/mobile/pair", json={"code": code})
    assert pair.status_code == 200
    assert pair.json()["token"] == "test-session-token"

    # Single-use: redeeming the same code again fails.
    assert client.post("/api/mobile/pair", json={"code": code}).status_code == 403


def test_pair_rejects_wrong_code_and_locks_out(client):
    for _ in range(5):
        assert client.post("/api/mobile/pair", json={"code": "000000"}).status_code == 403
    # Lockout engages: even a freshly minted valid code is refused until it lifts.
    code = client.post("/api/mobile/pairing").json()["code"]
    assert client.post("/api/mobile/pair", json={"code": code}).status_code == 429


def test_pairing_refused_on_oauth_gated_deployment(client):
    client.app.state.auth_required = True
    assert client.post("/api/mobile/pairing").status_code == 409
    assert client.post("/api/mobile/pair", json={"code": "123456"}).status_code == 409


def test_overview_lists_live_sessions_with_pending(monkeypatch, client):
    req = _open_request(monkeypatch, "rt-1")
    _fake_sessions(monkeypatch, [
        ("rt-1", {"session_key": "key-1", "running": True, "last_active": 2.0,
                  "cwd": "/tmp/proj", "source": "desktop", "profile_home": None}),
        ("rt-2", {"session_key": "key-2", "running": False, "last_active": 1.0,
                  "cwd": "", "source": "cli", "profile_home": None}),
    ])
    res = client.get("/api/mobile/overview")
    assert res.status_code == 200
    sessions = res.json()["sessions"]
    assert [s["session_id"] for s in sessions] == ["rt-1", "rt-2"]  # needs-you first
    pending = sessions[0]
    assert pending["pending"] == "approval"
    r = pending["requests"][0]
    assert r["id"] == req.id and r["method"] == "approval"
    assert r["summary"] == "rm -rf /tmp/x" and r["choices"] == ["once", "session", "deny"]
    assert sessions[1]["requests"] == [] and sessions[1]["pending"] == ""


def test_respond_proxies_request_answer(monkeypatch, client):
    calls = []

    def fake_handle_request(frame):
        calls.append(frame)
        return {"jsonrpc": "2.0", "id": frame["id"], "result": {"status": "ok"}}

    monkeypatch.setattr("tui_gateway.rpc_dispatch.handle_request", fake_handle_request)
    res = client.post("/api/mobile/respond",
                      json={"request_id": "srq-abc", "result": {"choice": "once"}})
    assert res.status_code == 200 and res.json() == {"status": "ok"}
    assert calls == [{"jsonrpc": "2.0", "method": "request.answer",
                      "id": calls[0]["id"], "params": {"id": "srq-abc", "result": {"choice": "once"}}}]


def test_respond_maps_gateway_errors(monkeypatch, client):
    monkeypatch.setattr("tui_gateway.rpc_dispatch.handle_request",
                        lambda frame: {"jsonrpc": "2.0", "id": frame["id"],
                                       "error": {"code": 4001, "message": "session not found"}})
    res = client.post("/api/mobile/respond", json={"request_id": "x", "result": {}})
    assert res.status_code == 404
    assert client.post("/api/mobile/respond", json={"request_id": "", "result": {}}).status_code == 400


def test_reply_dispatches_prompt_submit(monkeypatch, client):
    calls = []

    def fake_handle_request(frame):
        calls.append(frame)
        return {"jsonrpc": "2.0", "id": frame["id"], "result": {"status": "streaming"}}

    monkeypatch.setattr("tui_gateway.rpc_dispatch.handle_request", fake_handle_request)
    res = client.post("/api/mobile/reply", json={"session_id": "rt-1", "text": "yes, go ahead"})
    assert res.status_code == 200 and res.json()["status"] == "streaming"
    frame = calls[0]
    assert frame["method"] == "prompt.submit"
    assert frame["params"] == {"session_id": "rt-1", "text": "yes, go ahead"}


def test_reply_requires_fields(client):
    assert client.post("/api/mobile/reply", json={"session_id": "", "text": "hi"}).status_code == 400
    assert client.post("/api/mobile/reply", json={"session_id": "s", "text": " "}).status_code == 400


def test_mobile_page_served(client):
    res = client.get("/mobile")
    assert res.status_code == 200 and "text/html" in res.headers["content-type"]
    assert "Hermes companion" in res.text and "/api/mobile/overview" in res.text
    assert "test-session-token" not in res.text  # the shell carries no secrets


def test_pairing_code_expires(monkeypatch, client):
    mint = client.post("/api/mobile/pairing").json()
    # Age the code past its TTL.
    with mobile._pairing_lock:
        mobile._pairing_codes[mint["code"]] = 0.0
    assert client.post("/api/mobile/pair", json={"code": mint["code"]}).status_code == 403
