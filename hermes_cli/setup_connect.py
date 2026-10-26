"""First-run connections the onboarding wizard sets up without a terminal.

- GitHub: the ``gh`` CLI is the GitHub integration (``web_routers/git.py`` explains why there is no
  MCP entry), so sign-in drives ``gh auth login --web`` and hands its one-time device code to the
  renderer, which opens github.com/login/device in the user's browser. ``gh`` keeps polling until the
  code is approved and stores the token in its own config, as an interactive login would.
- Cloudflare Quick Tunnel: ``cloudflared tunnel --url`` forwards a fresh ``*.trycloudflare.com``
  address to the Webapp's loopback port. The tunnel runs detached, so the gateway restart that
  applies Web Access does not take it down; its pid, start time and address live in
  ``<gateway home>/webapp/quick-tunnel.json``. A Quick Tunnel gets a new address every time
  cloudflared starts, so status reports ``stale`` when the address Web Access pins is not the live one.
"""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

_GH_CODE = re.compile(r"one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})")
_GH_URL = re.compile(r"https://github\.com/login/device\b")
_GH_ACCOUNT = re.compile(r"account\s+([A-Za-z0-9-]+)")
_TUNNEL_URL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
_TUNNEL_STATE = Path("webapp") / "quick-tunnel.json"
_TUNNEL_LOG = Path("webapp") / "quick-tunnel.log"
# A token in the environment makes gh skip the login entirely ("The value of the GH_TOKEN environment
# variable is being used"); the child sees only what it needs to find its own config.
_CHILD_ENV_KEYS = ("PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME",
                   "GH_CONFIG_DIR", "LANG", "LC_ALL", "SYSTEMROOT", "TMPDIR", "TEMP", "TMP")


class SetupConnectError(RuntimeError):
    """A connection cannot be set up as asked; ``str(exc)`` is the user-facing reason."""


def _child_env(**extra: str) -> dict[str, str]:
    env = {key: os.environ[key] for key in _CHILD_ENV_KEYS if key in os.environ}
    env.update(extra)
    return env


def _locate(name: str) -> Optional[str]:
    from hermes_platform.resolver.core import locate_command
    from hermes_platform.resolver.known_dirs import homebrew_dirs, user_local_bin

    found = locate_command(name, known_dirs=(*homebrew_dirs(), *user_local_bin())).command
    return found[0] if found else None


def _hidden_popen_kwargs(*, detach: bool) -> dict:
    from hermes_cli._subprocess_compat import IS_WINDOWS, windows_detach_flags, windows_hide_flags

    if IS_WINDOWS:
        return {"creationflags": windows_hide_flags() | (windows_detach_flags() if detach else 0)}
    return {"start_new_session": True}


# --- GitHub ---------------------------------------------------------------------------------------

@dataclass
class _GithubLogin:
    proc: subprocess.Popen
    user_code: str = ""
    verification_url: str = ""
    output: list[str] = field(default_factory=list)
    ready: threading.Event = field(default_factory=threading.Event)


_login: Optional[_GithubLogin] = None
_login_lock = threading.Lock()


def _drain(login: _GithubLogin) -> None:
    for line in login.proc.stdout:
        login.output.append(line.rstrip())
        del login.output[:-40]
        if not login.user_code and (match := _GH_CODE.search(line)):
            login.user_code = match.group(1)
        if not login.verification_url and (match := _GH_URL.search(line)):
            login.verification_url = match.group(0)
        if login.user_code and login.verification_url:
            login.ready.set()
    login.ready.set()


def _login_view(login: Optional[_GithubLogin]) -> Optional[dict]:
    if login is None:
        return None
    code = login.proc.poll()
    state = "pending" if code is None else ("succeeded" if code == 0 else "failed")
    view = {"state": state, "user_code": login.user_code, "verification_url": login.verification_url}
    if state == "failed":
        view["detail"] = "\n".join(line for line in login.output[-5:] if line and not _GH_CODE.search(line))
    return view


def github_status() -> dict:
    """``available`` (gh found), ``authenticated``, the signed-in ``account``, and the ``login`` in
    flight (or just finished) from :func:`github_login_start`."""
    from hermes_cli._subprocess_compat import bounded_probe_run

    gh = _locate("gh")
    status = {"available": gh is not None, "authenticated": False, "account": None, "login": _login_view(_login)}
    if gh is None:
        return status
    proc = bounded_probe_run([gh, "auth", "status", "--hostname", "github.com"], timeout=10, env=_child_env())
    if proc is not None and proc.returncode == 0:
        match = _GH_ACCOUNT.search(f"{proc.stdout}\n{proc.stderr}")
        status.update(authenticated=True, account=match.group(1) if match else None)
    return status


