"""MCP Apps host — live E2E against a real stdio server built on the SDK's own ``Apps`` extension.

Contracts (the security boundary of rendering a server's UI):
- a tool whose ``_meta.ui.visibility`` omits ``"model"`` never reaches the model's tool schema,
  yet stays callable from its app;
- an app can call only tools whose visibility lists ``"app"``;
- Hermes advertises MCP Apps on connect, so a server that branches on client support sends UI.
"""

from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path

import pytest
import hermes_yaml as yaml

_SERVER = """
from mcp.server import MCPServer
from mcp.server.apps import Apps, client_supports_apps
from mcp.server.mcpserver.context import Context

apps = Apps()
state = {"count": 0}

@apps.tool(resource_uri="ui://counter/app.html", description="Show the counter")
def show_counter(ctx: Context) -> str:
    return f"count={state['count']} ui={client_supports_apps(ctx)}"

@apps.tool(resource_uri="ui://counter/app.html", visibility=["app"], description="Increment the counter")
def increment() -> str:
    state["count"] += 1
    return f"count={state['count']}"

@apps.tool(resource_uri="ui://counter/app.html", visibility=["model"], description="Reset (model only)")
def reset() -> str:
    state["count"] = 0
    return "reset"

apps.add_html_resource("ui://counter/app.html", "<!doctype html><p id=c>counter</p>")
MCPServer("counter", extensions=[apps]).run("stdio")
"""


@pytest.fixture
def counter_server(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    server = tmp_path / "counter_server.py"
    server.write_text(textwrap.dedent(_SERVER), encoding="utf-8")
    (home / "config.yaml").write_text(yaml.safe_dump({
        "mcp_servers": {"counter": {"command": sys.executable, "args": [str(server)]}}}), encoding="utf-8")
    from tools.mcp_tool_discovery import discover_mcp_tools
    discover_mcp_tools()
    yield
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    shutdown_mcp_servers()


def test_app_only_tools_never_reach_the_model_but_stay_callable_from_the_app(counter_server):
    from tools import mcp_apps
    from tools.registry import registry

    names = set(registry.get_tool_names_for_toolset("mcp-counter"))
    assert "mcp__counter__show_counter" in names and "mcp__counter__reset" in names
    assert "mcp__counter__increment" not in names

    apps = {a["tool"]: a for a in mcp_apps.list_apps()}
    assert apps["increment"]["registry_name"] is None
    assert apps["show_counter"]["resourceUri"] == "ui://counter/app.html"

    result = mcp_apps.call_app_tool("counter", "increment", {})
    assert result["content"][0]["text"] == "count=1"
    with pytest.raises(PermissionError):
        mcp_apps.call_app_tool("counter", "reset", {})


def test_host_advertises_apps_and_serves_the_app_document(counter_server):
    from tools import mcp_apps
    from tools.registry import registry

    shown = json.loads(registry.dispatch("mcp__counter__show_counter", {}))["result"]
    assert "ui=True" in shown  # the server saw Hermes negotiate MCP Apps

    doc = mcp_apps.read_ui("counter", "ui://counter/app.html")
    assert "counter" in doc["html"] and doc["mimeType"].startswith("text/html")
    assert mcp_apps.app_for_registry_name("mcp__counter__show_counter")["server"] == "counter"
    with pytest.raises(ValueError):
        mcp_apps.read_ui("counter", "file:///etc/passwd")
