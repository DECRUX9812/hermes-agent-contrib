"""Durable, idempotent gateway approvals: the profile journal behind ``fork.approvals.*``.

A request is journaled before it is sent, one answer decides it and a second answer resolves nothing,
a request whose owning process died is expired on the next journal open, a tool call that already ran
is refused before it is queued, and the stored command is the redacted one.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import threading
from types import SimpleNamespace

import pytest

import hermes_yaml as yaml
from hermes_state import SessionDB
import hermes_state_fork_approvals as fork_store
from hermes_state_pidns import pid_namespace_id
from tools import approval as approval_mod
from tools import approval_context, approval_journal
from tools.approval_gateway_wait import _ApprovalEntry, _await_gateway_decision
from tui_gateway import server, server_requests

SESSION_KEY = "20260909_120000_forkkey"
STORED_ID = "20260909_120000_forkstored"
SID = "live-fork-approvals"
COMMAND = "rm -rf /tmp/scratch"
SECRET = "ghp_" + "a" * 36


@pytest.fixture(autouse=True)
def _fresh_sweep(monkeypatch):
    monkeypatch.setattr(approval_journal, "_swept_paths", set())


@pytest.fixture()
def queued(monkeypatch):
    """Put one entry in the gateway queue for SESSION_KEY; returns a factory keyed by request id."""
    made = []

    def _make(request_id: str) -> _ApprovalEntry:
        entry = _ApprovalEntry({"command": COMMAND, "request_id": request_id, "pattern_keys": ["k"]})
        entry.journaled = approval_journal.get_approval(request_id) is not None
        approval_mod._gateway_queues.setdefault(SESSION_KEY, []).append(entry)
        made.append(entry)
        return entry

    yield _make
    approval_mod._gateway_queues.pop(SESSION_KEY, None)


@pytest.fixture()
def live_session(monkeypatch):
    monkeypatch.setitem(server._sessions, SID, {
        "session_key": SESSION_KEY, "agent": SimpleNamespace(session_id=STORED_ID),
    })
    return SID


def _record(request_id: str, *, tool_call_id: str = "call-1", command: str = COMMAND) -> None:
    approval_journal.record_request(request_id, session_id=STORED_ID, tool_call_id=tool_call_id,
                                    tool_name="terminal", command=command, description="cleanup")


def _dead_owner() -> str:
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()
    return json.dumps({"pid": proc.pid, "pidns": pid_namespace_id(), "start_ticks": None}, sort_keys=True)


def _record_owned_by(owner: str, request_id: str, *, tool_call_id: str = "call-1") -> None:
    original = fork_store._owner_record
    fork_store._owner_record = lambda: owner
    try:
        _record(request_id, tool_call_id=tool_call_id)
    finally:
        fork_store._owner_record = original


def _restart() -> None:
    """A new backend process: the once-per-process journal sweep runs again on its next open."""
    approval_journal._swept_paths.clear()


def _row(request_id: str) -> dict:
    return approval_journal.get_approval(request_id)


def _rpc(method: str, params: dict) -> dict:
    return server.handle_request({"id": "test-rpc", "method": method, "params": params})


def test_one_answer_decides_the_request_and_a_second_resolves_nothing(queued):
    _record("req-once")
    entry = queued("req-once")

    assert approval_mod.resolve_gateway_approval(SESSION_KEY, "once", request_id="req-once") == 1
    assert entry.result == "once"
    assert entry.event.is_set()
    assert _row("req-once")["status"] == "allowed"
    assert _row("req-once")["choice"] == "once"

    assert approval_mod.resolve_gateway_approval(SESSION_KEY, "deny", request_id="req-once") == 0
    assert _row("req-once")["status"] == "allowed"
    assert _row("req-once")["choice"] == "once"


def test_decide_rpc_keeps_the_first_answer(live_session, queued):
    _record("req-rpc")
    queued("req-rpc")

    first = _rpc("fork.approvals.decide", {
        "session_id": STORED_ID, "request_id": "req-rpc", "choice": "deny"})
    second = _rpc("fork.approvals.decide", {
        "session_id": STORED_ID, "request_id": "req-rpc", "choice": "once"})

    assert first["result"]["resolved"] == 1
    assert first["result"]["approval"]["status"] == "denied"
    assert second["result"]["resolved"] == 0
    assert second["result"]["approval"]["status"] == "denied"
    assert second["result"]["approval"]["choice"] == "deny"


def test_list_rpc_returns_the_session_journal(live_session):
    _record("req-listed")

    listed = _rpc("fork.approvals.list", {"session_id": STORED_ID})

    [row] = listed["result"]["approvals"]
    assert row["request_id"] == "req-listed"
    assert row["status"] == "pending"
    assert row["tool_name"] == "terminal"


def test_decide_rpc_rejects_an_unknown_request(live_session):
    response = _rpc("fork.approvals.decide", {
        "session_id": STORED_ID, "request_id": "req-missing", "choice": "once"})

    assert response["error"]["code"] == 4004


def test_orphan_of_a_dead_backend_expires_and_cannot_be_decided(live_session):
    _record_owned_by(_dead_owner(), "req-orphan")
    _record("req-live")

    _restart()
    approval_journal.approvals_for_session(STORED_ID)

    assert _row("req-orphan")["status"] == "expired"
    assert _row("req-orphan")["reason"] == approval_journal.RESTART_REASON
    assert _row("req-live")["status"] == "pending"
    response = _rpc("fork.approvals.decide", {
        "session_id": STORED_ID, "request_id": "req-orphan", "choice": "once"})
    assert response["result"]["resolved"] is False
    assert response["result"]["approval"]["status"] == "expired"


def test_allowed_call_whose_process_died_mid_run_is_not_run_again():
    _record_owned_by(_dead_owner(), "req-midrun", tool_call_id="call-midrun")
    assert approval_journal.record_decision("req-midrun", "once")[1] is True

    _restart()
    approval_journal.approvals_for_session(STORED_ID)

    assert _row("req-midrun")["status"] == "allowed"
    assert _row("req-midrun")["reason"] == approval_journal.RAN_BEFORE_RESTART_REASON
    assert approval_journal.already_ran("call-midrun") is True


def test_a_tool_call_that_already_ran_is_refused_before_it_is_queued(queued, live_session, monkeypatch):
    _record("req-ran", tool_call_id="call-ran")
    queued("req-ran")
    approval_mod.resolve_gateway_approval(SESSION_KEY, "once", request_id="req-ran")
    server._sessions[SID].setdefault("journaled_approval_tool_calls", set()).add("call-ran")
    monkeypatch.setattr(server, "_emit_tool_lifecycle", lambda *_args, **_kwargs: None)
    server._on_tool_complete(SID, "call-ran", "terminal", {}, "{}")
    assert _row("req-ran")["ran_at"] is not None
    notified = []
    token = approval_context._approval_tool_call_id.set("call-ran")
    try:
        decision = _await_gateway_decision(
            SESSION_KEY, notified.append,
            {"command": COMMAND, "pattern_key": "k", "pattern_keys": ["k"], "description": "cleanup"})
    finally:
        approval_context._approval_tool_call_id.reset(token)

    assert decision == {"resolved": False, "choice": None, "already_ran": True}
    assert notified == []
    assert not approval_mod._gateway_queues.get(SESSION_KEY)


def test_an_approved_call_that_has_not_run_yet_is_not_refused_for_a_second_gate(queued):
    _record("req-gate-1", tool_call_id="call-gates")
    queued("req-gate-1")
    approval_mod.resolve_gateway_approval(SESSION_KEY, "once", request_id="req-gate-1")

    assert approval_journal.already_ran("call-gates") is False


def test_stored_command_is_the_redacted_one(monkeypatch, live_session):
    def send_async(_method, _sid, _payload, _on_result, *, before_send=None):
        assert before_send is None or before_send() is not False
        return lambda _reason: None

    monkeypatch.setattr(server_requests, "send_async", send_async)
    data = {"command": f"curl -H 'Authorization: token {SECRET}' https://example.test",
            "description": "fetch", "pattern_key": "k", "pattern_keys": ["k"], "request_id": "req-redacted"}

    server._emit_approval_request(SID, data)

    stored = _row("req-redacted")["command"]
    assert SECRET not in stored
    assert stored == server._approval_request_payload(data)["command"]


def test_emitter_answer_is_journaled_before_the_queue_and_duplicate_is_ignored(
        monkeypatch, live_session, queued):
    entry = queued("req-emitter")
    callbacks = []

    def send_async(_method, _sid, _payload, on_result, *, before_send=None):
        assert before_send is None or before_send() is not False
        assert _row("req-emitter")["status"] == "pending"
        callbacks.append(on_result)
        return lambda _reason: None

    monkeypatch.setattr(server_requests, "send_async", send_async)
    server._emit_approval_request(SID, {
        "command": COMMAND, "description": "cleanup", "request_id": "req-emitter",
    })

    assert _row("req-emitter")["status"] == "pending"
    callbacks[0]({"choice": "once"})
    first_row = _row("req-emitter")
    callbacks[0]({"choice": "deny"})

    assert entry.result == "once"
    assert entry.event.is_set()
    assert first_row["status"] == "allowed"
    assert first_row["choice"] == "once"
    assert _row("req-emitter") == first_row


def test_client_all_answer_resolves_and_journals_every_queued_entry(monkeypatch, live_session, queued):
    _record("req-all-first", tool_call_id="call-all-first")
    _record("req-all-second", tool_call_id="call-all-second")
    first = queued("req-all-first")
    second = queued("req-all-second")

    def send_async(_method, _sid, _payload, on_result, *, before_send=None):
        assert before_send is None or before_send() is not False
        on_result({"choice": "once", "all": True})
        return lambda _reason: None

    monkeypatch.setattr(server_requests, "send_async", send_async)
    server._emit_approval_request(SID, {
        "command": COMMAND, "description": "cleanup", "request_id": "req-all-first",
    })

    assert first.result == second.result == "once"
    assert first.event.is_set() and second.event.is_set()
    for request_id in ("req-all-first", "req-all-second"):
        row = _row(request_id)
        assert row["status"] == "allowed"
        assert row["choice"] == "once"


def test_tool_completion_without_journaled_approval_does_not_open_journal(monkeypatch, live_session):
    monkeypatch.setattr(
        approval_journal, "_journal",
        lambda *_args, **_kwargs: pytest.fail("tool completion opened the approval journal"),
    )
    monkeypatch.setattr(server, "_emit_tool_lifecycle", lambda *_args, **_kwargs: None)

    server._on_tool_complete(SID, "call-no-approval", "terminal", {}, "{}")


def test_unavailable_journal_falls_back_to_in_memory_approval(monkeypatch, live_session):
    entry = _ApprovalEntry({"command": COMMAND, "request_id": "req-unavailable"})
    approval_mod._gateway_queues.setdefault(SESSION_KEY, []).append(entry)
    monkeypatch.setattr(
        approval_journal, "_journal",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("state store unavailable")),
    )

    def send_async(_method, _sid, _payload, on_result, *, before_send=None):
        assert before_send is None or before_send() is not False
        on_result({"choice": "once"})
        return lambda _reason: None

    monkeypatch.setattr(server_requests, "send_async", send_async)
    server._emit_approval_request(SID, {
        "command": COMMAND, "description": "cleanup", "request_id": "req-unavailable",
    })

    assert entry.result == "once"
    assert entry.event.is_set()


def test_opening_an_existing_database_creates_the_new_table(tmp_path):
    path = tmp_path / "state.db"
    db = SessionDB(db_path=path)
    db.close()

    with sqlite3.connect(path) as conn:
        conn.execute("DROP TABLE fork_approvals")

    reopened = SessionDB(db_path=path)
    try:
        assert reopened.list_fork_approvals("stored-session") == []
    finally:
        reopened.close()


def test_always_decision_uses_secondary_profile_journal_and_allowlist(monkeypatch):
    launch_home = server.get_hermes_home()
    secondary_home = launch_home / "profiles" / "worker"
    secondary_home.mkdir(parents=True)
    secondary_config = secondary_home / "config.yaml"
    secondary_config.write_text("command_allowlist: []\n", encoding="utf-8")
    approval_journal.approvals_for_session("startup-probe", home=secondary_home)
    launch_config = launch_home / "config.yaml"
    launch_config_before = launch_config.read_bytes() if launch_config.exists() else None
    monkeypatch.setattr(server, "_profile_home", lambda profile: secondary_home if profile == "worker" else None)
    monkeypatch.setattr(approval_mod, "_is_interactive_cli", lambda: False)
    monkeypatch.setattr(approval_mod, "_is_gateway_approval_context", lambda: True)
    monkeypatch.setattr(approval_mod, "is_approved", lambda *_args: False)
    monkeypatch.setitem(server._sessions, SID, {
        "session_key": SESSION_KEY,
        "agent": SimpleNamespace(session_id=STORED_ID),
        "profile_home": str(secondary_home),
        "tool_names": {"call-secondary": "terminal"},
    })

    request_ready = threading.Event()
    request_frame = {}

    def send_async(method, sid, payload, on_result, *, before_send=None):
        assert before_send is None or before_send() is not False
        request_frame.update(method=method, sid=sid, payload=payload, on_result=on_result)
        request_ready.set()
        return lambda _reason: None

    monkeypatch.setattr(server_requests, "send_async", send_async)
    approval_mod.register_gateway_notify(SESSION_KEY, lambda data: server._emit_approval_request(SID, data))
    outcome = []
    finished = threading.Event()

    def run_gate():
        try:
            with server._session_profile_runtime_scope(
                    {"profile_home": str(secondary_home)}, hydrate_secrets=False):
                session_token = approval_context.set_current_session_key(SESSION_KEY)
                call_token = approval_context._approval_tool_call_id.set("call-secondary")
                try:
                    outcome.append(approval_mod.request_tool_approval(
                        "terminal", "secondary-only operation", rule_key="n4-secondary"))
                finally:
                    approval_context._approval_tool_call_id.reset(call_token)
                    approval_context.reset_current_session_key(session_token)
        except Exception as exc:
            outcome.append(exc)
        finally:
            finished.set()

    worker = threading.Thread(target=run_gate, daemon=True)
    worker.start()
    try:
        assert request_ready.wait(timeout=8), "approval request was not emitted"
        environment_before = dict(os.environ)
        response = _rpc("fork.approvals.decide", {
                "session_id": STORED_ID, "request_id": request_frame["payload"]["request_id"],
                "choice": "always", "profile": "worker",
            })
        assert response["result"]["resolved"] is True
        assert finished.wait(timeout=8), "approval waiter did not finish"
    finally:
        approval_mod.unregister_gateway_notify(SESSION_KEY)
        worker.join(timeout=1)

    assert outcome and not isinstance(outcome[0], Exception)
    assert outcome[0]["approved"] is True
    stored = approval_journal.get_approval(request_frame["payload"]["request_id"], home=secondary_home)
    assert stored["choice"] == "always"
    assert stored["status"] == "allowed"
    secondary_allowlist = yaml.safe_load(secondary_config.read_text(encoding="utf-8"))["command_allowlist"]
    assert "plugin_rule:n4-secondary" in secondary_allowlist
    assert approval_journal.get_approval(request_frame["payload"]["request_id"], home=launch_home) is None
    assert (launch_config.read_bytes() if launch_config.exists() else None) == launch_config_before
    assert dict(os.environ) == environment_before
