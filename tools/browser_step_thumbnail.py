"""Viewport thumbnail and snapshot persistence for browser tool steps."""

from __future__ import annotations

import json
import logging
import re
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

from hermes_constants import get_hermes_home

logger = logging.getLogger(__name__)

_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_MAX_THUMB_DIMENSION = 640
_MAX_PROFILE_THUMBS = 500
_MAX_SNAPSHOT_CHARS = 16 * 1024
_MAX_THUMB_BYTES = 300 * 1024
_CAPTURE_TIMEOUT_S = 2

BROWSER_STEP_TOOLS = frozenset({
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_scroll",
    "browser_back",
    "browser_press",
    "browser_snapshot",
    "browser_vision",
})


def is_browser_step_tool(name: str) -> bool:
    """Return True if ``name`` is a browser tool that modifies or reads the page."""
    return name in BROWSER_STEP_TOOLS


def _parse_tool_result(result: Any) -> Optional[dict[str, Any]]:
    if isinstance(result, dict):
        return result
    if isinstance(result, str):
        try:
            parsed = json.loads(result)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None
    return None


def _is_tool_successful(parsed: dict[str, Any]) -> bool:
    return bool(parsed.get("success") or parsed.get("_multimodal"))


def _save_jpeg_within_cap(image, dest_path: Path) -> bool:
    """Try progressively smaller JPEG encodings until the thumbnail fits the wire cap."""
    rgb_image = image.convert("RGB")
    for quality in (70, 60, 50, 40, 30):
        rgb_image.save(dest_path, "JPEG", quality=quality, optimize=True)
        if dest_path.stat().st_size <= _MAX_THUMB_BYTES:
            return True
    dest_path.unlink(missing_ok=True)
    return False


def _resize_and_save(src_path: Path, dest_path: Path) -> Optional[Path]:
    try:
        from PIL import Image
    except ImportError as exc:
        logger.debug("PIL unavailable for thumbnail resize: %s", exc)
        if src_path.stat().st_size > _MAX_THUMB_BYTES:
            return None
        shutil.copyfile(src_path, dest_path)
        return dest_path

    jpeg_path = dest_path.with_suffix(".jpg")
    try:
        with Image.open(src_path) as source:
            image = source.copy()
        w, h = image.size
        if max(w, h) > _MAX_THUMB_DIMENSION:
            scale = _MAX_THUMB_DIMENSION / max(w, h)
            new_w = max(1, round(w * scale))
            new_h = max(1, round(h * scale))
            image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
        image.save(dest_path, "PNG")
        if dest_path.stat().st_size <= _MAX_THUMB_BYTES:
            return dest_path
        if _save_jpeg_within_cap(image, jpeg_path):
            dest_path.unlink(missing_ok=True)
            return jpeg_path
        dest_path.unlink(missing_ok=True)
        return None
    except Exception as exc:
        logger.debug("PIL thumbnail resize failed: %s", exc)
        dest_path.unlink(missing_ok=True)
        jpeg_path.unlink(missing_ok=True)
        return None


def prune_oldest_thumbnails(thumbs_dir: Path, cap: int = _MAX_PROFILE_THUMBS) -> None:
    """Retain at most ``cap`` newest thumbnail images, removing older images and sidecars."""
    try:
        images: list[Path] = []
        for p in thumbs_dir.iterdir():
            if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
                images.append(p)
        if len(images) <= cap:
            return
        images.sort(key=lambda p: p.stat().st_mtime)
        to_delete = images[: len(images) - cap]
        for img in to_delete:
            img.unlink(missing_ok=True)
            img.with_suffix(".json").unlink(missing_ok=True)
    except Exception as exc:
        logger.debug("Pruning thumbnails failed: %s", exc)


def _capture_viewport_screenshot(effective_task_id: str, temp_path: Path, deadline: float) -> bool:
    from tools import browser_tool_session as _session

    timeout = deadline - time.monotonic()
    if timeout <= 0:
        return False
    remote_path = _session.sandbox_screenshot_path(temp_path)
    cmd_args = [remote_path or str(temp_path)]
    result = _session._run_browser_command(
        effective_task_id, "screenshot", cmd_args, timeout=timeout
    )
    if remote_path and result.get("success"):
        try:
            source = str((result.get("data") or {}).get("path") or remote_path)
            _session.fetch_sandbox_file(source, temp_path)
        except Exception as exc:
            logger.debug("Failed to fetch sandbox screenshot %s: %s", remote_path, exc)
    if not result.get("success"):
        return False
    data_path = (result.get("data") or {}).get("path")
    if data_path and Path(data_path).is_file():
        if str(data_path) != str(temp_path):
            shutil.copyfile(data_path, temp_path)
    return temp_path.is_file() and temp_path.stat().st_size > 0


