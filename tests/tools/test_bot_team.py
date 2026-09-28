"""Behavior contracts for tools/bot_team.py — the Team Bots store (org chart, goals, budgets,
approvals, learnings, packs). Each test pins a relationship the coordination layer must keep,
against a real temp store."""

from __future__ import annotations

import json

import pytest

from tools import bot_team as bt


@pytest.fixture
def root(tmp_path):
    return tmp_path


@pytest.fixture
def team(root):
    t = bt.create_team(root, name="Growth", mission="Reach 10k users")
    bt.upsert_member(root, t["id"], profile="ceo", role="Chief of staff", lead=True)
    bt.upsert_member(root, t["id"], profile="writer", role="Content", reports_to="ceo",
                     skills=["seo"], credentials=["WORDPRESS_TOKEN"], monthly_usd=10)
    return bt.get_team(root, t["id"])


def test_a_team_has_at_most_one_lead(root, team):
    tid = team["id"]
    bt.upsert_member(root, tid, profile="writer", lead=True)
    leads = [m["profile"] for m in bt.get_team(root, tid)["members"] if m["lead"]]
    assert leads == ["writer"]


def test_reporting_cycle_is_refused(root, team):
    tid = team["id"]
    with pytest.raises(bt.TeamError, match="cycle"):
        bt.upsert_member(root, tid, profile="ceo", reports_to="writer")


def test_removing_a_seat_reattaches_reports_and_unowns_goals(root, team):
    tid = team["id"]
    bt.upsert_member(root, tid, profile="editor", role="Editor", reports_to="writer")
    goal = bt.upsert_goal(root, tid, title="Launch blog", owner="writer")
    bt.remove_member(root, tid, "writer")
    t = bt.get_team(root, tid)
    editor = next(m for m in t["members"] if m["profile"] == "editor")
    ceo = next(m for m in t["members"] if m["profile"] == "ceo")
    assert editor["reports_to"] == ceo["slot"]
    assert next(g for g in t["goals"] if g["id"] == goal["id"])["owner"] is None


def test_a_profile_holds_one_seat_per_team(root, team):
    tid = team["id"]
    # naming an existing profile edits its seat rather than adding a second one…
    bt.upsert_member(root, tid, profile="writer", role="Content lead")
    assert [m["profile"] for m in bt.get_team(root, tid)["members"]].count("writer") == 1
    # …and moving another seat onto an occupied profile is refused.
    open_seat = bt.upsert_member(root, tid, role="Designer")
    with pytest.raises(bt.TeamError, match="already holds"):
        bt.upsert_member(root, tid, slot=open_seat["slot"], profile="writer")


def test_goal_ancestry_runs_mission_first_and_rejects_cycles(root, team):
    tid = team["id"]
    a = bt.upsert_goal(root, tid, title="Grow blog")
    b = bt.upsert_goal(root, tid, title="Ship 5 posts", parent_id=a["id"])
    chain = [c["title"] for c in bt.goal_ancestry(bt.get_team(root, tid), b["id"])]
    assert chain == ["Reach 10k users", "Grow blog", "Ship 5 posts"]
    with pytest.raises(bt.TeamError, match="cycle"):
        bt.upsert_goal(root, tid, goal_id=a["id"], parent_id=b["id"])


def test_rollup_folds_descendant_tasks_into_parents(root, team):
    tid = team["id"]
    a = bt.upsert_goal(root, tid, title="Grow blog")
    b = bt.upsert_goal(root, tid, title="Ship posts", parent_id=a["id"])
    bt.link_task(root, tid, a["id"], "t1")
    bt.link_task(root, tid, b["id"], "t2")
    bt.link_task(root, tid, b["id"], "t3")
    status = {"t1": "done", "t2": "done", "t3": "blocked"}
    out = bt.rollup(bt.get_team(root, tid), lookup=lambda ids: {i: status[i] for i in ids})
    assert out["goals"][b["id"]] | {} == out["goals"][b["id"]]
    assert (out["goals"][a["id"]]["done"], out["goals"][a["id"]]["total"]) == (2, 3)
    assert out["goals"][a["id"]]["blocked"] is True  # a blocked descendant surfaces upward
    assert out["overall"]["percent"] == 66


def test_rollup_survives_unavailable_kanban(root, team):
    tid = team["id"]
    g = bt.upsert_goal(root, tid, title="x")
    bt.link_task(root, tid, g["id"], "nope")
    out = bt.rollup(bt.get_team(root, tid))  # default lookup, no such task
    assert out["goals"][g["id"]]["total"] == 1 and out["goals"][g["id"]]["done"] == 0


def test_hard_budget_stops_work_and_soft_only_reports(root, team):
    tid = team["id"]
    assert bt.check_budget(root, tid, "writer")["allowed"] is True
    verdict = bt.record_spend(root, tid, "writer", 10)
    assert verdict["allowed"] is False and verdict["reason"] == "budget exhausted"
    bt.upsert_member(root, tid, profile="writer", hard_stop=False)
    soft = bt.check_budget(root, tid, "writer")
    assert soft["allowed"] is True and soft["over_budget"] is True


