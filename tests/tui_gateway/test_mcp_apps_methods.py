"""LIVE E2E: ``mcp_apps.*`` over the real ``handle_request`` funnel against a real stdio MCP Apps
server, and the ``mcp_app`` descriptor a completed app tool carries into its persisted result
metadata (the Desktop mounts the app inline from it, live and after a reload)."""

from __future__ import annotations

import sys
import textwrap
import uuid
from pathlib import Path

import pytest
import hermes_yaml as yaml

_SERVER = """
from mcp.server import MCPServer
from mcp.server.apps import Apps

apps = Apps()

@apps.tool(resource_uri="ui://notes/app.html", description="Show notes")
def show_notes() -> str:
    return "notes"

@apps.tool(resource_uri="ui://notes/app.html", visibility=["app"], description="Save a note")
def save_note(text: str) -> str:
    return "saved:" + text

apps.add_html_resource("ui://notes/app.html", "<!doctype html><p>notes</p>")
MCPServer("notes", extensions=[apps]).run("stdio")
"""


@pytest.fixture
def gateway(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    server_py = tmp_path / "notes_server.py"
    server_py.write_text(textwrap.dedent(_SERVER), encoding="utf-8")
    (home / "config.yaml").write_text(yaml.safe_dump({
        "mcp_servers": {"notes": {"command": sys.executable, "args": [str(server_py)]}}}), encoding="utf-8")
    from tools.mcp_tool_discovery import discover_mcp_tools
    discover_mcp_tools()
    from tui_gateway import server
    yield server
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    shutdown_mcp_servers()


def _rpc(server, method: str, params: dict) -> dict:
    return server.handle_request({"id": f"rid-{uuid.uuid4().hex[:6]}", "method": method, "params": params})


def test_desktop_lists_reads_and_calls_an_app_over_rpc(gateway):
    apps = _rpc(gateway, "mcp_apps.list", {})["result"]["apps"]
    by_tool = {a["tool"]: a for a in apps}
    assert by_tool["save_note"]["registry_name"] is None  # app-only

    doc = _rpc(gateway, "mcp_apps.read_ui", {"server": "notes", "uri": "ui://notes/app.html"})["result"]
    assert "notes" in doc["html"]

    called = _rpc(gateway, "mcp_apps.call", {"server": "notes", "tool": "save_note", "arguments": {"text": "hi"}})
    assert called["result"]["content"][0]["text"] == "saved:hi"

    refused = _rpc(gateway, "mcp_apps.read_ui", {"server": "notes", "uri": "https://evil.example/app.html"})
    assert refused["error"]["code"] == 4140


def test_a_completed_app_tool_carries_its_app_into_result_metadata(gateway):
    _prepare_tool_result_metadata = gateway._prepare_tool_result_metadata  # rebound onto server globals

    meta = _prepare_tool_result_metadata("no-session", "call-1", "mcp__notes__show_notes", {}, '{"result": "notes"}')
    assert meta["tool_result_metadata"]["mcp_app"] == {
        "server": "notes", "tool": "show_notes", "resourceUri": "ui://notes/app.html", "title": "show_notes"}
    assert gateway._tool_lifecycle_required_for_ui("mcp__notes__show_notes")
    assert not _prepare_tool_result_metadata("no-session", "call-2", "terminal", {}, "ok")