def capture_browser_step_thumbnail(
    tool_call_id: str,
    name: str,
    args: dict,
    result: Any,
    task_id: Optional[str] = None,
    profile_home: Optional[Path | str] = None,
) -> Optional[dict[str, Any]]:
    """Capture a thumbnail and metadata sidecar after a browser step.

    Returns ``{"id": tool_call_id, "url": ..., "title": ...}`` on success, or None.
    Never raises; failures log at debug and skip.
    """
    if not is_browser_step_tool(name):
        return None
    if not tool_call_id or not _ID_PATTERN.match(tool_call_id):
        return None

    parsed = _parse_tool_result(result)
    if parsed is None or not _is_tool_successful(parsed):
        return None

    deadline = time.monotonic() + _CAPTURE_TIMEOUT_S
    try:
        from tools import browser_tool_session as _session
        from tools.browser_tool import _last_session_key

        effective_task_id = _last_session_key(task_id or "default")
        home = Path(profile_home) if profile_home else Path(get_hermes_home())
        thumbs_dir = home / "cache" / "browser_thumbs"
        thumbs_dir.mkdir(parents=True, exist_ok=True)

        dest_img = thumbs_dir / f"{tool_call_id}.png"
        sidecar_path = thumbs_dir / f"{tool_call_id}.json"

        # Vision tool reuses already-captured screenshot if present on disk
        source_file: Optional[Path] = None
        temp_file: Optional[Path] = None

        if name == "browser_vision":
            vision_path = (
                parsed.get("screenshot_path")
                or (parsed.get("meta") or {}).get("screenshot_path")
                or (parsed.get("data") or {}).get("path")
            )
            if vision_path and Path(vision_path).is_file():
                source_file = Path(vision_path)

        if source_file is None:
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                temp_file = Path(tmp.name)
            captured = _capture_viewport_screenshot(effective_task_id, temp_file, deadline)
            if not captured:
                if temp_file and temp_file.is_file():
                    temp_file.unlink(missing_ok=True)
                return None
            source_file = temp_file

        try:
            stored_image = _resize_and_save(source_file, dest_img)
        finally:
            if temp_file and temp_file.is_file():
                temp_file.unlink(missing_ok=True)

        if stored_image is None or not stored_image.is_file():
            return None

        # Resolve URL and title
        url = parsed.get("url")
        title = parsed.get("title")

        if not url and deadline - time.monotonic() >= 0.25:
            try:
                timeout = deadline - time.monotonic()
                if timeout < 0.25:
                    raise TimeoutError("thumbnail capture deadline nearly exhausted")
                u_res = _session._run_browser_command(
                    effective_task_id, "get", ["url"], timeout=timeout
                )
                if isinstance(u_res, dict) and u_res.get("success"):
                    url = (u_res.get("data") or {}).get("url")
            except Exception as exc:
                logger.debug("Thumbnail url query failed: %s", exc)

        if not title and deadline - time.monotonic() >= 0.25:
            try:
                timeout = deadline - time.monotonic()
                if timeout < 0.25:
                    raise TimeoutError("thumbnail capture deadline nearly exhausted")
                t_res = _session._run_browser_command(
                    effective_task_id, "get", ["title"], timeout=timeout
                )
                if isinstance(t_res, dict) and t_res.get("success"):
                    title = (t_res.get("data") or {}).get("title")
            except Exception as exc:
                logger.debug("Thumbnail title query failed: %s", exc)

        snapshot_text = parsed.get("snapshot")
        if isinstance(snapshot_text, str):
            snapshot_text = snapshot_text[:_MAX_SNAPSHOT_CHARS]
        elif snapshot_text is not None:
            snapshot_text = str(snapshot_text)[:_MAX_SNAPSHOT_CHARS]

        sidecar: dict[str, Any] = {
            "tool_call_id": tool_call_id,
            "url": url,
            "title": title,
            "captured_at": time.time(),
        }
        if snapshot_text is not None:
            sidecar["snapshot"] = snapshot_text

        sidecar_tmp = thumbs_dir / f"{tool_call_id}.tmp.json"
        sidecar_tmp.write_text(json.dumps(sidecar), encoding="utf-8")
        sidecar_tmp.replace(sidecar_path)

        prune_oldest_thumbnails(thumbs_dir, cap=_MAX_PROFILE_THUMBS)

        return {
            "id": tool_call_id,
            "url": url,
            "title": title,
        }
    except Exception as exc:
        logger.debug("capture_browser_step_thumbnail failed: %s", exc)
        return None
