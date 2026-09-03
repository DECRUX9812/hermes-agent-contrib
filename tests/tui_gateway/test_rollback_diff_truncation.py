"""#101744: rollback.diff must flag truncation instead of silent cut.

A diff longer than 4000 chars was cut mid-line with no indication,
so clients could not distinguish a complete diff from a prefix.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import tui_gateway.server as srv


def _call_with_diff(monkeypatch, diff_text: str) -> dict:
    session = {"cols": 80}
    monkeypatch.setattr(srv, "_sess", lambda params, rid: (session, None))
    monkeypatch.setattr(srv, "_resolve_checkpoint_hash", lambda mgr, cwd, ref: "abc123")

    def fake_with_checkpoints(session_arg, fn):
        mgr = MagicMock()
        mgr.diff.return_value = {"diff": diff_text, "stat": "1 file changed"}
        return fn(mgr, "/tmp")

    monkeypatch.setattr(srv, "_with_checkpoints", fake_with_checkpoints)
    monkeypatch.setattr(srv, "render_diff", lambda raw, cols: "")

    envelope = srv._methods["rollback.diff"](1, {"session_id": "sid", "hash": "abc123"})
    assert envelope.get("ok") is True or "result" in envelope
    return envelope["result"]


def test_rollback_diff_flags_truncation(monkeypatch):
    big = "x" * 5000
    res = _call_with_diff(monkeypatch, big)
    assert res["diff"] == big[:4000]
    assert res["truncated"] is True
    assert res["totalLength"] == 5000


def test_rollback_diff_untruncated_reports_false(monkeypatch):
    small = "line1\nline2\n"
    res = _call_with_diff(monkeypatch, small)
    assert res["diff"] == small
    assert res["truncated"] is False
    assert res["totalLength"] == len(small)
