"""``hermes -p X serve --isolated`` runs a dedicated server scoped to X.

That server records ``app.state.serving_profile = "X"``; every profile-scoped
endpoint must then refuse to open another profile's home — ``?profile=Y`` was
previously resolved happily and returned Y's sessions (#76932). A multiplex or
default serve leaves the flag unset and keeps per-request ``?profile=``
behaviour.
"""

import pytest


@pytest.fixture
def profiles_on_disk(tmp_path, monkeypatch, _isolate_hermes_home):
    """An isolated default home plus one named profile, each with a state.db."""
    from hermes_cli import profiles
    from hermes_constants import get_hermes_home

    default_home = get_hermes_home()
    profiles_root = default_home / "profiles"
    worker_home = profiles_root / "worker"

    for home in (default_home, worker_home):
        home.mkdir(parents=True, exist_ok=True)
        (home / "config.yaml").write_text("{}\n", encoding="utf-8")

    monkeypatch.setattr(profiles, "_get_default_hermes_home", lambda: default_home)
    monkeypatch.setattr(profiles, "_get_profiles_root", lambda: profiles_root)

    return {"default": default_home, "worker": worker_home}


@pytest.fixture
def client(monkeypatch, profiles_on_disk):
    try:
        from starlette.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi/starlette not installed")

    import hermes_state
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app
    from hermes_constants import get_hermes_home

    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", get_hermes_home() / "state.db")
    c = TestClient(app)
    c.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN

    return c


@pytest.fixture
def dedicated_client(client, monkeypatch):
    """The app state ``hermes -p worker serve --isolated`` records at launch."""
    from hermes_cli.web_server import app

    monkeypatch.setattr(app.state, "serving_profile", "worker", raising=False)
    return client


def _seed_session(home, session_id, *, source="cli"):
    from hermes_state import SessionDB

    db = SessionDB(db_path=home / "state.db")
    try:
        db.create_session(session_id, source=source)
        db.append_message(session_id=session_id, role="user", content="hi")
    finally:
        db.close()


class TestDedicatedServeProfileScope:

    def test_other_profiles_sessions_are_rejected(self, dedicated_client, profiles_on_disk):
        _seed_session(profiles_on_disk["default"], "default-chat")
        _seed_session(profiles_on_disk["worker"], "worker-chat")

        resp = dedicated_client.get("/api/sessions", params={"profile": "default"})
        assert resp.status_code == 403

        resp = dedicated_client.get("/api/sessions", params={"profile": "worker"})
        assert resp.status_code == 200
        assert {s["id"] for s in resp.json()["sessions"]} == {"worker-chat"}

    def test_aggregate_sessions_lists_only_the_serving_profile(self, dedicated_client, profiles_on_disk):
        _seed_session(profiles_on_disk["default"], "default-chat")
        _seed_session(profiles_on_disk["worker"], "worker-chat")

        payload = dedicated_client.get("/api/profiles/sessions").json()
        assert {s["id"] for s in payload["sessions"]} == {"worker-chat"}
        assert {s["profile"] for s in payload["sessions"]} == {"worker"}

        resp = dedicated_client.get("/api/profiles/sessions", params={"profile": "default"})
        assert resp.status_code == 403

    def test_multiplex_serve_keeps_per_request_profile_scope(self, client, profiles_on_disk):
        """No ``serving_profile`` recorded: the machine dashboard still serves every profile."""
        _seed_session(profiles_on_disk["default"], "default-chat")
        _seed_session(profiles_on_disk["worker"], "worker-chat")

        resp = client.get("/api/sessions", params={"profile": "default"})
        assert resp.status_code == 200
        assert {s["id"] for s in resp.json()["sessions"]} == {"default-chat"}

        payload = client.get("/api/profiles/sessions").json()
        assert {s["profile"] for s in payload["sessions"]} == {"default", "worker"}
