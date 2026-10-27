import importlib.util
import sys
import types
from pathlib import Path
import pytest
import sqlite3
import tempfile

PLUGIN = Path(__file__).resolve().parents[1] / "plugins" / "hermes-approvals"

def _load():
    name = "hermes_plugins.hermes_approvals"
    if name in sys.modules:
        return sys.modules[name]
    sys.modules.setdefault("hermes_plugins", types.ModuleType("hermes_plugins")).__path__ = []
    spec = importlib.util.spec_from_file_location(name, PLUGIN / "__init__.py", submodule_search_locations=[str(PLUGIN)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

mod = _load()
journal = mod.journal
rpc = mod.rpc

@pytest.fixture
def temp_home():
    with tempfile.TemporaryDirectory() as td:
        yield Path(td)

def test_journal_schema_and_record(temp_home):
    req = journal.record_request(
        "req-1",
        session_id="sess-1",
        tool_call_id="tc-1",
        tool_name="bash",
        command="ls -la",
        description="list files",
        home=temp_home
    )
    assert req["request_id"] == "req-1"
    assert req["status"] == "pending"
    assert req["command"] == "ls -la"
    
    # Verify retrieval
    got = journal.get_approval("req-1", home=temp_home)
    assert got is not None
    assert got["tool_call_id"] == "tc-1"
    
    # List approvals
    listed = journal.list_approvals("sess-1", home=temp_home)
    assert len(listed) == 1
    assert listed[0]["request_id"] == "req-1"

def test_journal_decide(temp_home):
    journal.record_request("req-2", session_id="sess-2", tool_call_id="tc-2", tool_name="write", command="foo.txt", description="write file", home=temp_home)
    
    decided, won = journal.decide_approval("req-2", "allow_once", home=temp_home)
    assert won is True
    assert decided is not None
    assert decided["status"] == "allowed"
    assert decided["choice"] == "once"
    assert decided["decided_at"] is not None

def test_rpc_handlers(temp_home, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(temp_home))
    journal.reset_sweep()

    journal.record_request("req-3", session_id="sess-3", tool_call_id="tc-3", tool_name="bash", command="whoami", description="check user")
    assert journal.get_db_path() == temp_home / "plugin-data" / "hermes-approvals" / "data.db"
    
    # Test handle_list
    list_res = rpc.handle_list(1, {"session_id": "sess-3"})
    assert list_res["result"]["approvals"][0]["request_id"] == "req-3"
    
    # Test handle_decide
    dec_res = rpc.handle_decide(2, {"session_id": "sess-3", "request_id": "req-3", "choice": "deny"})
    assert dec_res["result"]["approval"]["status"] == "denied"
    assert dec_res["result"]["approval"]["choice"] == "deny"

def test_registration_seam():
    class FakeServer:
        def __init__(self):
            self.methods = {}
        def register_method(self, name, fn):
            self.methods[name] = fn

    server = FakeServer()
    names = rpc.install(server)
    assert "fork.approvals.list" in names
    assert "fork.approvals.decide" in names
    assert "fork.approvals.list" in server.methods
    assert "fork.approvals.decide" in server.methods


hooks = mod.hooks


@pytest.fixture
def home_env(temp_home, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(temp_home))
    journal.reset_sweep()
    return temp_home


def test_hooks_journal_a_prompt_its_answer_and_the_run(home_env):
    hooks.HOOKS["pre_tool_call"](tool_name="terminal", args={}, tool_call_id="tc-h1", session_id="s-h")
    hooks.HOOKS["pre_approval_request"](request_id="rq-h1", command="rm -rf build", description="delete",
                                        session_key="k-h", session_id="s-h", tool_call_id="tc-h1")
    row = journal.get_approval("rq-h1")
    assert row["status"] == "pending" and row["tool_name"] == "terminal" and row["session_id"] == "s-h"

    hooks.HOOKS["post_approval_response"](request_id="rq-h1", choice="once", session_key="k-h")
    assert journal.get_approval("rq-h1")["status"] == "allowed"

    hooks.HOOKS["post_tool_call"](tool_name="terminal", tool_call_id="tc-h1", result="ok")
    assert journal.get_approval("rq-h1")["ran_at"] is not None
    blocked = hooks.HOOKS["pre_tool_call"](tool_name="terminal", args={}, tool_call_id="tc-h1")
    assert blocked == {"action": "block", "message": journal.ALREADY_RAN_REASON}


def test_hooks_answer_once_and_record_an_interrupt_as_a_deny(home_env):
    hooks.HOOKS["pre_approval_request"](request_id="rq-h2", command="x", session_key="k", session_id="s")
    journal.decide_approval("rq-h2", "deny")
    hooks.HOOKS["post_approval_response"](request_id="rq-h2", choice="once", session_key="k")
    assert journal.get_approval("rq-h2")["choice"] == "deny"

    hooks.HOOKS["pre_approval_request"](request_id="rq-h3", command="y", session_key="k", session_id="s")
    hooks.HOOKS["post_approval_response"](request_id="rq-h3", choice="cancelled", cancelled="interrupt")
    row = journal.get_approval("rq-h3")
    assert row["status"] == "denied" and row["reason"] == journal.SESSION_STOPPED_REASON
    assert row["choice"] is None and row["decided_at"]

    hooks.HOOKS["pre_approval_request"](request_id="rq-h5", command="v", session_key="k", session_id="s")
    hooks.HOOKS["post_approval_response"](request_id="rq-h5", choice="timeout")
    assert journal.get_approval("rq-h5")["status"] == "withdrawn"


def test_hooks_skip_coalesced_followers_and_prompts_without_ids(home_env):
    hooks.HOOKS["pre_approval_request"](request_id="rq-h4", command="z", session_key="k", coalesced=True)
    hooks.HOOKS["pre_approval_request"](command="z", session_key="k")
    assert journal.get_approval("rq-h4") is None
    assert hooks.HOOKS["pre_tool_call"](tool_name="t", args={}, tool_call_id="") is None


def test_migrates_rows_an_older_core_wrote_to_state_db(home_env):
    conn = sqlite3.connect(str(home_env / "state.db"))
    journal.ensure_schema(conn)
    conn.execute("INSERT INTO fork_approvals (request_id, session_id, created_at, status, owner) "
                 "VALUES ('old-1', 's-old', 1.0, 'denied', NULL)")
    conn.commit()
    conn.close()
    assert journal.list_approvals("s-old")[0]["request_id"] == "old-1"


def test_hooks_install_registers_the_stock_hooks():
    seen = []

    class Ctx:
        def register_hook(self, name, fn):
            seen.append(name)

    assert hooks.install(Ctx()) == seen
    assert set(seen) == {"pre_approval_request", "post_approval_response", "pre_tool_call", "post_tool_call"}


def test_decide_answers_a_waiting_prompt_under_its_hook_queue_key(home_env, monkeypatch):
    from tools import approval as stock
    calls = []

    def fake_resolve(session_key, choice, request_id=None, **_kw):
        calls.append((session_key, choice, request_id))
        return 1

    monkeypatch.setattr(stock, "resolve_gateway_approval", fake_resolve)
    hooks.HOOKS["pre_approval_request"](request_id="rq-l1", command="w", session_key="agent:main:k1", session_id="s-l")
    out = rpc.handle_decide(1, {"session_id": "s-l", "request_id": "rq-l1", "choice": "once"})["result"]
    assert calls == [("agent:main:k1", "once", "rq-l1")]
    assert out["resolved"] is True and out["approval"]["status"] == "allowed"


def test_decide_does_not_allow_a_prompt_that_settled_before_the_answer(home_env, monkeypatch):
    from tools import approval as stock
    monkeypatch.setattr(stock, "resolve_gateway_approval", lambda *a, **k: 0)
    hooks.HOOKS["pre_approval_request"](request_id="rq-l2", command="w", session_key="k2", session_id="s-l")
    out = rpc.handle_decide(1, {"session_id": "s-l", "request_id": "rq-l2", "choice": "once"})["result"]
    assert out["resolved"] is False and out["approval"]["status"] == "pending"

    hooks.HOOKS["post_approval_response"](request_id="rq-l2", choice="timeout")
    assert hooks.live_session_key("rq-l2") == ""
    out = rpc.handle_decide(1, {"session_id": "s-l", "request_id": "rq-l2", "choice": "once"})["result"]
    assert out["approval"]["status"] == "withdrawn"


def _fresh_copy(name):
    """Import the plugin again the way a second plugin manager does: evict, then re-execute."""
    for key in [k for k in sys.modules if k == name or k.startswith(name + ".")]:
        sys.modules.pop(key)
    spec = importlib.util.spec_from_file_location(name, PLUGIN / "__init__.py", submodule_search_locations=[str(PLUGIN)])
    copy = importlib.util.module_from_spec(spec)
    sys.modules[name] = copy
    spec.loader.exec_module(copy)
    return copy


def test_a_reloaded_copy_shares_state_and_registers_once(home_env, monkeypatch):
    from tools import approval as stock
    calls = []
    monkeypatch.setattr(stock, "resolve_gateway_approval",
                        lambda key, choice, request_id=None, **_k: calls.append((key, request_id)) or 1)
    saved = {k: v for k, v in sys.modules.items() if k.startswith("hermes_plugins.hermes_approvals")}
    try:
        first = _fresh_copy("hermes_plugins.hermes_approvals_copy_a")
        second = _fresh_copy("hermes_plugins.hermes_approvals_copy_b")
        assert first.hooks is not second.hooks
        assert first.hooks._live_keys is second.hooks._live_keys
        assert first.journal._swept_paths is second.journal._swept_paths

        methods = {}

        class Server:
            def register_method(self, name, fn):
                methods[name] = fn

        server = Server()
        assert first.rpc.install(server) == ["fork.approvals.list", "fork.approvals.decide"]
        assert second.rpc.install(server) == []
        assert sorted(methods) == ["fork.approvals.decide", "fork.approvals.list"]

        # The prompt is seen by the first copy's hook, answered through the second copy's method.
        first.hooks.HOOKS["pre_approval_request"](request_id="rq-c1", command="w", session_key="key-c", session_id="s-c")
        out = methods["fork.approvals.decide"](1, {"session_id": "s-c", "request_id": "rq-c1", "choice": "once"})["result"]
        assert calls == [("key-c", "rq-c1")] and out["resolved"] is True
    finally:
        for key in [k for k in sys.modules if k.startswith("hermes_plugins.hermes_approvals_copy_")]:
            sys.modules.pop(key)
        sys.modules.update(saved)
