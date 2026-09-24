"""Two sessions in one profile attaching in the same second must not overwrite.

``_queue_attached_image`` names files ``{prefix}_{%Y%m%d_%H%M%S}_{counter}{ext}``
into the *profile's* images dir, while the counter is per-session — two sessions
attaching in the same second produce the identical filename and silently
overwrite each other.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from tui_gateway import server

PNG_A = b"\x89PNG\r\n\x1a\n" + b"A" * 64
PNG_B = b"\x89PNG\r\n\x1a\n" + b"B" * 64


def _session(tmp_path, sid: str) -> dict:
    return {
        "attached_images": [],
        "image_counter": 0,
        "profile_home": str(tmp_path),
        "session_key": sid,
    }


@pytest.fixture
def frozen_clock(monkeypatch):
    class FrozenDateTime:
        @staticmethod
        def now() -> datetime:
            return datetime(2026, 1, 1, 12, 0, 0)

    monkeypatch.setattr(server, "datetime", FrozenDateTime)


def test_same_second_attaches_across_sessions_do_not_collide(tmp_path, frozen_clock):
    path_a = server._queue_attached_image(
        _session(tmp_path, "sid-a"), PNG_A, ".png", prefix="upload")
    path_b = server._queue_attached_image(
        _session(tmp_path, "sid-b"), PNG_B, ".png", prefix="upload")

    assert path_a != path_b
    assert path_a.read_bytes() == PNG_A
    assert path_b.read_bytes() == PNG_B


def test_same_second_attaches_within_a_session_do_not_collide(tmp_path, frozen_clock):
    session = _session(tmp_path, "sid-a")
    path_a = server._queue_attached_image(session, PNG_A, ".png", prefix="upload")
    path_b = server._queue_attached_image(session, PNG_B, ".png", prefix="upload")

    assert path_a != path_b
    assert path_a.read_bytes() == PNG_A
    assert path_b.read_bytes() == PNG_B
