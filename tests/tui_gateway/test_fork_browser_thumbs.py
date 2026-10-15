"""Tests for browser step thumbnails and fork.browser.* RPCs."""

import base64
import json
import time
from threading import Event
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from tui_gateway.contracts.events import ToolCompletePayload
from tui_gateway import server


def _create_test_png(path: Path, width: int = 100, height: int = 100, color: str = "red"):
    img = Image.new("RGB", (width, height), color=color)
    img.save(path, format="PNG")


def test_tool_complete_payload_thumbnail_declared():
    """Verify ToolCompletePayload accepts thumbnail field under extra='forbid'."""
    payload = ToolCompletePayload(
        tool_id="call_123",
        name="browser_navigate",
        thumbnail={"id": "call_123", "url": "https://example.com", "title": "Example"},
    )
    dumped = payload.model_dump()
    assert dumped["tool_id"] == "call_123"
    assert dumped["thumbnail"] == {"id": "call_123", "url": "https://example.com", "title": "Example"}


def test_browser_step_capture_and_tool_complete(tmp_path, monkeypatch):
    """Run browser_navigate through _on_tool_complete; assert file, sidecar, and payload thumbnail."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    # Stub browser command layer
    fake_png = tmp_path / "fake_viewport.png"
    _create_test_png(fake_png, 800, 600, "blue")

    def fake_run_browser_command(task_id, cmd, args, timeout=None):
        if cmd == "screenshot":
            dest_file = Path(args[0])
            dest_file.write_bytes(fake_png.read_bytes())
            return {"success": True, "data": {"path": str(dest_file)}}
        if cmd == "get" and args == ["url"]:
            return {"success": True, "data": {"url": "https://example.com/test"}}
        if cmd == "get" and args == ["title"]:
            return {"success": True, "data": {"title": "Test Page"}}
        return {"success": True}

    with patch("tools.browser_tool_session._run_browser_command", side_effect=fake_run_browser_command):
        emitted_events = []

        def fake_emit_lifecycle(event, sid, name, args, payload):
            emitted_events.append((event, payload))

        with patch("tui_gateway.server._emit_tool_lifecycle", side_effect=fake_emit_lifecycle):
            call_id = "call_step_1"
            nav_result = json.dumps({"success": True, "url": "https://example.com/test", "title": "Test Page"})
            server._on_tool_complete(
                sid="sess_1",
                tool_call_id=call_id,
                name="browser_navigate",
                args={"url": "https://example.com/test"},
                result=nav_result,
            )

    assert len(emitted_events) == 1
    event_name, payload = emitted_events[0]
    assert event_name == "tool.complete"
    assert payload.get("thumbnail") == {
        "id": call_id,
        "url": "https://example.com/test",
        "title": "Test Page",
    }

    # Verify stored file
    thumbs_dir = tmp_path / "cache" / "browser_thumbs"
    stored_img = thumbs_dir / f"{call_id}.png"
    assert stored_img.is_file()

    # Image should be resized so max dimension <= 640
    with Image.open(stored_img) as img:
        w, h = img.size
        assert max(w, h) <= 640
        assert w == 640
        assert h == 480

    # Verify sidecar
    sidecar_file = thumbs_dir / f"{call_id}.json"
    assert sidecar_file.is_file()
    sidecar_data = json.loads(sidecar_file.read_text(encoding="utf-8"))
    assert sidecar_data["tool_call_id"] == call_id
    assert sidecar_data["url"] == "https://example.com/test"
    assert sidecar_data["title"] == "Test Page"
    assert "captured_at" in sidecar_data


def test_capture_uses_one_total_command_deadline(tmp_path, monkeypatch):
    """A slow screenshot consumes the budget, so no follow-up browser command starts."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    calls = []

    def slow_run_browser_command(task_id, cmd, args, timeout=None):
        calls.append((cmd, time.monotonic(), timeout))
        assert timeout is not None and timeout > 0
        Event().wait(timeout)
        Path(args[0]).write_bytes(b"not an image")
        return {"success": True, "data": {"path": args[0]}}

    with patch("tools.browser_tool_session._run_browser_command", side_effect=slow_run_browser_command):
        from tools.browser_step_thumbnail import capture_browser_step_thumbnail

        started = time.monotonic()
        thumbnail = capture_browser_step_thumbnail(
            tool_call_id="deadline_step",
            name="browser_navigate",
            args={},
            result={"success": True},
            task_id="sess_deadline",
        )
        elapsed = time.monotonic() - started

    assert elapsed < 2.5
    assert [call[0] for call in calls] == ["screenshot"]
    assert 0 < calls[0][2] <= 2
    assert thumbnail is None


