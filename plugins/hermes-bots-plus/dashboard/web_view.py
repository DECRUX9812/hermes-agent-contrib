"""Hermes Browser, gateway half: frame-policy probe and a gateway-side page view.

Two jobs for the desktop plugin's in-app browser (hermes-bots-plus ``browser/``):

* ``probe``: fetch a page's headers on the gateway and say whether it lets itself be framed
  (``X-Frame-Options`` / CSP ``frame-ancestors``), so the pane can show an honest "this site
  refuses to be embedded" card instead of a blank frame.
* ``PageView``: a small headless Chromium on the gateway machine, driven over the DevTools
  protocol, that renders a page the viewer's own browser cannot frame or cannot reach (a
  ``localhost`` dev server seen from another computer). The pane shows its frames and forwards
  clicks, scrolls and keys, so the page stays usable inside the app.

Written for Hermes. Only the standard library, ``httpx`` and ``websockets`` (both already in the
gateway's environment).
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import glob
import json
import os
import re
import shutil
import tempfile
import time
from dataclasses import dataclass, field
from html import unescape
from typing import Any, Iterable, Optional
from urllib.parse import urlsplit

LOOPBACK_HOSTS = re.compile(r"^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)$", re.I)
TITLE_RE = re.compile(rb"<title[^>]*>(.*?)</title>", re.I | re.S)
PROBE_TIMEOUT = 5.0
PROBE_READ_LIMIT = 128 * 1024
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 HermesBrowser"
)


# ---------------------------------------------------------------- frame policy

def _origin(url: str) -> tuple[str, str, int]:
    parts = urlsplit(url)
    scheme = (parts.scheme or "").lower()
    port = parts.port or (443 if scheme == "https" else 80)
    return scheme, (parts.hostname or "").lower(), port


def _source_matches(source: str, viewer: str, target: str) -> bool:
    """One CSP host-source / scheme-source / keyword against the viewer origin."""
    src = source.strip()
    low = src.lower()
    if low == "*":
        return True
    if low == "'self'":
        return _origin(viewer) == _origin(target)
    if low == "'none'":
        return False
    v_scheme, v_host, v_port = _origin(viewer)
    if re.fullmatch(r"[a-z][a-z0-9+.-]*:", low):  # scheme source, e.g. https:
        return v_scheme == low[:-1]
    m = re.fullmatch(r"(?:([a-z][a-z0-9+.-]*)://)?(\*\.)?([^:/]+|\*)(?::(\d+|\*))?(?:/.*)?", low)
    if not m:
        return False
    scheme, wildcard, host, port = m.groups()
    if scheme and scheme != v_scheme:
        return False
    if host != "*":
        if wildcard:
            if not v_host.endswith("." + host):
                return False
        elif v_host != host:
            return False
    if port == "*":
        return True
    if port:
        return int(port) == v_port
    return v_port == (443 if v_scheme == "https" else 80)


def frame_policy(headers: Iterable[tuple[str, str]], target: str, viewer: Optional[str]) -> tuple[Optional[bool], Optional[str]]:
    """Whether a page whose response carried ``headers`` may be framed by ``viewer``.

    Returns ``(embeddable, reason)``: ``reason`` is ``"csp"`` or ``"x-frame-options"`` when
    blocked. CSP ``frame-ancestors`` wins over ``X-Frame-Options`` when both are present, as in
    current browsers. ``None`` means the answer depends on something we cannot see.
    """
    csp_ancestors: list[list[str]] = []
    xfo: list[str] = []
    for name, value in headers:
        lname = name.lower()
        if lname == "content-security-policy":
            for directive in value.split(";"):
                bits = directive.strip().split()
                if bits and bits[0].lower() == "frame-ancestors":
                    csp_ancestors.append(bits[1:])
        elif lname == "x-frame-options":
            xfo.extend(v.strip().lower() for v in value.split(","))
    if csp_ancestors:
        if not viewer:
            return (True, None) if all("*" in s for s in csp_ancestors) else (False, "csp")
        for sources in csp_ancestors:  # every policy must allow it
            if not sources or not any(_source_matches(s, viewer, target) for s in sources):
                return False, "csp"
        return True, None
    for value in xfo:
        if value == "deny":
            return False, "x-frame-options"
        if value == "sameorigin":
            if not viewer or _origin(viewer) != _origin(target):
                return False, "x-frame-options"
    return True, None


def is_loopback(url: str) -> bool:
    return bool(LOOPBACK_HOSTS.match(urlsplit(url).hostname or ""))


def checked_url(url: str) -> str:
    parts = urlsplit((url or "").strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError("Only http and https addresses can be opened")
    return parts.geturl()


async def probe(url: str, viewer: Optional[str]) -> dict[str, Any]:
    """Fetch ``url`` from the gateway and report reachability, framing and title."""
    import httpx

    url = checked_url(url)
    started = time.monotonic()
    out: dict[str, Any] = {"url": url, "loopback": is_loopback(url)}
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=PROBE_TIMEOUT, verify=True) as client:
            async with client.stream("GET", url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.8"}) as res:
                body = b""
                async for chunk in res.aiter_bytes():
                    body += chunk
                    if len(body) >= PROBE_READ_LIMIT or TITLE_RE.search(body):
                        break
                final = str(res.url)
                embeddable, reason = frame_policy(res.headers.multi_items(), final, viewer)
                title = TITLE_RE.search(body)
                out.update(
                    reachable=True,
                    status=res.status_code,
                    finalUrl=final,
                    embeddable=embeddable,
                    reason=reason,
                    title=unescape(title.group(1).decode("utf-8", "replace")).strip()[:200] if title else None,
                )
    except Exception as exc:  # unreachable from the gateway too
        out.update(reachable=False, embeddable=None, reason="unreachable", error=type(exc).__name__)
    out["ms"] = round((time.monotonic() - started) * 1000)
    return out


# ---------------------------------------------------------------- gateway page view

def find_chrome() -> Optional[str]:
    """A Chromium for the gateway page view: ``HERMES_BROWSER_CHROME``, Playwright's headless
    shell, then a system Chromium/Chrome."""
    env = os.environ.get("HERMES_BROWSER_CHROME")
    if env and os.access(env, os.X_OK):
        return env
    cached = sorted(glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell")))
    if cached and os.access(cached[-1], os.X_OK):
        return cached[-1]
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        path = shutil.which(name)
        if path:
            return path
    return None


KEYS = {
    "Enter": (13, "\r"), "Backspace": (8, None), "Tab": (9, None), "Escape": (27, None), "Delete": (46, None),
    "ArrowLeft": (37, None), "ArrowUp": (38, None), "ArrowRight": (39, None), "ArrowDown": (40, None),
    "Home": (36, None), "End": (35, None), "PageUp": (33, None), "PageDown": (34, None),
}


@dataclass
class _Page:
    ws: Any
    next_id: int = 0
    pending: dict[int, asyncio.Future] = field(default_factory=dict)
    waiters: dict[str, list[asyncio.Future]] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    reader: Optional[asyncio.Task] = None
    target_id: str = ""
    used: float = field(default_factory=time.monotonic)
    size: tuple[int, int] = (0, 0)

    async def read(self) -> None:
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                if "id" in msg:
                    fut = self.pending.pop(msg["id"], None)
                    if fut and not fut.done():
                        if "error" in msg:
                            fut.set_exception(RuntimeError(msg["error"].get("message", "devtools error")))
                        else:
                            fut.set_result(msg.get("result", {}))
                else:
                    for fut in self.waiters.pop(msg.get("method", ""), []):
                        if not fut.done():
                            fut.set_result(msg.get("params", {}))
        except Exception:
            pass
        finally:
            for fut in list(self.pending.values()):
                if not fut.done():
                    fut.set_exception(RuntimeError("page closed"))

    async def send(self, method: str, params: Optional[dict] = None, timeout: float = 10.0) -> dict:
        self.next_id += 1
        fut = asyncio.get_running_loop().create_future()
        self.pending[self.next_id] = fut
        await self.ws.send(json.dumps({"id": self.next_id, "method": method, "params": params or {}}))
        return await asyncio.wait_for(fut, timeout)

    def wait_for(self, event: str) -> asyncio.Future:
        fut = asyncio.get_running_loop().create_future()
        self.waiters.setdefault(event, []).append(fut)
        return fut


class PageView:
    """One lazily started headless Chromium, a few pages, closed after a quiet spell."""

    MAX_PAGES = 6
    IDLE_SECONDS = 180

    def __init__(self) -> None:
        self.proc: Optional[asyncio.subprocess.Process] = None
        self.port = 0
        self.profile: Optional[str] = None
        self.pages: dict[str, _Page] = {}
        self.start_lock = asyncio.Lock()
        self.reaper: Optional[asyncio.Task] = None

    @property
    def alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def _start(self) -> None:
        chrome = find_chrome()
        if not chrome:
            raise RuntimeError("No Chromium-based browser was found on the gateway")
        # Try the browser's own sandbox first; hosts that disable unprivileged user namespaces
        # make it exit at once, and only then is it relaunched without one.
        for sandbox in (True, False):
            if await self._launch(chrome, sandbox):
                break
        else:
            raise RuntimeError("The gateway browser did not start")
        if self.reaper is None or self.reaper.done():
            self.reaper = asyncio.create_task(self._reap())

    async def _launch(self, chrome: str, sandbox: bool) -> bool:
        self.profile = tempfile.mkdtemp(prefix="hermes-browser-")
        args = [
            chrome, "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
            f"--user-data-dir={self.profile}", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
            "--mute-audio", "--disable-extensions", "--disable-background-networking", "--hide-scrollbars",
            "--disable-dev-shm-usage", "--disable-features=Translate,MediaRouter", "about:blank",
        ]
        if "headless-shell" not in chrome:
            args.insert(1, "--headless=new")
        if not sandbox:
            args.insert(1, "--no-sandbox")
        self.proc = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            preexec_fn=lambda: os.nice(10), start_new_session=True,
        )
        marker = os.path.join(self.profile, "DevToolsActivePort")
        for _ in range(100):
            if self.proc.returncode is not None:
                break
            if os.path.exists(marker):
                with open(marker) as fh:
                    first = fh.readline().strip()
                if first.isdigit():
                    self.port = int(first)
                    return True
            await asyncio.sleep(0.1)
        await self.close()
        return False

    async def _reap(self) -> None:
        while self.alive:
            await asyncio.sleep(30)
            now = time.monotonic()
            for tab, page in list(self.pages.items()):
                if now - page.used > self.IDLE_SECONDS:
                    await self.drop(tab)
            if not self.pages:
                await self.close()

    async def close(self) -> None:
        for tab in list(self.pages):
            await self.drop(tab)
        proc, self.proc = self.proc, None
        if proc and proc.returncode is None:
            proc.terminate()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(proc.wait(), 5)
            if proc.returncode is None:
                proc.kill()
        if self.profile:
            shutil.rmtree(self.profile, ignore_errors=True)
            self.profile = None

    async def drop(self, tab: str) -> None:
        page = self.pages.pop(tab, None)
        if page:
            await self._close_page(page)

    async def _close_page(self, page: _Page) -> None:
        with contextlib.suppress(Exception):
            await page.ws.close()
        if page.reader:
            page.reader.cancel()
        if page.target_id and self.alive:
            import httpx
            with contextlib.suppress(Exception):
                async with httpx.AsyncClient(timeout=3) as client:
                    await client.get(f"http://127.0.0.1:{self.port}/json/close/{page.target_id}")

    async def page(self, tab: str) -> _Page:
        import httpx
        from websockets.asyncio.client import connect

        async with self.start_lock:
            if not self.alive:
                self.pages.clear()
                await self._start()
            page = self.pages.get(tab)
            if page:
                return page
            if len(self.pages) >= self.MAX_PAGES:
                oldest = min(self.pages, key=lambda k: self.pages[k].used)
                await self.drop(oldest)
            async with httpx.AsyncClient(timeout=5) as client:
                res = await client.put(f"http://127.0.0.1:{self.port}/json/new?about:blank")
                info = res.json()
            ws = await connect(info["webSocketDebuggerUrl"], max_size=None, open_timeout=5)
            page = _Page(ws=ws, target_id=info.get("id", ""))
            page.reader = asyncio.create_task(page.read())
            await page.send("Page.enable")
            self.pages[tab] = page
            return page

    async def act(self, tab: str, url: Optional[str], action: Optional[dict], width: int, height: int) -> dict:
        page = await self.page(tab)
        async with page.lock:
            page.used = time.monotonic()
            width, height = max(320, min(int(width or 1024), 1920)), max(240, min(int(height or 720), 1600))
            if page.size != (width, height):
                await page.send("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False})
                page.size = (width, height)
            error = None
            if url:
                error = await self._navigate(page, checked_url(url))
            if error:
                # A failed load swaps in Chromium's error page, which detaches this DevTools
                # session: report it and start that tab afresh next time.
                self.pages.pop(tab, None)
                asyncio.create_task(self._close_page(page))
                return {"image": None, "url": url, "title": "", "canGoBack": False, "canGoForward": False,
                        "width": width, "height": height, "error": error}
            if action:
                await self._input(page, action)
            history = await page.send("Page.getNavigationHistory")
            entries, index = history.get("entries", []), history.get("currentIndex", 0)
            first = next((i for i, e in enumerate(entries) if e.get("url") != "about:blank"), len(entries))
            current = entries[index] if entries else {}
            image = None
            if not error:
                for attempt in range(2):
                    try:
                        shot = await page.send("Page.captureScreenshot", {"format": "jpeg", "quality": 74}, timeout=15)
                        image = "data:image/jpeg;base64," + shot["data"]
                        break
                    except RuntimeError:
                        await asyncio.sleep(0.3)
            return {
                "image": image,
                "url": current.get("url", url or "") if not error else (url or current.get("url", "")),
                "title": current.get("title", ""),
                "canGoBack": index > first,
                "canGoForward": index < len(entries) - 1,
                "width": width,
                "height": height,
                "error": error,
            }

    async def _navigate(self, page: _Page, url: str) -> Optional[str]:
        loaded = page.wait_for("Page.loadEventFired")
        result = await page.send("Page.navigate", {"url": url}, timeout=15)
        if result.get("errorText"):
            loaded.cancel()
            return result["errorText"]
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(loaded, 10)
        await asyncio.sleep(0.25)
        return None

    async def _input(self, page: _Page, action: dict) -> None:
        kind = action.get("kind")
        x, y = float(action.get("x", 0)), float(action.get("y", 0))
        if kind == "click":
            nav = page.wait_for("Page.frameStartedLoading")
            for phase in ("mousePressed", "mouseReleased"):
                await page.send("Input.dispatchMouseEvent", {"type": phase, "x": x, "y": y, "button": "left", "clickCount": 1})
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(nav, 0.4)
                loaded = page.wait_for("Page.loadEventFired")
                await asyncio.wait_for(loaded, 8)
            await asyncio.sleep(0.2)
        elif kind == "scroll":
            await page.send("Input.dispatchMouseEvent", {"type": "mouseWheel", "x": x, "y": y, "deltaX": float(action.get("dx", 0)), "deltaY": float(action.get("dy", 0))})
            await asyncio.sleep(0.15)
        elif kind == "type":
            await page.send("Input.insertText", {"text": str(action.get("text", ""))[:2000]})
        elif kind == "key":
            key = str(action.get("key", ""))
            if key in KEYS:
                code, text = KEYS[key]
                down = {"type": "keyDown", "key": key, "code": key, "windowsVirtualKeyCode": code}
                if text:
                    down["text"] = text
                nav = page.wait_for("Page.frameStartedLoading")
                await page.send("Input.dispatchKeyEvent", down)
                await page.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "code": key, "windowsVirtualKeyCode": code})
                if key == "Enter":
                    with contextlib.suppress(asyncio.TimeoutError):
                        await asyncio.wait_for(nav, 0.4)
                        await asyncio.wait_for(page.wait_for("Page.loadEventFired"), 8)
        elif kind in ("back", "forward"):
            history = await page.send("Page.getNavigationHistory")
            index = history.get("currentIndex", 0) + (-1 if kind == "back" else 1)
            entries = history.get("entries", [])
            first = next((i for i, e in enumerate(entries) if e.get("url") != "about:blank"), len(entries))
            if first <= index < len(entries):
                loaded = page.wait_for("Page.loadEventFired")
                await page.send("Page.navigateToHistoryEntry", {"entryId": entries[index]["id"]})
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(loaded, 8)
        elif kind == "reload":
            loaded = page.wait_for("Page.loadEventFired")
            await page.send("Page.reload")
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(loaded, 10)


VIEW = PageView()
