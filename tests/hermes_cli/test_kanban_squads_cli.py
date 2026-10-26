"""``hermes kanban squad``: the CLI drives the same squad graph as the dashboard."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hermes_cli import kanban as kanban_cli
from hermes_cli import kanban_db as kb


@pytest.fixture
def home(tmp_path, monkeypatch):
    root = tmp_path / ".hermes"
    root.mkdir()
    (root / "config.yaml").write_text("model:\n  default: test/model\n", encoding="utf-8")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(root))
    kb.init_db()
    return root


def test_templates_lists_steps_with_their_gates(home):
    out = kanban_cli.run_slash("squad templates")
    assert "feature: Feature" in out
    assert "review (reviewer) after build, tests [final]" in out


def test_start_refuses_unstaffed_roles_then_starts_with_create_missing(home):
    refused = kanban_cli.run_slash("squad start research-brief 'State of WebGPU'")
    assert "squad-researcher" in refused

    started = json.loads(kanban_cli.run_slash("squad start research-brief 'State of WebGPU' --create-missing --json"))
    assert [lane["status"] for lane in started["lanes"]] == ["ready", "ready", "todo"]

    shown = kanban_cli.run_slash(f"squad show {started['id']}")
    assert "brief" in shown and "[final]" in shown and "(0/3 done)" in shown


def test_assign_staffs_a_role_with_an_existing_profile(home):
    kanban_cli.run_slash("squad bot writer")
    out = kanban_cli.run_slash(
        "squad start research-brief 'x' --assign researcher=squad-writer --json")
    run = json.loads(out)
    assert {lane["profile"] for lane in run["lanes"]} == {"squad-writer"}


def test_bad_assign_is_a_clear_error(home):
    assert "ROLE=PROFILE" in kanban_cli.run_slash("squad start feature 'x' --assign analyst")
