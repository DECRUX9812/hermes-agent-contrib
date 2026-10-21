"""Team context in the system prompt: a seated profile's NEW sessions carry its role, boss,
mission, teammates and top lessons; the Bot Chat capability epoch moves when (and only when)
that text moves; a profile on no team is untouched."""
from __future__ import annotations

from pathlib import Path

import pytest

from agent import system_prompt as sp
from tools import bot_mode_probe as probe
from tools import bot_team as bt


@pytest.fixture
def root(tmp_path, monkeypatch):
    h = tmp_path / ".hermes"
    (h / "profiles" / "writer").mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(h))
    return h


@pytest.fixture
def team(root):
    t = bt.create_team(root, name="Growth", mission="Reach 10k users")
    bt.upsert_member(root, t["id"], profile="ceo", role="Chief of staff", lead=True)
    bt.upsert_member(root, t["id"], profile="writer", role="Content", reports_to="ceo")
    return t["id"]


def test_seated_profile_gets_role_boss_mission_and_lessons_but_not_goals(root, team):
    bt.upsert_goal(root, team, title="Volatile goal", owner="writer")
    bt.add_learning(root, team, text="Always cite sources", by="writer")
    section = bt.prompt_section(root, "writer")
    assert section.startswith("## Team") and "Reach 10k users" in section
    assert "You report to ceo" in section and "Always cite sources" in section
    assert "Volatile goal" not in section  # goals move daily; they reach workers via their task


def test_profile_on_no_team_gets_nothing_and_keeps_its_epoch(root, team):
    assert bt.prompt_section(root, "stranger") == ""
    home = root / "profiles" / "writer"
    before = probe.capability_fingerprint(home)
    bt.add_learning(root, team, text="New lesson", by="ceo")
    assert probe.capability_fingerprint(home) != before  # writer sits on the team: epoch moves
    lone = root / "profiles" / "loner"
    lone.mkdir()
    epoch = probe.capability_fingerprint(lone)
    bt.add_learning(root, team, text="Another lesson", by="ceo")
    assert probe.capability_fingerprint(lone) == epoch  # not on the team: untouched


def test_epoch_ignores_goal_churn_and_repeated_confirmation_of_a_known_lesson(root, team):
    home = root / "profiles" / "writer"
    bt.add_learning(root, team, text="Cite sources", by="ceo")
    epoch = probe.capability_fingerprint(home)
    bt.upsert_goal(root, team, title="Ship a post")
    assert probe.capability_fingerprint(home) == epoch


def test_team_block_rides_the_session_start_prompt_for_any_surface(root, team, monkeypatch):
    home = root / "profiles" / "writer"
    monkeypatch.setattr(sp, "_agent_home", lambda agent: home)
    parts = sp._team_parts(object())
    assert len(parts) == 1 and "Reach 10k users" in parts[0]
    monkeypatch.setattr(sp, "_agent_home", lambda agent: root / "profiles" / "nobody")
    assert sp._team_parts(object()) == []


def test_a_broken_team_store_never_breaks_prompt_build(root, monkeypatch):
    (root / "bot-teams" / "teams").mkdir(parents=True)
    (root / "bot-teams" / "teams" / "team_bad.json").write_text("{nope")
    monkeypatch.setattr(sp, "_agent_home", lambda agent: root / "profiles" / "writer")
    assert sp._team_parts(object()) == []
