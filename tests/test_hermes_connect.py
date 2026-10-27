"""hermes-connect plugin (``dashboard/connect.py``, ``/api/plugins/hermes-connect/*``).

It uses core's test helpers and conftest, so run it from inside the core test tree, e.g. symlink it to
``<core>/tests/hermes_cli/test_zz_hermes_connect.py`` and run pytest there with a scratch HERMES_HOME.

Contracts: GitHub sign-in hands the renderer gh's own device code and never lets a token in the
environment short-circuit the login; a Quick Tunnel only ever forwards to a Webapp that Web Access
has gated behind Nous sign-in (no Nous account: the tunnel is stopped again, nothing is written);
liveness is pid + start time, so a stopped tunnel never reads as running.
"""

from __future__ import annotations

import os
import stat
import textwrap
from pathlib import Path

import pytest

pytest.importorskip("fastapi")

from tests.waiting import wait_until

PLUGIN_DASH = Path(__file__).resolve().parents[1] / "plugins" / "hermes-connect" / "dashboard"
PREFIX = "/api/plugins/hermes-connect"


def _plugin_api():
    import importlib.util
    import sys

    name = "hermes_dashboard_plugin_hermes-connect"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, PLUGIN_DASH / "plugin_api.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
    return sys.modules[name]


@pytest.fixture()
def setup_connect():
    return _plugin_api().setup_connect


@pytest.fixture()
def mounted(monkeypatch):
    """Mount the plugin router on the core app the way the dashboard does, then take it off again.

    The test home has no plugins.enabled entry, so the plugin gate is told this one is enabled.
    """
    from hermes_cli import web_server

    refused = web_server._plugin_api_request_refused

    async def enabled_here(name):
        return False if name == "hermes-connect" else await refused(name)

    monkeypatch.setattr(web_server, "_plugin_api_request_refused", enabled_here)

    routes = web_server.app.router.routes
    before = list(routes)
    web_server.app.include_router(_plugin_api().router, prefix=PREFIX)
    routes[:] = routes[len(before):] + before  # ahead of the SPA catch-all, like a startup mount
    try:
        yield
    finally:
        routes[:] = before


def _script(bin_dir: Path, name: str, body: str) -> None:
    path = bin_dir / name
    path.write_text("#!/bin/sh\n" + textwrap.dedent(body))
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


@pytest.fixture()
def fake_bin(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}")
    return bin_dir


@pytest.fixture()
def fake_gh(fake_bin, tmp_path):
    """A gh that logs in once ``approved`` exists, and reports whatever token env it was given."""
    approved = tmp_path / "approved"
    _script(fake_bin, "gh", f"""
        if [ "$1 $2" = "auth status" ]; then
          if [ -e "{approved}" ]; then echo "Logged in to github.com account octocat (keyring)"; exit 0; fi
          echo "You are not logged into any GitHub hosts." >&2; exit 1
        fi
        echo "token-env=${{GH_TOKEN:-}}${{GITHUB_TOKEN:-}}"
        echo "! First copy your one-time code: AB12-CD34"
        echo "Open this URL to continue in your web browser: https://github.com/login/device"
        read _enter
        while [ ! -e "{approved}" ]; do sleep 0.1; done
        echo "Logged in as octocat"
    """)
    return approved


@pytest.mark.platforms("posix")
def test_github_sign_in_hands_out_the_device_code_and_finishes_when_approved(fake_gh, monkeypatch, setup_connect):
    monkeypatch.setenv("GH_TOKEN", "ghp_should_not_reach_gh")
    try:
        assert setup_connect.github_status()["authenticated"] is False
        started = setup_connect.github_login_start()
        assert started == {"state": "pending", "user_code": "AB12-CD34",
                           "verification_url": "https://github.com/login/device"}
        # A second start while one is in flight rejoins it instead of minting a new code.
        assert setup_connect.github_login_start()["user_code"] == "AB12-CD34"
        assert all("ghp_" not in line for line in setup_connect._login.output)

        fake_gh.touch()
        wait_until(lambda: setup_connect.github_status()["login"]["state"] == "succeeded", timeout=10)
        status = setup_connect.github_status()
        assert status["authenticated"] is True and status["account"] == "octocat"
    finally:
        setup_connect.github_login_cancel()