def github_login_start(*, timeout: float = 20.0) -> dict:
    """Start (or rejoin) a device-code sign-in; returns ``{user_code, verification_url, state}``."""
    global _login
    gh = _locate("gh")
    if gh is None:
        raise SetupConnectError("GitHub CLI (gh) is not installed on this computer.")
    with _login_lock:
        if _login is not None and _login.proc.poll() is None and _login.user_code:
            return _login_view(_login)
        github_login_cancel(locked=True)
        # BROWSER=true: gh would open the device page on the host; the renderer opens it for the user.
        proc = subprocess.Popen(
            [gh, "auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web", "--skip-ssh-key"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            env=_child_env(BROWSER="true", GH_BROWSER="true"), **_hidden_popen_kwargs(detach=False))
        login = _GithubLogin(proc=proc)
        # gh waits for Enter before polling ("Press Enter to open github.com in your browser").
        proc.stdin.write("\n")
        proc.stdin.flush()
        threading.Thread(target=_drain, args=(login,), name="gh-device-login", daemon=True).start()
        if not login.ready.wait(timeout) or not login.user_code:
            proc.kill()
            raise SetupConnectError("GitHub did not hand out a sign-in code. Try again in a moment.")
        _login = login
        return _login_view(login)


def github_login_cancel(*, locked: bool = False) -> None:
    global _login
    if not locked:
        with _login_lock:
            return github_login_cancel(locked=True)
    if _login is not None and _login.proc.poll() is None:
        _login.proc.kill()
    _login = None


# --- Cloudflare Quick Tunnel ----------------------------------------------------------------------

def _tunnel_paths() -> tuple[Path, Path]:
    from hermes_cli.webapp_access import gateway_home

    home = gateway_home()
    return home / _TUNNEL_STATE, home / _TUNNEL_LOG


def _read_state(path: Path) -> dict:
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return state if isinstance(state, dict) else {}


def _alive(state: dict) -> bool:
    """The recorded tunnel is still the process that wrote the record: pid AND start time, so a
    recycled pid never reads as a live tunnel (or gets signalled by Stop)."""
    from hermes_cli.update_lock import CREATE_TIME_TOLERANCE_SECONDS, process_create_time

    pid, started = state.get("pid"), state.get("started_at")
    if not isinstance(pid, int) or not isinstance(started, (int, float)):
        return False
    now = process_create_time(pid)
    return now is not None and abs(now - started) <= CREATE_TIME_TOLERANCE_SECONDS


def tunnel_status(pinned_url: Optional[str] = None) -> dict:
    """``cloudflared`` (found), ``running``, the live ``url``, and ``stale`` when Web Access pins a
    different address than the running tunnel's (*pinned_url*, the configured ``webapp.public_url``)."""
    state_path, _log = _tunnel_paths()
    state = _read_state(state_path)
    running = _alive(state)
    url = state.get("url") if running else None
    return {
        "cloudflared": _locate("cloudflared") is not None,
        "running": running,
        "url": url,
        "port": state.get("port") if running else None,
        "stale": bool(pinned_url and pinned_url.endswith(".trycloudflare.com") and pinned_url != url),
    }


def tunnel_start(port: int, *, timeout: float = 45.0) -> dict:
    """Start a Quick Tunnel to ``127.0.0.1:<port>`` (or keep the live one for that port) and return
    its status once cloudflared has printed the address."""
    from hermes_cli.update_lock import process_create_time

    state_path, log_path = _tunnel_paths()
    state = _read_state(state_path)
    if _alive(state) and state.get("port") == port and state.get("url"):
        return tunnel_status()
    tunnel_stop()
    cloudflared = _locate("cloudflared")
    if cloudflared is None:
        raise SetupConnectError("cloudflared is not installed on this computer.")
    log_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(log_path, "w", encoding="utf-8") as log:
        proc = subprocess.Popen(
            [cloudflared, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"],
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, env=_child_env(),
            **_hidden_popen_kwargs(detach=True))
    deadline = time.monotonic() + timeout
    url = None
    while time.monotonic() < deadline and proc.poll() is None:
        if match := _TUNNEL_URL.search(log_path.read_text(encoding="utf-8", errors="replace")):
            url = match.group(0)
            break
        time.sleep(0.25)
    if url is None:
        if proc.poll() is None:
            proc.kill()
        raise SetupConnectError("Cloudflare did not give the tunnel an address. Check your connection and try again.")
    started = process_create_time(proc.pid)
    state_path.write_text(json.dumps({"pid": proc.pid, "started_at": started, "url": url, "port": port}) + "\n",
                          encoding="utf-8")
    return tunnel_status()


def tunnel_stop() -> None:
    state_path, _log = _tunnel_paths()
    state = _read_state(state_path)
    if _alive(state):
        try:
            os.kill(state["pid"], signal.SIGTERM)
        except OSError:
            pass
    state_path.unlink(missing_ok=True)
