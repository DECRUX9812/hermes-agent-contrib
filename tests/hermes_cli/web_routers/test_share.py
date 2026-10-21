"""Session share links: capability-token grants + the public read path.

Two layers, both E2E against real state:

* ``share_grants`` — mint/resolve/revoke/expire against a real temp home; the
  on-disk file must store a token HASH, never the token.
* ``web_routers/share`` — TestClient against the real ``app``: management
  routes sit behind the session-token gate, ``/api/share/view`` +
  ``/share/view`` are public but capability-secured, and the transcript read
  is sanitized (user/assistant text + tool-call NAMES only — a leaked link
  must not expose tool args, results, or system rows).

Profile scope is exercised for real (A→B→A): a grant minted under one home
resolves only there — the same token under another home is a 404, because a
share URL must never leak one profile's transcript through another's.
"""
import json
import os
import stat
import time
from pathlib import Path

import pytest


@pytest.fixture
def client():
    try:
        from starlette.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi/starlette not installed")
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app
    c = TestClient(app)
    c.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return c


@pytest.fixture
def seeded_home():
    """A real SessionDB at the serving home's state.db with a mixed transcript."""
    import hermes_state
    from hermes_state import SessionDB

    home = Path(hermes_state._default_db_path()).parent
    db = SessionDB(home / "state.db")
    try:
        db.create_session("sess-shared", "test", model="test-model")
        db.append_message("sess-shared", "system", "secret system prompt")
        db.append_message("sess-shared", "user", "hello from the user")
        db.append_message("sess-shared", "assistant", "assistant reply",
                          tool_calls=[{"name": "terminal", "arguments": {"command": "rm -rf /"}}])
        db.append_message("sess-shared", "tool", "dangerous tool output", tool_name="terminal")
        db.append_message("sess-shared", "assistant", "second reply")
        yield home
    finally:
        db.close()


def _grants_file(home: Path) -> dict:
    return json.loads((home / "share_grants.json").read_text(encoding="utf-8"))


# ── share_grants store ────────────────────────────────────────────────────────


class TestShareGrants:
    def test_mint_resolve_roundtrip(self, tmp_path):
        from hermes_cli import share_grants

        minted = share_grants.mint_share("sess-1", tmp_path, ttl_seconds=3600)
        assert len(minted["token"]) >= 32
        assert minted["expires_at"] and minted["expires_at"] > time.time()
        assert share_grants.resolve_share(minted["token"], tmp_path) == {"session_id": "sess-1"}

    def test_file_stores_hash_not_token_and_is_owner_only(self, tmp_path):
        from hermes_cli import share_grants

        minted = share_grants.mint_share("sess-1", tmp_path)
        raw = (tmp_path / "share_grants.json").read_text(encoding="utf-8")
        assert minted["token"] not in raw
        grant = _grants_file(tmp_path)["grants"][0]
        assert grant["token_hash"] != minted["token"]
        mode = stat.S_IMODE(os.stat(tmp_path / "share_grants.json").st_mode)
        assert mode == 0o600

    def test_revoke_kills_resolution(self, tmp_path):
        from hermes_cli import share_grants

        minted = share_grants.mint_share("sess-1", tmp_path)
        assert share_grants.revoke_share(minted["token"], tmp_path) is True
        assert share_grants.resolve_share(minted["token"], tmp_path) is None
        # Second revoke is a no-op, not an error.
        assert share_grants.revoke_share(minted["token"], tmp_path) is False

    def test_expired_grant_stops_resolving(self, tmp_path):
        from hermes_cli import share_grants

        minted = share_grants.mint_share("sess-1", tmp_path, ttl_seconds=60)
        data = _grants_file(tmp_path)
        data["grants"][0]["expires_at"] = time.time() - 1
        (tmp_path / "share_grants.json").write_text(json.dumps(data), encoding="utf-8")
        assert share_grants.resolve_share(minted["token"], tmp_path) is None

    def test_short_tokens_never_resolve(self, tmp_path):
        from hermes_cli import share_grants

        share_grants.mint_share("sess-1", tmp_path)
        assert share_grants.resolve_share("", tmp_path) is None
        assert share_grants.resolve_share("tooshort", tmp_path) is None

    def test_grants_are_home_scoped(self, tmp_path):
        """The same token under a different home resolves nothing — cross-home
        replay must fail closed or one profile's link reads another's transcript."""
        from hermes_cli import share_grants

        other = tmp_path / "other"
        other.mkdir()
        minted = share_grants.mint_share("sess-1", tmp_path)
        assert share_grants.resolve_share(minted["token"], other) is None
        share_grants.mint_share("sess-1", other)
        assert share_grants.resolve_share(minted["token"], tmp_path) is not None

    def test_list_never_returns_raw_token(self, tmp_path):
        from hermes_cli import share_grants

        minted = share_grants.mint_share("sess-1", tmp_path)
        shares = share_grants.list_shares("sess-1", tmp_path)
        assert len(shares) == 1
        assert shares[0]["token_preview"] == minted["token"][-6:]
        assert minted["token"] not in json.dumps(shares)

    def test_session_cap(self, tmp_path):
        from hermes_cli import share_grants

        for _ in range(share_grants._MAX_ACTIVE_PER_SESSION):
            share_grants.mint_share("sess-cap", tmp_path)
        with pytest.raises(ValueError):
            share_grants.mint_share("sess-cap", tmp_path)
        # A different session is unaffected.
        share_grants.mint_share("sess-other", tmp_path)


# ── router: management + public read ─────────────────────────────────────────