def test_github_sign_in_without_gh_is_a_plain_reason(monkeypatch, setup_connect):
    monkeypatch.setattr(setup_connect, "_locate", lambda name: None)
    assert setup_connect.github_status() == {"available": False, "authenticated": False, "account": None, "login": None}
    with pytest.raises(setup_connect.SetupConnectError, match="not installed"):
        setup_connect.github_login_start()


@pytest.fixture()
def fake_cloudflared(fake_bin):
    _script(fake_bin, "cloudflared", """
        echo "INF Requesting new quick Tunnel on trycloudflare.com..."
        echo "INF |  https://quiet-fox-123.trycloudflare.com  |"
        exec sleep 300
    """)


@pytest.fixture()
def client(monkeypatch, mounted):
    from tests.hermes_cli.native_gateway_client import native_desktop_client

    return native_desktop_client(monkeypatch)


@pytest.fixture(autouse=True)
def no_restart_or_build(monkeypatch):
    import hermes_cli.web_server_gateway as gw
    from hermes_cli import webapp

    monkeypatch.setattr(gw, "_restart_gateway_after", lambda profile, *, what, label: {"restart_started": True})
    monkeypatch.setattr(webapp, "prepare_webapp_renderer",
                        lambda project_root, **_o: webapp.webapp_dist_dir(project_root))


@pytest.mark.platforms("posix")
def test_tunnel_start_gates_the_webapp_on_its_address_and_stop_ends_it(client, fake_cloudflared, monkeypatch, setup_connect):
    from hermes_cli import webapp_access
    from hermes_cli.config import load_config

    callbacks: list[str] = []
    monkeypatch.setattr(webapp_access, "nous_signed_in", lambda: True)
    monkeypatch.setattr(webapp_access, "_register_nous_sign_in", callbacks.append)
    try:
        started = client.post(PREFIX + "/tunnel/start")
        assert started.status_code == 200, started.text
        url = "https://quiet-fox-123.trycloudflare.com"
        assert started.json()["tunnel"]["url"] == url
        assert load_config()["webapp"]["public_url"] == url
        assert callbacks == [f"{url}/auth/callback"]
        assert client.get(PREFIX + "/tunnel").json() == {
            "cloudflared": True, "running": True, "url": url, "port": started.json()["tunnel"]["port"], "stale": False}

        stopped = client.post(PREFIX + "/tunnel/stop")
        assert stopped.status_code == 200, stopped.text
        assert load_config()["webapp"]["enabled"] is False
        assert setup_connect.tunnel_status()["running"] is False
    finally:
        setup_connect.tunnel_stop()


@pytest.mark.platforms("posix")
def test_tunnel_without_a_nous_account_is_stopped_and_writes_nothing(client, fake_cloudflared, monkeypatch, setup_connect):
    from hermes_cli import webapp_access
    from hermes_cli.config import load_config

    monkeypatch.setattr(webapp_access, "nous_signed_in", lambda: False)
    try:
        refused = client.post(PREFIX + "/tunnel/start")
        assert refused.status_code == 400 and "Nous" in refused.json()["detail"]
        assert setup_connect.tunnel_status()["running"] is False
        assert not load_config().get("webapp", {}).get("public_url")
    finally:
        setup_connect.tunnel_stop()


def test_tunnel_routes_refuse_a_browser_credential(mounted):
    """Only native Desktop on this computer may expose it; a plain dashboard caller is refused."""
    from fastapi.testclient import TestClient

    from hermes_cli import web_server

    plain = TestClient(web_server.app, raise_server_exceptions=False)
    assert plain.post(PREFIX + "/tunnel/start").status_code in (401, 403, 404)


def test_a_recycled_pid_never_reads_as_a_live_tunnel(tmp_path, monkeypatch, setup_connect):
    from hermes_cli.update_lock import process_create_time

    state_path, _log = setup_connect._tunnel_paths()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    mine = process_create_time(os.getpid())
    state_path.write_text(f'{{"pid": {os.getpid()}, "started_at": {mine - 3600}, "url": "https://x.trycloudflare.com", "port": 1}}')
    assert setup_connect.tunnel_status()["running"] is False
    setup_connect.tunnel_stop()  # must not signal this (unrelated, live) process
    assert not state_path.exists()