def test_rpc_thumbnail_and_snapshot(tmp_path, monkeypatch):
    """Test fork.browser.thumbnail and fork.browser.snapshot RPC handlers."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    thumbs_dir = tmp_path / "cache" / "browser_thumbs"
    thumbs_dir.mkdir(parents=True, exist_ok=True)

    call_id = "step_rpc_test"
    test_img = thumbs_dir / f"{call_id}.png"
    _create_test_png(test_img, 320, 240, "green")
    img_bytes = test_img.read_bytes()

    sidecar = {
        "tool_call_id": call_id,
        "url": "https://hermes.dev",
        "title": "Hermes Dev",
        "captured_at": 1700000000.0,
        "snapshot": "Page heading\nSome text content",
    }
    (thumbs_dir / f"{call_id}.json").write_text(json.dumps(sidecar), encoding="utf-8")

    # RPC call for thumbnail
    res_thumb = server.handle_request({
        "id": 1,
        "method": "fork.browser.thumbnail",
        "params": {"tool_call_id": call_id},
    })
    assert res_thumb.get("error") is None
    result = res_thumb["result"]
    assert result["found"] is True
    assert result["mime"] == "image/png"
    assert result["data_base64"] == base64.b64encode(img_bytes).decode("ascii")
    assert result["url"] == "https://hermes.dev"
    assert result["title"] == "Hermes Dev"
    assert result["captured_at"] == 1700000000.0

    # RPC call for snapshot
    res_snap = server.handle_request({
        "id": 2,
        "method": "fork.browser.snapshot",
        "params": {"tool_call_id": call_id},
    })
    assert res_snap.get("error") is None
    s_result = res_snap["result"]
    assert s_result["found"] is True
    assert s_result["text"] == "Page heading\nSome text content"
    assert s_result["url"] == "https://hermes.dev"
    assert s_result["title"] == "Hermes Dev"


def test_rpc_refuses_oversized_thumbnail_without_truncating(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    thumbs_dir = tmp_path / "cache" / "browser_thumbs"
    thumbs_dir.mkdir(parents=True)
    (thumbs_dir / "oversized.png").write_bytes(b"x" * (400 * 1024))

    response = server.handle_request({
        "id": 1,
        "method": "fork.browser.thumbnail",
        "params": {"tool_call_id": "oversized"},
    })

    assert response.get("error") is None
    assert response["result"] == {"found": False, "reason": "too_large"}


def test_capture_encodes_large_screenshot_within_wire_cap(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    source = tmp_path / "large_viewport.png"
    Image.effect_noise((2000, 2000), 100).convert("RGB").save(source, format="PNG")

    def fake_run_browser_command(task_id, cmd, args, timeout=None):
        assert cmd == "screenshot"
        Path(args[0]).write_bytes(source.read_bytes())
        return {"success": True, "data": {"path": args[0]}}

    with patch("tools.browser_tool_session._run_browser_command", side_effect=fake_run_browser_command):
        from tools.browser_step_thumbnail import capture_browser_step_thumbnail

        thumbnail = capture_browser_step_thumbnail(
            tool_call_id="large_screenshot",
            name="browser_navigate",
            args={},
            result={"success": True, "url": "https://example.com", "title": "Example"},
            task_id="sess_large",
        )

    assert thumbnail is not None
    thumbs_dir = tmp_path / "cache" / "browser_thumbs"
    image_paths = [path for path in thumbs_dir.iterdir() if path.suffix in {".png", ".jpg"}]
    assert len(image_paths) == 1
    assert image_paths[0].stat().st_size <= 300 * 1024


def test_rpc_refusal_of_invalid_ids(tmp_path, monkeypatch):
    """Refuse ids that are not [A-Za-z0-9_-]{1,128} so path traversal is blocked."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    for invalid_id in ("../secret", "foo/bar", "foo\\bar", "", "a" * 129, "id with space", "id@bad"):
        res = server.handle_request({
            "id": 1,
            "method": "fork.browser.thumbnail",
            "params": {"tool_call_id": invalid_id},
        })
        assert "error" in res
        assert res["error"]["code"] == 4002

        res_snap = server.handle_request({
            "id": 2,
            "method": "fork.browser.snapshot",
            "params": {"tool_call_id": invalid_id},
        })
        assert "error" in res_snap
        assert res_snap["error"]["code"] == 4002


def test_thumbnail_pruning_cap(tmp_path, monkeypatch):
    """Ensure older thumbnails beyond cap (e.g. cap=500) are pruned."""
    from tools.browser_step_thumbnail import prune_oldest_thumbnails

    thumbs_dir = tmp_path / "browser_thumbs"
    thumbs_dir.mkdir(parents=True)

    # Create 5 images with sidecars
    for i in range(5):
        img_p = thumbs_dir / f"call_{i}.png"
        img_p.write_bytes(b"png")
        json_p = thumbs_dir / f"call_{i}.json"
        json_p.write_text("{}", encoding="utf-8")
        # artificial timestamp
        import os
        os.utime(img_p, (1000 + i * 10, 1000 + i * 10))

    prune_oldest_thumbnails(thumbs_dir, cap=3)

    remaining_pngs = sorted([p.name for p in thumbs_dir.glob("*.png")])
    assert remaining_pngs == ["call_2.png", "call_3.png", "call_4.png"]
    remaining_jsons = sorted([p.name for p in thumbs_dir.glob("*.json")])
    assert remaining_jsons == ["call_2.json", "call_3.json", "call_4.json"]
    assert not (thumbs_dir / "call_0.png").exists()
    assert not (thumbs_dir / "call_0.json").exists()


