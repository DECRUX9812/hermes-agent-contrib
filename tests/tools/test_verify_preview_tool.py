"""Tests for the GUI-surface ``verify_preview`` tool."""

import json

from tools import verify_preview_tool as vp


def test_requires_callback():
    """Outside the desktop GUI there is no bridge — a clear error, no crash."""
    result = json.loads(vp.verify_preview_tool(callback=None))
    assert "desktop" in result["error"]


def test_passthrough_answer():
    raw = json.dumps({"ok": True, "errorCount": 0, "errors": [], "warningCount": 1})
    assert vp.verify_preview_tool(callback=lambda _p: raw) == raw


def test_settle_ms_defaults_and_clamps():
    seen = {}

    def cb(payload):
        seen.update(payload)
        return "{}"

    vp.verify_preview_tool(callback=cb)
    assert seen["settle_ms"] == vp.DEFAULT_SETTLE_MS

    vp.verify_preview_tool(settle_ms=50, callback=cb)
    assert seen["settle_ms"] == 50

    vp.verify_preview_tool(settle_ms=99_999, callback=cb)
    assert seen["settle_ms"] == vp.MAX_SETTLE_MS

    vp.verify_preview_tool(settle_ms=-5, callback=cb)
    assert seen["settle_ms"] == 0


def test_bad_settle_ms_is_an_error():
    result = json.loads(vp.verify_preview_tool(settle_ms="later", callback=lambda _p: "{}"))
    assert "settle_ms" in result["error"]


def test_empty_answer_becomes_an_error():
    result = json.loads(vp.verify_preview_tool(callback=lambda _p: ""))
    assert "timed out" in result["error"]


def test_callback_exception_becomes_an_error():
    def boom(_p):
        raise RuntimeError("gone")

    result = json.loads(vp.verify_preview_tool(callback=boom))
    assert "gone" in result["error"]