def test_paused_seat_is_not_allowed_and_non_members_are_unconstrained(root, team):
    bt.upsert_member(root, team["id"], profile="writer", status="paused")
    assert bt.check_budget(root, team["id"], "writer")["reason"] == "paused"
    assert bt.check_budget(root, team["id"], "stranger")["allowed"] is True


def test_requester_can_never_decide_its_own_approval(root, team):
    tid = team["id"]
    bt.update_team(root, tid, lead_decides=True)
    req = bt.request_approval(root, tid, kind="spend", subject="$50 ads", requested_by="ceo")
    with pytest.raises(bt.TeamError, match="own"):
        bt.decide_approval(root, tid, req["id"], approve=True, actor="ceo")
    with pytest.raises(bt.TeamError, match="only the board"):
        bt.decide_approval(root, tid, req["id"], approve=True, actor="writer")
    done = bt.decide_approval(root, tid, req["id"], approve=True, actor="you")
    assert done["status"] == "approved" and done["decided_by"] == "you"
    with pytest.raises(bt.TeamError, match="already"):
        bt.decide_approval(root, tid, req["id"], approve=False, actor="you")


def test_lead_decides_only_when_team_policy_allows(root, team):
    tid = team["id"]
    req = bt.request_approval(root, tid, kind="hire", subject="Designer", requested_by="writer")
    with pytest.raises(bt.TeamError):
        bt.decide_approval(root, tid, req["id"], approve=True, actor="ceo")
    bt.update_team(root, tid, lead_decides=True)
    assert bt.decide_approval(root, tid, req["id"], approve=True, actor="ceo")["status"] == "approved"


def test_learnings_dedupe_bound_and_rank_into_the_brief(root, team):
    tid = team["id"]
    bt.add_learning(root, tid, text="Always cite sources.", by="writer")
    again = bt.add_learning(root, tid, text="always cite sources", by="ceo")
    assert again["count"] == 2 and len(bt.get_team(root, tid)["learnings"]) == 1
    bt.add_learning(root, tid, text="Avoid em dashes", by="ceo")
    brief = bt.build_brief(bt.get_team(root, tid), "writer")
    assert brief.index("Always cite sources.") < brief.index("Avoid em dashes")
    assert "You report to ceo" in brief and "Reach 10k users" in brief


def test_brief_carries_goal_ancestry(root, team):
    tid = team["id"]
    a = bt.upsert_goal(root, tid, title="Grow blog")
    b = bt.upsert_goal(root, tid, title="Ship posts", parent_id=a["id"])
    assert "Reach 10k users → Grow blog → Ship posts" in bt.build_brief(
        bt.get_team(root, tid), "writer", goal_id=b["id"])


def test_pack_is_data_only_and_round_trips_as_open_seats(root, team):
    tid = team["id"]
    bt.record_spend(root, tid, "writer", 3)
    bt.add_learning(root, tid, text="secret-ish lesson", by="writer")
    pack = bt.export_pack(bt.get_team(root, tid))
    blob = json.dumps(pack)
    for leaked in ("writer", "ceo", tid, "secret-ish", "spent_usd"):
        assert leaked not in blob
    assert "WORDPRESS_TOKEN" in blob  # the credential NAME is part of the role kit; no value exists here

    clone = bt.import_pack(root, {**pack, "seats": [{**s, "profile": "evil", "token": "x"} for s in pack["seats"]]},
                           name="Growth v2")
    assert clone["id"] != tid and clone["name"] == "Growth v2"
    assert all(m["profile"] is None for m in clone["members"])
    assert sum(1 for m in clone["members"] if m["lead"]) == 1
    writer = next(m for m in clone["members"] if m["role"] == "Content")
    boss = next(m for m in clone["members"] if m["slot"] == writer["reports_to"])
    assert boss["role"] == "Chief of staff" and writer["budget"]["spent_usd"] == 0


def test_pack_import_rejects_foreign_versions(root):
    with pytest.raises(bt.TeamError):
        bt.import_pack(root, {"pack_version": 99, "seats": []})
    with pytest.raises(bt.TeamError):
        bt.import_pack(root, "not a pack")


def test_audit_is_append_only_and_survives_team_deletion(root, team):
    tid = team["id"]
    bt.upsert_goal(root, tid, title="g")
    before = bt.list_audit(root, tid)
    assert {"team.create", "member.add", "goal.add"} <= {e["action"] for e in before}
    assert all(e["actor"] for e in before)
    bt.delete_team(root, tid)
    with pytest.raises(bt.TeamNotFound):
        bt.get_team(root, tid)
    trail = (root / "bot-teams" / "audit" / f"{tid}.jsonl").read_text().splitlines()
    assert json.loads(trail[-1])["action"] == "team.delete" and len(trail) == len(before) + 1


def test_unknown_or_malformed_ids_are_not_found_not_path_traversal(root):
    for bad in ("../x", "", "a/b"):
        with pytest.raises(bt.TeamNotFound):
            bt.get_team(root, bad)
