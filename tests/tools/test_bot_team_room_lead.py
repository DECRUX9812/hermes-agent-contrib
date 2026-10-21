"""Behavior contracts for the team-orchestrated room gate in tools/bot_team.py — who a group
chat listens through. A room is orchestrated only when its members all sit on one team AND
that team's org-tree lead is one of them; anything ambiguous (forked chart, lead absent,
lead paused, two covering teams disagreeing) stays on fan-out listening — never guessed."""

from __future__ import annotations

import pytest

from tools import bot_team as bt


@pytest.fixture
def root(tmp_path):
    return tmp_path


def _team(root, name="Growth"):
    t = bt.create_team(root, name=name, mission="Reach 10k users")
    return t["id"]


def _seat(root, tid, profile, **fields):
    return bt.upsert_member(root, tid, profile=profile, **fields)


def test_lead_badge_beats_root_inference(root):
    tid = _team(root)
    _seat(root, tid, "ceo", role="Chief", lead=True)
    _seat(root, tid, "writer", role="Content", reports_to="ceo")
    _seat(root, tid, "editor", role="Edit", reports_to="ceo")
    resolved = bt.room_lead(root, ["ceo", "writer", "editor"])
    assert resolved["lead"] == "ceo" and resolved["team_id"] == tid
    assert resolved["lead_slot"]


def test_sole_root_leads_without_a_badge(root):
    tid = _team(root)
    _seat(root, tid, "ceo", role="Chief")
    _seat(root, tid, "writer", role="Content", reports_to="ceo")
    resolved = bt.room_lead(root, ["ceo", "writer"])
    assert resolved["lead"] == "ceo"


def test_forked_org_tree_has_no_lead(root):
    tid = _team(root)
    _seat(root, tid, "ceo", role="Chief")
    _seat(root, tid, "cfo", role="Money")
    _seat(root, tid, "writer", role="Content", reports_to="ceo")
    assert bt.room_lead(root, ["ceo", "cfo", "writer"]) is None


def test_a_room_the_lead_is_not_in_is_not_orchestrated(root):
    _tid = _team(root)
    tid = _tid
    _seat(root, tid, "ceo", role="Chief", lead=True)
    _seat(root, tid, "writer", role="Content", reports_to="ceo")
    # All seated members belong to the team but the orchestrator is absent:
    # nothing should appoint a listener in the lead's place.
    assert bt.room_lead(root, ["writer"]) is None


def test_a_room_with_a_stranger_stays_on_fan_out(root):
    tid = _team(root)
    _seat(root, tid, "ceo", role="Chief", lead=True)
    _seat(root, tid, "writer", role="Content", reports_to="ceo")
    # "stranger" holds no seat on any team, so no team covers this roster.
    assert bt.room_lead(root, ["ceo", "writer", "stranger"]) is None


def test_paused_lead_falls_back_to_fan_out(root):
    tid = _team(root)
    _seat(root, tid, "ceo", role="Chief", lead=True)
    _seat(root, tid, "writer", role="Content", reports_to="ceo")
    _seat(root, tid, "ceo", status="paused")
    assert bt.room_lead(root, ["ceo", "writer"]) is None


def test_open_seats_do_not_fill_the_room(root):
    tid = _team(root)
    _seat(root, tid, "ceo", role="Chief", lead=True)
    _seat(root, tid, "writer", role="Content", reports_to="ceo")
    bt.upsert_member(root, tid, role="Designer")  # open seat: profile=None
    resolved = bt.room_lead(root, ["ceo", "writer"])
    assert resolved["lead"] == "ceo"


def test_two_teams_naming_different_leads_is_ambiguous(root):
    a = _team(root, "Alpha")
    _seat(root, a, "ceo", role="Chief", lead=True)
    _seat(root, a, "writer", role="Content", reports_to="ceo")
    b = _team(root, "Beta")
    _seat(root, b, "writer", role="Edit", lead=True)
    _seat(root, b, "ceo", role="Advisor", reports_to="writer")
    # Both teams cover {ceo, writer} but disagree on who leads it — a room must
    # never guess between two orchestrators, so it stays on fan-out.
    assert bt.room_lead(root, ["ceo", "writer"]) is None


def test_two_teams_agreeing_on_a_lead_picks_the_tightest_cover(root):
    a = _team(root, "Alpha")
    _seat(root, a, "ceo", role="Chief", lead=True)
    _seat(root, a, "writer", role="Content", reports_to="ceo")
    _seat(root, a, "extra", role="Ops", reports_to="ceo")
    b = _team(root, "Beta")
    _seat(root, b, "ceo", role="Chief", lead=True)
    _seat(root, b, "writer", role="Content", reports_to="ceo")
    resolved = bt.room_lead(root, ["ceo", "writer"])
    assert resolved["lead"] == "ceo" and resolved["team_id"] == b


def test_empty_and_degenerate_member_lists_resolve_no_lead(root):
    tid = _team(root)
    _seat(root, tid, "ceo", role="Chief", lead=True)
    for members in ([], ["", "  "], None):
        assert bt.room_lead(root, members) is None
