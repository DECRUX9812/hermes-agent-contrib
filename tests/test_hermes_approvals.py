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
    monkeypatch.setattr(journal, "get_db_path", lambda home=None: temp_home / "state.db")
    
    journal.record_request("req-3", session_id="sess-3", tool_call_id="tc-3", tool_name="bash", command="whoami", description="check user", home=temp_home)
    
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