def test_capture_failure_leaves_tool_result_unchanged(tmp_path, monkeypatch):
    """Assert a capture failure logs at debug, never raises, and leaves the tool result unchanged."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    def failing_run_browser_command(task_id, cmd, args, timeout=None):
        raise RuntimeError("Browser process crashed!")

    with patch("tools.browser_tool_session._run_browser_command", side_effect=failing_run_browser_command):
        emitted_events = []

        def fake_emit_lifecycle(event, sid, name, args, payload):
            emitted_events.append((event, payload))

        with patch("tui_gateway.server._emit_tool_lifecycle", side_effect=fake_emit_lifecycle):
            raw_result = json.dumps({"success": True, "url": "https://example.com"})
            server._on_tool_complete(
                sid="sess_err",
                tool_call_id="call_fail",
                name="browser_navigate",
                args={"url": "https://example.com"},
                result=raw_result,
            )

    assert len(emitted_events) == 1
    _event_name, payload = emitted_events[0]
    assert payload["result"] == {"success": True, "url": "https://example.com"}
    assert "thumbnail" not in payload


def test_browser_vision_reuses_existing_screenshot(tmp_path, monkeypatch):
    """browser_vision reuses its existing screenshot instead of capturing twice."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    existing_shot = tmp_path / "existing_shot.png"
    _create_test_png(existing_shot, 400, 300, "purple")

    called_screenshot_cmd = False

    def fake_run_browser_command(task_id, cmd, args, timeout=None):
        nonlocal called_screenshot_cmd
        if cmd == "screenshot":
            called_screenshot_cmd = True
        return {"success": True}

    with patch("tools.browser_tool_session._run_browser_command", side_effect=fake_run_browser_command):
        emitted_events = []

        def fake_emit_lifecycle(event, sid, name, args, payload):
            emitted_events.append((event, payload))

        with patch("tui_gateway.server._emit_tool_lifecycle", side_effect=fake_emit_lifecycle):
            call_id = "call_vision_1"
            vision_result = json.dumps({
                "success": True,
                "analysis": "A blue button",
                "screenshot_path": str(existing_shot),
            })
            server._on_tool_complete(
                sid="sess_vis",
                tool_call_id=call_id,
                name="browser_vision",
                args={"question": "what is on the page?"},
                result=vision_result,
            )

    assert not called_screenshot_cmd
    assert len(emitted_events) == 1
    payload = emitted_events[0][1]
    assert payload.get("thumbnail") is not None
    assert payload["thumbnail"]["id"] == call_id
    stored_img = tmp_path / "cache" / "browser_thumbs" / f"{call_id}.png"
    assert stored_img.is_file()


def test_browser_snapshot_stores_snapshot_capped(tmp_path, monkeypatch):
    """browser_snapshot stores snapshot text in sidecar capped at 16 KB."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    fake_png = tmp_path / "fake_viewport.png"
    _create_test_png(fake_png, 100, 100, "yellow")

    def fake_run_browser_command(task_id, cmd, args, timeout=None):
        if cmd == "screenshot":
            Path(args[0]).write_bytes(fake_png.read_bytes())
            return {"success": True, "data": {"path": args[0]}}
        return {"success": True}

    with patch("tools.browser_tool_session._run_browser_command", side_effect=fake_run_browser_command):
        call_id = "call_snap_1"
        large_text = "x" * 30000
        snap_result = json.dumps({
            "success": True,
            "url": "https://example.com/snapshot",
            "title": "Snapshot Title",
            "snapshot": large_text,
        })
        emitted_events = []
        with patch("tui_gateway.server._emit_tool_lifecycle", side_effect=lambda e, s, n, a, p: emitted_events.append(p)):
            server._on_tool_complete(
                sid="sess_snap",
                tool_call_id=call_id,
                name="browser_snapshot",
                args={"full": False},
                result=snap_result,
            )

    sidecar = tmp_path / "cache" / "browser_thumbs" / f"{call_id}.json"
    assert sidecar.is_file()
    data = json.loads(sidecar.read_text(encoding="utf-8"))
    assert len(data["snapshot"]) == 16 * 1024
    assert data["url"] == "https://example.com/snapshot"
    assert data["title"] == "Snapshot Title"
