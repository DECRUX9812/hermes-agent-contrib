"""``delegation.reports`` — settled report-back cards for the desktop attention fold.

Covers the durable feed (``settled_delegations_for_session``), report shaping
(``_report_for_row`` outcome/title/summary), the summary cache write-back, and the
``child_session_ids`` stamp ``_execute_and_aggregate`` adds for the card's open action.
"""

import json
import sqlite3
import time
from types import SimpleNamespace

import pytest

from tools import async_delegation as ad
from tools.delegate_tool_dispatch import _Batch, _execute_and_aggregate
from tui_gateway import methods_delegation_reports as mdr


@pytest.fixture(autouse=True)
def _clean_state(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    ad._reset_for_tests()
    yield
    ad._reset_for_tests()


def _seed(*, delegation_id="deleg_x", session_id="sess-1", state="completed",
          event=None, result=None, delivery_state=None):
    record = {"delegation_id": delegation_id, "goal": "scan the logs", "context": None,
              "toolsets": None, "role": "leaf", "model": "test", "session_key": session_id,
              "origin_ui_session_id": session_id, "parent_session_id": session_id,
              "origin_session_id": session_id, "dispatched_at": time.time() - 5}
    ad._persist_dispatch(record)
    ad._persist_completion(
        {"delegation_id": delegation_id, "status": state, "completed_at": time.time(),
         **(event or {})},
        result or {})
    if delivery_state:
        conn = sqlite3.connect(ad._db_path())
        try:
            conn.execute("UPDATE async_delegations SET delivery_state=? WHERE delegation_id=?",
                         (delivery_state, delegation_id))
            conn.commit()
        finally:
            conn.close()
    return delegation_id


def _row(delegation_id):
    conn = sqlite3.connect(ad._db_path())
    try:
        conn.row_factory = sqlite3.Row
        return dict(conn.execute("SELECT * FROM async_delegations WHERE delegation_id=?",
                                 (delegation_id,)).fetchone())
    finally:
        conn.close()


def test_settled_feed_scopes_to_session_and_drops_live_and_dropped():
    _seed(delegation_id="deleg_a", session_id="sess-1",
          event={"summary": "all good", "duration_seconds": 2.0},
          result={"summary": "all good"})
    _seed(delegation_id="deleg_b", session_id="sess-1", state="running")
    _seed(delegation_id="deleg_c", session_id="sess-1", delivery_state="dropped")
    _seed(delegation_id="deleg_d", session_id="sess-2")

    feed = ad.settled_delegations_for_session("sess-1")
    assert [r["delegation_id"] for r in feed] == ["deleg_a"]
    assert ad.settled_delegations_for_session("") == []


def test_report_for_single_done_row_carries_heuristic_snippet_and_child_ids():
    _seed(event={"goal": "scan the logs", "summary": "Found 3 slow queries\nDetails follow",
                 "duration_seconds": 4.0},
          result={"summary": "Found 3 slow queries\nDetails follow",
                  "child_session_ids": {"0": "child-sess-9"}})
    row = ad.settled_delegations_for_session("sess-1")[0]
    report = mdr._report_for_row(row)

    assert report["delegation_id"] == "deleg_x"
    assert report["outcome"] == "done"
    assert report["title"] == "scan the logs"
    # First substantive line only — the card stays one line before any model summary exists.
    assert report["summary"] == "Found 3 slow queries"
    assert report["summary_source"] == "heuristic"
    assert report["task_count"] == 1
    assert report["child_session_ids"] == {"0": "child-sess-9"}
    assert report["duration_seconds"] == 4.0


def test_report_outcome_classification():
    batch = _seed(event={
        "is_batch": True, "goal": "2 parallel subagents: a; b", "goals": ["a", "b"],
        "results": [{"task_index": 0, "status": "completed", "summary": "ok"},
                    {"task_index": 1, "status": "interrupted", "error": "stopped"}],
    }, result={"results": []})
    report = mdr._report_for_row(ad.settled_delegations_for_session("sess-1")[0])
    assert report["outcome"] == "needs_decision"
    assert report["task_count"] == 2 and report["completed_count"] == 1

    _seed(delegation_id="deleg_f", state="error",
          event={"goal": "boom", "status": "error", "error": "provider blew up"},
          result={"error": "provider blew up"})
    reports = {r["delegation_id"]: r for r in
               (mdr._report_for_row(r) for r in ad.settled_delegations_for_session("sess-1"))}
    assert reports["deleg_f"]["outcome"] == "failed"
    assert reports["deleg_f"]["summary"] == "provider blew up"

    _seed(delegation_id="deleg_t",
          event={"goal": "long job", "status": "completed", "truncated": True},
          result={})
    reports = {r["delegation_id"]: r for r in
               (mdr._report_for_row(r) for r in ad.settled_delegations_for_session("sess-1"))}
    assert reports["deleg_t"]["outcome"] == "needs_decision"


def test_model_summary_caches_into_result_json_and_wins_over_heuristic():
    _seed(event={"goal": "scan the logs", "summary": "raw snippet"},
          result={"summary": "raw snippet"})

    class _Resp:
        choices = [SimpleNamespace(message=SimpleNamespace(content="Scanned logs; flagged 3 slow queries\nextra line"))]

    import agent.auxiliary_client as aux
    monkey_called = []
    import agent.auxiliary_client
    orig = agent.auxiliary_client.call_llm
    agent.auxiliary_client.call_llm = lambda **kw: (monkey_called.append(kw), _Resp())[1]
    try:
        summary = mdr._generate_summary(ad.settled_delegations_for_session("sess-1")[0])
    finally:
        agent.auxiliary_client.call_llm = orig
    assert summary == "Scanned logs; flagged 3 slow queries"
    assert monkey_called and monkey_called[0]["task"] == "delegation_summary"

    ad.record_delegation_report_summary("deleg_x", summary)
    row = ad.settled_delegations_for_session("sess-1")[0]
    report = mdr._report_for_row(row)
    assert report["summary"] == summary
    assert report["summary_source"] == "model"
    assert json.loads(_row("deleg_x")["result_json"])["report_summary"] == summary


def test_missing_utility_model_never_breaks_the_card():
    _seed(event={"goal": "scan", "summary": "fallback text"}, result={})
    import agent.auxiliary_client

    def _boom(**_kw):
        raise RuntimeError("no auxiliary provider configured")

    orig = agent.auxiliary_client.call_llm
    agent.auxiliary_client.call_llm = _boom
    try:
        assert mdr._generate_summary(ad.settled_delegations_for_session("sess-1")[0]) == ""
    finally:
        agent.auxiliary_client.call_llm = orig
    report = mdr._report_for_row(ad.settled_delegations_for_session("sess-1")[0])
    assert report["summary"] == "fallback text"
    assert report["summary_source"] == "heuristic"


def test_execute_and_aggregate_stamps_child_session_ids(monkeypatch):
    parent = SimpleNamespace(_delegate_spinner=None, quiet_mode=True)
    children = [SimpleNamespace(session_id="child-sess-9", _delegate_role="leaf")]
    tasks = [{"goal": "task 0"}]
    batch = _Batch(
        task_list=tasks, children=[(0, tasks[0], children[0])],
        parent_agent=parent, creds={}, context=None, top_role="leaf",
        max_children=1, live_deleg_id=None, live_writers=[None], live_paths=[],
        origin_wake_sid="", origin_ui_session_id="", origin_owner_transport=None,
        origin_owner_session_record=None, origin_session_history_delivery=False,
        overall_start=time.monotonic())
    batch.run_child = lambda i, task, child: {
        "task_index": i, "status": "completed", "summary": "done", "api_calls": 1,
        "duration_seconds": 0.1}
    monkeypatch.setattr("tools.delegate_tool_dispatch._finalize_child_results", lambda *a, **k: None)

    combined = _execute_and_aggregate(batch)
    assert combined["child_session_ids"] == {"0": "child-sess-9"}
    assert combined["results"][0]["summary"] == "done"


def test_reports_rpc_round_trip(monkeypatch):
    from tui_gateway import server

    _seed(event={"goal": "scan the logs", "summary": "Found 3 slow queries"},
          result={"summary": "Found 3 slow queries", "child_session_ids": {"0": "child-sess-9"}})
    monkeypatch.setattr(server, "_summary_enabled", lambda: False)
    frame = server.dispatch(
        {"id": 1, "method": "delegation.reports", "params": {"session_id": "sess-1"}},
        transport=SimpleNamespace(write=lambda f: True))
    reports = frame["result"]["reports"]
    assert len(reports) == 1
    assert reports[0]["delegation_id"] == "deleg_x"
    assert reports[0]["outcome"] == "done"
    assert reports[0]["child_session_ids"] == {"0": "child-sess-9"}
