"""Turn markers carry writer identity so a shared HERMES_HOME does not duplicate a live turn (#94778).

``record_turn_start`` stamps the marker with the writing backend's identity (pid + per-boot token +
host). On ``session.resume``, ``_maybe_schedule_auto_continue`` must skip the continuation when the
recorded writer is a *different* backend process that is still alive on this host — its turn is still
running, and auto-continuing would run it twice. A dead writer (the crash case the marker exists for),
a legacy writer-less marker, and our own backend's leftover stamp all still schedule.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
import types

import pytest

from tui_gateway import server
from tui_gateway.turn_marker import read_turn_marker, record_turn_start


class _InlineThread:
    """Run threads synchronously so tests observe final state."""

    def __init__(self, target=None, daemon=None, args=(), kwargs=None, name=None):
        self._target = target
        self._args = args
        self._kwargs = kwargs or {}

    def start(self):
        if self._target is not None:
            self._target(*self._args, **self._kwargs)

    def is_alive(self):
        return False

    def join(self, timeout=None):
        return None


def _session(**extra):
    return {
        "agent": types.SimpleNamespace(),
        "session_key": "session-key",
        "history": [],
        "history_lock": threading.Lock(),
        "running": False,
        "attached_images": [],
        "inflight_turn": None,
        **extra,
    }


@pytest.fixture()
def marker_home(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    return tmp_path


@pytest.fixture()
def schedule_env(monkeypatch, marker_home):
    monkeypatch.setattr(server.threading, "Thread", _InlineThread)
    monkeypatch.setattr(server, "_start_agent_build", lambda sid, session: None)
    monkeypatch.setattr(server, "_wait_agent", lambda session, rid, timeout=30.0: None)
    monkeypatch.setattr(server, "_load_cfg", lambda: {})
    submitted: list = []
    monkeypatch.setattr(
        server,
        "_run_prompt_submit",
        lambda rid, sid, session, text, **kw: submitted.append((text, kw)),
    )
    return submitted


def _write_marker(home, key: str, prompt: str, writer: dict | None) -> None:
    path = home / "desktop" / "interrupted_turns.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = {"attempts": 0, "prompt": prompt, "started_at": time.time(), "auto_continue": True}
    if writer is not None:
        entry["writer"] = writer
    path.write_text(json.dumps({key: entry}))


def _dead_pid() -> int:
    proc = subprocess.Popen([sys.executable, "-c", ""])
    proc.wait()
    return proc.pid


def test_live_foreign_writer_is_not_continued(schedule_env, marker_home):
    """Backend B sharing this HERMES_HOME sees A's marker while A's process still runs."""
    _write_marker(
        marker_home,
        "session-key",
        "still running on backend A",
        {"pid": os.getpid(), "boot": "backend-A-boot", "host": socket.gethostname()},
    )
    session = _session()

    result = server._maybe_schedule_auto_continue("sid", session, "session-key")

    assert result is None
    assert not schedule_env
    assert "_auto_continue_scheduled" not in session
    # The live writer's own turn conclusion clears the marker — we must not.
    assert read_turn_marker(marker_home, "session-key") is not None


def test_dead_writer_schedules_continuation(schedule_env, marker_home):
    """The crash case: the writing backend's pid is gone, so the marker means the turn died."""
    _write_marker(
        marker_home,
        "session-key",
        "crashed mid-turn",
        {"pid": _dead_pid(), "boot": "backend-A-boot", "host": socket.gethostname()},
    )

    result = server._maybe_schedule_auto_continue("sid", _session(), "session-key")

    assert result is not None
    assert len(schedule_env) == 1


def test_own_writer_stamp_still_schedules(schedule_env, marker_home):
    """A marker this same backend wrote (e.g. a failed clear) stays on the crash-recovery path."""
    record_turn_start(marker_home, "session-key", "our own leftover")

    result = server._maybe_schedule_auto_continue("sid", _session(), "session-key")

    assert result is not None
    assert len(schedule_env) == 1


def test_legacy_marker_without_writer_schedules(schedule_env, marker_home):
    """Markers written before the writer field existed keep the old crash-recovery behavior."""
    _write_marker(marker_home, "session-key", "legacy prompt", None)

    result = server._maybe_schedule_auto_continue("sid", _session(), "session-key")

    assert result is not None
    assert len(schedule_env) == 1


def test_record_turn_start_stamps_writer_identity(tmp_path):
    record_turn_start(tmp_path, "abc", "prompt")

    marker = read_turn_marker(tmp_path, "abc")
    writer = marker["writer"]
    assert writer["pid"] == os.getpid()
    assert writer["boot"]
    assert writer["host"] == socket.gethostname()
