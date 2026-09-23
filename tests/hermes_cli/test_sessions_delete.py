import signal
import subprocess
import sys
import time

import pytest


def test_sessions_delete_accepts_unique_id_prefix(monkeypatch, capsys):
    import hermes_cli.main as main_mod
    import hermes_state

    captured = {}

    class FakeDB:
        def resolve_session_id(self, session_id):
            captured["resolved_from"] = session_id
            return "20260315_092437_c9a6ff"

        def get_session(self, session_id):
            return {"id": session_id, "pinned": 0}

        def delete_session(self, session_id, **kwargs):
            captured["deleted"] = session_id
            return True

        def close(self):
            captured["closed"] = True

    monkeypatch.setattr(hermes_state, "SessionDB", lambda *args, **kwargs: FakeDB())
    monkeypatch.setattr(
        sys,
        "argv",
        ["hermes", "sessions", "delete", "20260315_092437_c9a6", "--yes"],
    )

    main_mod.main()

    output = capsys.readouterr().out
    assert captured == {
        "resolved_from": "20260315_092437_c9a6",
        "deleted": "20260315_092437_c9a6ff",
        "closed": True,
    }
    assert "Deleted session '20260315_092437_c9a6ff'." in output


_SESSION_ID = "20260315_092437_c9a6ff"


class _DeleteFakeDB:
    def __init__(self, captured):
        self._captured = captured

    def resolve_session_id(self, session_id):
        return _SESSION_ID

    def get_session(self, session_id):
        return {"id": session_id, "pinned": 0}

    def delete_session(self, session_id, **kwargs):
        self._captured["deleted"] = session_id
        return True

    def close(self):
        pass


def _run_delete(monkeypatch, argv_tail):
    import hermes_cli.main as main_mod
    import hermes_state

    captured = {}
    monkeypatch.setattr(
        hermes_state, "SessionDB", lambda *a, **k: _DeleteFakeDB(captured)
    )
    monkeypatch.setattr(sys, "argv", ["hermes", "sessions", "delete", _SESSION_ID, *argv_tail])
    main_mod.main()
    return captured


def _write_foreign_lease(tmp_path, pid):
    """A live lease owned by another (real) process."""
    from hermes_cli import active_sessions as acts

    registry_dir = tmp_path / "runtime"
    registry_dir.mkdir(parents=True, exist_ok=True)
    acts._write_entries(
        acts._state_path(tmp_path),
        [{
            "lease_id": "foreignlease1",
            "session_id": _SESSION_ID,
            "surface": "gateway",
            "pid": pid,
            "process_start_time": acts._process_start_time(pid),
            "started_at": time.time(),
            "updated_at": time.time(),
        }],
    )


def test_sessions_delete_refuses_live_owned_session(monkeypatch, capsys, tmp_path):
    """A live active-session lease must block `sessions delete` (#102895)."""
    import hermes_cli.main as main_mod
    from hermes_cli.active_sessions import try_acquire_active_session

    monkeypatch.setattr(main_mod, "get_hermes_home", lambda: tmp_path)
    lease, refusal = try_acquire_active_session(
        session_id=_SESSION_ID, surface="gateway", config={}, registry_home=tmp_path
    )
    assert refusal is None and lease is not None
    try:
        captured = _run_delete(monkeypatch, ["--yes"])
        out = capsys.readouterr().out
        assert "deleted" not in captured
        assert "gateway" in out  # refusal names the owning surface
    finally:
        lease.release()


def test_sessions_delete_force_terminates_owner_first(monkeypatch, capsys, tmp_path):
    """--force signals the live owner, waits for the lease to drop, then deletes."""
    import hermes_cli.main as main_mod

    owner = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"])
    try:
        _write_foreign_lease(tmp_path, owner.pid)
        monkeypatch.setattr(main_mod, "get_hermes_home", lambda: tmp_path)

        captured = _run_delete(monkeypatch, ["--yes", "--force"])
        assert captured.get("deleted") == _SESSION_ID
        owner.wait(timeout=10)
        assert owner.returncode == -signal.SIGTERM
    finally:
        if owner.poll() is None:
            owner.kill()


def _run_prune(monkeypatch, capsys, argv_tail, candidates=None, skipped_open=0):
    """Run `hermes sessions prune <argv_tail>` against a FakeDB, capturing
    the filter kwargs passed to list_prune_candidates. Auto-confirms."""
    import hermes_cli.main as main_mod
    import hermes_state

    seen = {}
    rows = candidates if candidates is not None else [
        {
            "id": "20260101_000000_aaaaaa",
            "source": "cron",
            "title": "oldest run",
            "started_at": 1_600_000_000.0,
            "last_active": 1_600_000_050.0,
            "ended_at": 1_600_000_100.0,
            "message_count": 2,
            "archived": 0,
        },
        {
            "id": "20260601_000000_bbbbbb",
            "source": "cron",
            "title": "newest run",
            "started_at": 1_700_000_000.0,
            "last_active": 1_700_000_050.0,
            "ended_at": 1_700_000_100.0,
            "message_count": 4,
            "archived": 0,
        },
    ]

    class FakeDB:
        def list_prune_candidates(self, **kwargs):
            seen.update(kwargs)
            return rows

        def count_open_prune_matches(self, **kwargs):
            assert kwargs == seen
            return skipped_open

        def count_prune_matches(self, **kwargs):
            return len(rows)

        def prune_sessions(self, **kwargs):
            return len(rows)

        def close(self):
            pass

    monkeypatch.setattr(hermes_state, "SessionDB", lambda *args, **kwargs: FakeDB())
    monkeypatch.setattr(
        sys, "argv", ["hermes", "sessions", "prune", *argv_tail]
    )
    monkeypatch.setattr("builtins.input", lambda _prompt="": "y")
    main_mod.main()
    return seen, capsys.readouterr().out


def test_sessions_prune_bare_keeps_90_day_default(monkeypatch, capsys):
    """A truly bare `hermes sessions prune` keeps the implicit 90-day cutoff."""
    import time as _time

    filters, _out = _run_prune(monkeypatch, capsys, [])
    assert filters["last_active_before"] is not None
    assert filters["last_active_before"] == pytest.approx(
        _time.time() - 90 * 86400, abs=60
    )


def test_sessions_prune_preview_shows_oldest_newest(monkeypatch, capsys):
    """Confirmation preview surfaces count + oldest/newest session times."""
    from hermes_cli.session_filters import format_epoch

    _filters, out = _run_prune(monkeypatch, capsys, ["--source", "cron"])
    assert "2 session(s) match" in out
    assert f"oldest activity {format_epoch(1_600_000_050.0)}" in out
    assert f"newest activity {format_epoch(1_700_000_050.0)}" in out


def test_sessions_prune_surfaces_matching_open_sessions(monkeypatch, capsys):
    _filters, out = _run_prune(
        monkeypatch,
        capsys,
        ["--source", "cron"],
        candidates=[],
        skipped_open=2,
    )

    assert "2 open sessions also match these filters" in out
    assert "prune only deletes ended sessions" in out
    assert "hermes sessions delete <id>" in out
    assert "No sessions match" in out
