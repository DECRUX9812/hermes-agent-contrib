"""Regression test for #51203: lazy-deps installs must not run on the gateway event loop.

``PlatformEntry.ensure_deps_fn`` shells out to pip via ``tools/lazy_deps.py`` — a blocking
subprocess that can take minutes. ``platform_registry.create_adapter()`` runs it inline,
and every async adapter-creation path (startup prefilter, primary reconnect, secondary
startup/reconnect) calls it directly on the asyncio loop, stalling WS handshakes and
reconnects for the full pip duration. The async seams must run adapter creation off the
loop (``asyncio.to_thread``); ``create_adapter()`` itself stays synchronous for non-async
callers.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from gateway.config import GatewayConfig, Platform, PlatformConfig
from gateway.platform_registry import PlatformEntry, platform_registry
from gateway.platforms.base import BasePlatformAdapter
from gateway.run import GatewayRunner


_PLATFORM_NAME = "offloop-stub"


def _make_runner() -> GatewayRunner:
    """Minimal GatewayRunner via object.__new__ (same shape as the reconnect test suites)."""
    runner = object.__new__(GatewayRunner)
    runner.config = GatewayConfig(
        platforms={Platform(_PLATFORM_NAME): PlatformConfig(enabled=True, token="test")}
    )
    runner._running = True
    runner._shutdown_event = asyncio.Event()
    runner._exit_reason = None
    runner._exit_with_failure = False
    runner._exit_cleanly = False
    runner._failed_platforms = {}
    runner.adapters = {}
    return runner


class _OffLoopStubAdapter(BasePlatformAdapter):
    async def connect(self, *, is_reconnect: bool = False) -> bool:
        return False

    async def disconnect(self) -> None:
        pass

    async def send(self, *args: Any, **kwargs: Any) -> Any:
        return None

    async def get_chat_info(self, *args: Any, **kwargs: Any) -> Any:
        return None


@pytest.fixture
def install_thread():
    """Register a platform whose deps are missing; ensure_deps_fn records its thread."""
    record: dict[str, Any] = {}
    loop_ident = threading.get_ident()

    def _ensure_deps() -> bool:
        record["ensure_deps_ident"] = threading.get_ident()
        record["caller_ident"] = loop_ident
        return True

    entry = PlatformEntry(
        name=_PLATFORM_NAME,
        label="OffLoop Stub",
        adapter_factory=lambda cfg: _OffLoopStubAdapter(cfg, Platform(_PLATFORM_NAME)),
        check_fn=lambda: False,  # deps missing -> ensure_deps_fn must run
        ensure_deps_fn=_ensure_deps,
        source="plugin",
    )
    platform_registry.register(entry)
    try:
        yield record
    finally:
        platform_registry.unregister(_PLATFORM_NAME)


@pytest.mark.asyncio
async def test_reconnect_runs_deps_install_off_the_event_loop(install_thread):
    """_reconnect_failed_platform must not run ensure_deps_fn on the loop thread."""
    runner = _make_runner()
    platform = Platform(_PLATFORM_NAME)
    runner._failed_platforms[platform] = {
        "config": runner.config.platforms[platform],
        "attempts": 0,
        "next_retry": 0.0,
        "paused": False,
    }

    with patch.object(runner, "_wire_adapter_handlers"), \
         patch.object(runner, "_connect_adapter_with_timeout", new=AsyncMock(return_value=False)), \
         patch.object(runner, "_bump_reconnect_backoff", return_value=1), \
         patch("gateway.run._dispose_unused_adapter", new=AsyncMock()):
        await runner._reconnect_failed_platform(platform, now=10.0)

    assert "ensure_deps_ident" in install_thread, "ensure_deps_fn never ran"
    assert install_thread["ensure_deps_ident"] != install_thread["caller_ident"], (
        "ensure_deps_fn (blocking pip install) ran on the asyncio event-loop thread"
    )
