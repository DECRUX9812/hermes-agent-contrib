"""#96793: session.create persists a hidden draft row so a backend restart before the first
prompt no longer orphans the session id, while a never-prompted draft still stays out of the
default sidebar listing (no "Untitled" litter regression)."""

from hermes_state import SessionDB


def _patch_server(monkeypatch, db):
    monkeypatch.setattr("hermes_cli.banner.prefetch_update_check", lambda: None)
    from tui_gateway import server
    monkeypatch.setattr(server, "_get_db", lambda: db)
    monkeypatch.setattr(server, "_sessions", {})
    monkeypatch.setattr(server, "_load_cfg", lambda: {})
    monkeypatch.setattr(server, "_profile_home", lambda *a: None)
    monkeypatch.setattr(server, "_resolve_model", lambda: "test-model")
    monkeypatch.setattr(server, "_enable_gateway_prompts", lambda: None)
    monkeypatch.setattr(server, "_schedule_agent_build", lambda *a: None)
    monkeypatch.setattr(server, "_schedule_session_cap_enforcement", lambda: None)
    monkeypatch.setattr(server, "_register_session_cwd", lambda *a: None)
    monkeypatch.setattr(server, "_project_info_for_cwd", lambda *a: None)
    return server


def test_draft_row_survives_restart_stays_unlisted_then_adopted(monkeypatch, tmp_path):
    project = tmp_path / "proj"
    project.mkdir()
    db = SessionDB(tmp_path / "state.db")
    server = _patch_server(monkeypatch, db)
    try:
        response = server._methods["session.create"]("r1", {"source": "desktop", "cwd": str(project)})
        assert "error" not in response, response
        sid = response["result"]["session_id"]
        key = response["result"]["stored_session_id"]
        record = server._sessions[sid]
    finally:
        db.close()

    # A FRESH handle simulates the backend restarting before the first prompt: the id must
    # still resolve (resume path) rather than 404, but must not litter the default listing.
    fresh = SessionDB(tmp_path / "state.db")
    try:
        assert fresh.get_session(key) is not None
        assert fresh.resolve_session_id(key) == key
        listed = {s["id"] for s in fresh.list_sessions_rich(limit=50)}
        assert key not in listed

        # The first real activity (prompt.submit → _ensure_session_db_row) adopts the
        # placeholder: the row unhides and joins the listing instead of a new row appearing.
        monkeypatch.setattr(server, "_get_db", lambda: fresh)
        assert server._ensure_session_db_row(record) is not False
        row = fresh.get_session(key)
        assert row is not None and not row["hidden"]
        assert key in {s["id"] for s in fresh.list_sessions_rich(limit=50)}
    finally:
        fresh.close()
