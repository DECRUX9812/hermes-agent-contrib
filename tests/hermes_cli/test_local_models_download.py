"""download_file resume behavior: a failed download keeps its .part, and a retry
resumes it with a single ``Range: bytes=N-`` stream instead of starting from zero.
A server without range support still restarts cleanly. Network is faked at the
urllib boundary — never live."""

from __future__ import annotations

from pathlib import Path

import pytest

from hermes_cli.web_routers import local_models


class _FakeResponse:
    """Minimal urllib response: status, headers, chunked read(), optional mid-stream drop."""

    def __init__(self, data: bytes, *, status: int = 200, headers=None, fail_after=None):
        self._data = data
        self.status = status
        self.headers = headers or {}
        self._pos = 0
        self._fail_after = fail_after  # serve this many bytes, then drop the connection

    def read(self, n: int = -1) -> bytes:
        limit = len(self._data) if self._fail_after is None else min(len(self._data), self._fail_after)
        if self._pos >= limit:
            if self._pos < len(self._data):
                raise ConnectionResetError("connection dropped mid-stream")
            return b""
        end = min(self._pos + (n if n >= 0 else len(self._data)), limit)
        chunk = self._data[self._pos:end]
        self._pos += len(chunk)
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _server(payload: bytes, requests: list, *, range_supported: bool = True, fail_after=None):
    """urlopen stand-in honoring Range when ``range_supported``; records every Range header seen."""

    def fake_urlopen(req, timeout=None):
        range_header = req.headers.get("Range") if hasattr(req, "headers") else None
        requests.append(range_header)
        if range_header and range_supported:
            start_s, _, end_s = range_header.removeprefix("bytes=").partition("-")
            start = int(start_s)
            end = int(end_s) if end_s else len(payload) - 1
            return _FakeResponse(
                payload[start : end + 1],
                status=206,
                headers={"Content-Range": f"bytes {start}-{end}/{len(payload)}"},
                fail_after=fail_after,
            )
        return _FakeResponse(
            payload,
            status=200,
            headers={"Content-Length": str(len(payload))},
            fail_after=fail_after,
        )

    return fake_urlopen


def test_failed_download_keeps_part_and_retry_completes(tmp_path, monkeypatch):
    """A mid-stream drop raises but leaves the .part on disk; a fresh retry finishes the file."""
    payload = b"\xab" * 4096
    dest = tmp_path / "model.gguf"
    part = dest.with_suffix(".part")
    job = {}

    requests: list = []
    monkeypatch.setattr(local_models.urllib.request, "urlopen",
                        _server(payload, requests, fail_after=100))
    with pytest.raises(Exception):
        local_models.download_file("https://example.test/m.gguf", dest, job)
    assert part.exists(), ".part must survive a failed download so a retry can resume"
    assert not dest.exists()

    requests.clear()
    monkeypatch.setattr(local_models.urllib.request, "urlopen", _server(payload, requests))
    local_models.download_file("https://example.test/m.gguf", dest, job)
    assert dest.read_bytes() == payload
    assert not part.exists()


def test_retry_resumes_partial_part_with_range_header(tmp_path, monkeypatch):
    """An existing .part with N < total bytes resumes via one 'Range: bytes=N-' stream."""
    payload = bytes(range(256)) * 32  # 8192 bytes, non-uniform so offsets are verifiable
    dest = tmp_path / "model.gguf"
    part = dest.with_suffix(".part")
    part.write_bytes(payload[:3000])  # leftover from an earlier interrupted attempt

    requests: list = []
    monkeypatch.setattr(local_models.urllib.request, "urlopen", _server(payload, requests))
    local_models.download_file("https://example.test/m.gguf", dest, {})

    assert "bytes=3000-" in requests, f"expected a resume request, saw {requests}"
    assert dest.read_bytes() == payload
    assert not part.exists()


def test_server_without_range_support_restarts_cleanly(tmp_path, monkeypatch):
    """No range support: a stale .part is truncated and the file downloads from scratch."""
    payload = b"\x07" * 2048
    dest = tmp_path / "model.gguf"
    part = dest.with_suffix(".part")
    part.write_bytes(b"stale-garbage")

    requests: list = []
    monkeypatch.setattr(local_models.urllib.request, "urlopen",
                        _server(payload, requests, range_supported=False))
    local_models.download_file("https://example.test/m.gguf", dest, {})

    assert dest.read_bytes() == payload
    assert not part.exists()
