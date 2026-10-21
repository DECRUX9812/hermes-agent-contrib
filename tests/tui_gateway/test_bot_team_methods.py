"""bots_team.* JSON-RPC handlers driven through the real dispatch table (server._methods), so
the handler rebinding onto server globals is exercised — the failure mode that broke
bots_mailbox.* once (a NameError on a module helper at call time)."""

from __future__ import annotations

import pytest

import tui_gateway.server as srv


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    h = tmp_path / ".hermes"
    h.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(h))
    return h


def call(method, **params):
    return srv._methods[f"bots_team.{method}"](1, params)


def ok(resp):
    assert "result" in resp, resp
    return resp["result"]


def test_full_team_lifecycle_over_rpc():
    view = ok(call("create", name="Growth", mission="Reach 10k users"))
    tid = view["team"]["id"]
    ceo = ok(call("member.upsert", team_id=tid, profile="ceo", role="Chief", lead=True))["member"]
    ok(call("member.upsert", team_id=tid, profile="writer", role="Content", reports_to=ceo["slot"], monthly_usd=5))
    goal = ok(call("goal.upsert", team_id=tid, title="Grow blog", owner="writer"))["goal"]
    linked = ok(call("goal.link_task", team_id=tid, goal_id=goal["id"], task_id="t1"))
    assert linked["rollup"]["goals"][goal["id"]]["total"] == 1

    view = ok(call("get", team_id=tid))
    assert [n["profile"] for n in view["tree"]] == ["ceo"]
    assert [c["profile"] for c in view["tree"][0]["reports"]] == ["writer"]

    req = ok(call("approval.request", team_id=tid, kind="spend", subject="ads", requested_by="writer"))["approval"]
    denied = call("approval.decide", team_id=tid, approval_id=req["id"], approve=True, actor="writer")
    assert denied["error"]["code"] == 4110
    decided = ok(call("approval.decide", team_id=tid, approval_id=req["id"], approve=True))
    assert decided["approval"]["status"] == "approved"

    assert ok(call("budget.record", team_id=tid, member="writer", usd=5))["allowed"] is False
    assert "Reach 10k users" in ok(call("brief", team_id=tid, member="writer", goal_id=goal["id"]))["brief"]
    assert ok(call("audit.list", team_id=tid))["entries"][0]["action"]
    assert ok(call("list"))["teams"][0]["member_count"] == 2


def test_domain_errors_are_4xx_not_crashes():
    assert call("get", team_id="team_nope")["error"]["code"] == 4111
    assert call("get")["error"]["code"] == 4110  # missing team_id
    assert call("create", name="  ")["error"]["code"] == 4110


def test_pack_export_import_over_rpc():
    tid = ok(call("create", name="A", mission="m"))["team"]["id"]
    ok(call("member.upsert", team_id=tid, profile="p", role="R", lead=True))
    pack = ok(call("pack.export", team_id=tid))["pack"]
    clone = ok(call("pack.import", pack=pack, name="B"))
    assert clone["team"]["name"] == "B" and clone["team"]["members"][0]["profile"] is None


def test_every_method_is_registered_and_contracted():
    from tui_gateway.contracts import METHODS

    declared = {m for m in METHODS if m.startswith("bots_team.")}
    assert declared and declared <= set(srv._methods)
