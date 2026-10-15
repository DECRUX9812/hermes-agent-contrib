"""Browser step thumbnail and snapshot RPC contracts."""

from __future__ import annotations

from .base import Params, Result
from .registry import method


class BrowserThumbnailParams(Params):
    tool_call_id: str
    profile: str | None = None
    session_id: str | None = None


class BrowserThumbnailResult(Result):
    found: bool
    reason: str | None = None
    mime: str | None = None
    data_base64: str | None = None
    url: str | None = None
    title: str | None = None
    captured_at: float | str | None = None


class BrowserSnapshotParams(Params):
    tool_call_id: str
    profile: str | None = None
    session_id: str | None = None


class BrowserSnapshotResult(Result):
    found: bool
    text: str | None = None
    url: str | None = None
    title: str | None = None


method(
    "fork.browser.thumbnail",
    params=BrowserThumbnailParams,
    result=BrowserThumbnailResult,
    doc="Retrieve the captured thumbnail image and metadata for a browser tool step.",
)

method(
    "fork.browser.snapshot",
    params=BrowserSnapshotParams,
    result=BrowserSnapshotResult,
    doc="Retrieve the snapshot text and metadata for a browser tool step.",
)