class TestShareRoutes:
    def test_create_returns_path_and_absolute_url(self, client, seeded_home):
        resp = client.post("/api/share/create", json={"session_id": "sess-shared"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["path"].startswith("/share/view?t=")
        # p= stays omitted for the serving home: under a named-profile launch
        # "default" is a DIFFERENT home than the one that holds the grant.
        assert "p=" not in body["path"]
        assert body["url"].endswith(body["path"])
        assert body["url"].startswith("http")

    def test_view_returns_sanitized_events(self, client, seeded_home):
        token = client.post("/api/share/create", json={"session_id": "sess-shared"}).json()["token"]

        resp = client.get(f"/api/share/view?t={token}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["model"] == "test-model"
        assert resp.headers["cache-control"] == "no-store"

        events = body["events"]
        roles = [e["role"] for e in events]
        # system + tool rows are filtered; user/assistant only.
        assert roles == ["user", "assistant", "assistant"]
        texts = json.dumps(events)
        assert "secret system prompt" not in texts
        assert "dangerous tool output" not in texts
        # Tool calls surface as NAMES only — never their arguments.
        assert "terminal" in texts
        assert "rm -rf" not in texts
        assert events[1]["tools"] == ["terminal"]

    def test_view_is_public_without_session_header(self, client, seeded_home):
        token = client.post("/api/share/create", json={"session_id": "sess-shared"}).json()["token"]
        resp = client.get(f"/api/share/view?t={token}",
                          headers={"X-Hermes-Session-Token": "bogus"})
        assert resp.status_code == 200

    def test_management_requires_session_token(self, seeded_home):
        try:
            from starlette.testclient import TestClient
        except ImportError:
            pytest.skip("fastapi/starlette not installed")
        from hermes_cli.web_server import app
        anon = TestClient(app)
        assert anon.post("/api/share/create", json={"session_id": "sess-shared"}).status_code in (401, 403)

    def test_after_id_pages_the_transcript(self, client, seeded_home):
        token = client.post("/api/share/create", json={"session_id": "sess-shared"}).json()["token"]
        first = client.get(f"/api/share/view?t={token}").json()
        assert first["next_after_id"] == first["events"][-1]["id"]

        again = client.get(f"/api/share/view?t={token}&after_id={first['next_after_id']}").json()
        assert again["events"] == []
        assert again["next_after_id"] == first["next_after_id"]

        # A new message shows up on the next poll — the view is LIVE.
        from hermes_state import SessionDB
        import hermes_state
        db = SessionDB(hermes_state._default_db_path())
        try:
            db.append_message("sess-shared", "assistant", "late arrival")
        finally:
            db.close()
        third = client.get(f"/api/share/view?t={token}&after_id={first['next_after_id']}").json()
        assert [e["text"] for e in third["events"]] == ["late arrival"]

    def test_revoked_link_404s_everywhere(self, client, seeded_home):
        token = client.post("/api/share/create", json={"session_id": "sess-shared"}).json()["token"]
        assert client.post("/api/share/revoke", json={"token": token}).json() == {"revoked": True}
        assert client.get(f"/api/share/view?t={token}").status_code == 404
        assert client.get(f"/share/view?t={token}").status_code == 404

    def test_bogus_token_404s_like_a_dead_one(self, client, seeded_home):
        assert client.get("/api/share/view?t=nonsense-token-value").status_code == 404
        assert client.get("/share/view?t=nonsense-token-value").status_code == 404

    def test_viewer_page_serves_for_live_grant(self, client, seeded_home):
        token = client.post("/api/share/create", json={"session_id": "sess-shared"}).json()["token"]
        resp = client.get(f"/share/view?t={token}")
        assert resp.status_code == 200
        assert "noindex" in resp.headers.get("x-robots-tag", "")
        assert "/api/share/view" in resp.text

    def test_cross_profile_replay_fails(self, client, seeded_home, monkeypatch):
        """A grant minted for profile B's session must NOT resolve when the URL
        points at profile A — token replay across homes fails closed, so one
        profile's link can never read another's transcript."""
        import hermes_state
        from hermes_cli import profiles
        from hermes_state import SessionDB

        launch_home = seeded_home
        beta = launch_home / "profiles" / "beta"
        beta.mkdir(parents=True)
        (beta / ".env").write_text("BETA=1\n", encoding="utf-8")
        monkeypatch.setattr(profiles, "_get_profiles_root", lambda: launch_home / "profiles")

        # Beta has its own state.db with its own session carrying distinct text.
        beta_db = SessionDB(beta / "state.db")
        try:
            beta_db.create_session("sess-beta", "test", model="beta-model")
            beta_db.append_message("sess-beta", "user", "beta-only content")
        finally:
            beta_db.close()

        # Mint under beta via the management route with an explicit profile.
        resp = client.post("/api/share/create",
                           json={"session_id": "sess-beta", "profile": "beta"})
        assert resp.status_code == 200
        body = resp.json()
        assert "p=beta" in body["path"]
        token = body["token"]

        # Stamped for beta: serves beta's transcript.
        ok = client.get(f"/api/share/view?p=beta&t={token}")
        assert ok.status_code == 200
        assert ok.json()["model"] == "beta-model"
        assert [e["text"] for e in ok.json()["events"]] == ["beta-only content"]

        # Same token unstamped (serving home): the grant lives in beta's home,
        # so it resolves nothing here — even though a session of the same id
        # pattern exists in the launch store, no transcript leaks.
        assert client.get(f"/api/share/view?t={token}").status_code == 404

        # And the serving home's own link never reaches beta's rows: mint on
        # the serving session, then replay it stamped for beta — beta's store
        # has no grant for it.
        other = client.post("/api/share/create", json={"session_id": "sess-shared"}).json()["token"]
        assert client.get(f"/api/share/view?p=beta&t={other}").status_code == 404
