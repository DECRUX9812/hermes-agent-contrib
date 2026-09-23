"""Cron preflight must probe state.db availability before dispatch (#97635).

Every agent cron run opens the profile's ``state.db`` (``_open_cron_session_db``) and loads
persistent memory (``skip_memory=False``). A home DB held exclusively by another process
(e.g. a desktop session that left ``state.db-wal`` write-locked) makes the run fail or
silently lose its session store at run time — after provider resolution, agent construction,
and prompt build have already spent. Preflight must return a ``blocked_config`` reason naming
the DB path instead.

``no_agent`` jobs never open ``state.db`` (they short-circuit before SessionDB), so the probe
must not block them.
"""

import contextlib
import sqlite3
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from cron.scheduler_preflight import _preflight_job_config


def _job(**overrides):
    job = {
        "id": "pf-db",
        "name": "state-db probe job",
        "prompt": "summarize memories",
        "deliver": "local",
    }
    job.update(overrides)
    return job


def _make_state_db(home: Path) -> Path:
    db_path = home / "state.db"
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE t (x INTEGER)")
    conn.commit()
    conn.close()
    return db_path


@contextlib.contextmanager
def _held_write_lock(db_path: Path):
    """Simulate another process holding the WAL write lock on state.db."""
    conn = sqlite3.connect(db_path, timeout=0)
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("INSERT INTO t VALUES (1)")
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


@contextlib.contextmanager
def _preflight_patches(home: Path):
    with patch("cron.scheduler._hermes_home", home), \
            patch("hermes_cli.runtime_provider.resolve_runtime_provider",
                  return_value=MagicMock()):
        yield


def test_locked_state_db_blocks_with_path(tmp_path):
    db_path = _make_state_db(tmp_path)
    with _held_write_lock(db_path), _preflight_patches(tmp_path):
        reason = _preflight_job_config(_job(), {})
    assert reason is not None, "locked state.db must produce a blocked reason"
    assert str(db_path) in reason


def test_unlocked_state_db_passes(tmp_path):
    _make_state_db(tmp_path)
    with _preflight_patches(tmp_path):
        assert _preflight_job_config(_job(), {}) is None


def test_no_agent_job_not_blocked_by_locked_state_db(tmp_path):
    db_path = _make_state_db(tmp_path)
    with _held_write_lock(db_path), _preflight_patches(tmp_path):
        assert _preflight_job_config(_job(no_agent=True), {}) is None
