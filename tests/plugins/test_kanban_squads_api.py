"""Kanban dashboard API: the /squads routes over hermes_cli.kanban_squads."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hermes_cli import kanban_db as kb


def _router():
    plugin_file = Path(__file__).resolve().parents[2] / "plugins" / "kanban" / "dashboard" / "plugin_api.py"
    spec = importlib.util.spec_from_file_location("hermes_dashboard_plugin_kanban_squads_test", plugin_file)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod.router


@pytest.fixture
def client(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    (home / "config.yaml").write_text("model:\n  default: test/model\n", encoding="utf-8")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    kb.init_db()
    app = FastAPI()
    app.include_router(_router(), prefix="/api/plugins/kanban")
    return TestClient(app)


BASE = "/api/plugins/kanban/squads"


def test_catalog_lists_builtin_roles_and_templates(client):
    roles = {r["id"]: r for r in client.get(f"{BASE}/roles").json()["roles"]}
    assert roles["reviewer"]["profile"] == "squad-reviewer" and roles["reviewer"]["bot_exists"] is False
    templates = {t["id"] for t in client.get(f"{BASE}/templates").json()["templates"]}
    assert {"feature", "research-brief"} <= templates


def test_start_without_teammates_is_a_400_naming_them(client):
    res = client.post(f"{BASE}/runs", json={"template": "research-brief", "goal": "State of WebGPU"})
    assert res.status_code == 400
    assert "squad-researcher" in res.json()["detail"]


def test_start_list_get_and_message_round_trip(client):
    res = client.post(f"{BASE}/runs", json={"template": "research-brief", "goal": "State of WebGPU",
                                            "create_missing": True})
    assert res.status_code == 200, res.text
    run = res.json()["run"]
    assert [lane["key"] for lane in run["lanes"]] == ["primary", "practice", "brief"]
    assert [lane["status"] for lane in run["lanes"]] == ["ready", "ready", "todo"]

    assert [r["id"] for r in client.get(f"{BASE}/runs").json()["runs"]] == [run["id"]]
    assert client.get(f"{BASE}/runs/{run['id']}").json()["run"]["template"] == "research-brief"

    sent = client.post(f"{BASE}/runs/{run['id']}/messages", json={"body": "Focus on Safari", "step": "brief"})
    assert sent.status_code == 200
    brief = next(lane for lane in sent.json()["run"]["lanes"] if lane["key"] == "brief")
    assert brief["comments"] == 1


def test_unknown_squad_is_a_404(client):
    assert client.get(f"{BASE}/runs/nope").status_code == 404


def test_role_bot_creation_is_idempotent(client):
    first = client.post(f"{BASE}/roles/writer/bot").json()
    again = client.post(f"{BASE}/roles/writer/bot").json()
    assert first == {"profile": "squad-writer", "created": True}
    assert again == {"profile": "squad-writer", "created": False}
