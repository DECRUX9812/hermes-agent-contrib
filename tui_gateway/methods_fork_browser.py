"""Browser step thumbnail and snapshot RPC methods."""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
import re
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home
from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method
_profile_scoped = _registry.profile_scoped
logger = logging.getLogger(__name__)

_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_MAX_THUMB_BYTES = 300 * 1024


@_profile_scoped
@method("fork.browser.thumbnail")
def fork_browser_thumbnail(rid, params: dict) -> dict:
    tool_call_id = str(params.get("tool_call_id") or "").strip()
    if not _ID_PATTERN.match(tool_call_id):
        return _err(rid, 4002, "invalid tool_call_id")

    thumbs_dir = Path(get_hermes_home()) / "cache" / "browser_thumbs"
    if not thumbs_dir.is_dir():
        return _ok(rid, {"found": False})

    image_path = None
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        cand = thumbs_dir / f"{tool_call_id}{ext}"
        if cand.is_file():
            image_path = cand
            break

    if image_path is None:
        return _ok(rid, {"found": False})

    try:
        if image_path.stat().st_size > _MAX_THUMB_BYTES:
            return _ok(rid, {"found": False, "reason": "too_large"})
        data = image_path.read_bytes()
    except Exception as exc:
        logger.debug("Failed to read thumbnail file %s: %s", image_path, exc)
        return _ok(rid, {"found": False})

    if len(data) > _MAX_THUMB_BYTES:
        return _ok(rid, {"found": False, "reason": "too_large"})

    mime = mimetypes.guess_type(str(image_path))[0] or "image/png"
    data_base64 = base64.b64encode(data).decode("ascii")

    sidecar_path = thumbs_dir / f"{tool_call_id}.json"
    sidecar: dict[str, Any] = {}
    if sidecar_path.is_file():
        try:
            sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.debug("Failed to read sidecar %s: %s", sidecar_path, exc)

    return _ok(rid, {
        "found": True,
        "mime": mime,
        "data_base64": data_base64,
        "url": sidecar.get("url"),
        "title": sidecar.get("title"),
        "captured_at": sidecar.get("captured_at"),
    })


@_profile_scoped
@method("fork.browser.snapshot")
def fork_browser_snapshot(rid, params: dict) -> dict:
    tool_call_id = str(params.get("tool_call_id") or "").strip()
    if not _ID_PATTERN.match(tool_call_id):
        return _err(rid, 4002, "invalid tool_call_id")

    thumbs_dir = Path(get_hermes_home()) / "cache" / "browser_thumbs"
    sidecar_path = thumbs_dir / f"{tool_call_id}.json"
    if not sidecar_path.is_file():
        return _ok(rid, {"found": False})

    try:
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.debug("Failed to read sidecar %s: %s", sidecar_path, exc)
        return _ok(rid, {"found": False})

    snapshot_text = sidecar.get("snapshot")
    if snapshot_text is None:
        return _ok(rid, {"found": False})

    return _ok(rid, {
        "found": True,
        "text": snapshot_text,
        "url": sidecar.get("url"),
        "title": sidecar.get("title"),
    })


def register(server) -> None:
    bind_module(globals(), server)
