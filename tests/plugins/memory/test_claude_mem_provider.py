"""claude-mem provider: loads through real discovery, recalls through the worker, and degrades
without crashing the turn when the worker is down (the breaker then stops calling it)."""

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


class _Worker(BaseHTTPRequestHandler):
    observations: list = []

    def _json(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/health"):
            self._json({"status": "ok"})
        elif self.path.startswith("/api/search"):
            self._json({"results": [{"text": "the user prefers tabs"}]})
        else:
            self._json({"context": ""})

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])) or b"{}")
        if self.path == "/api/sessions/init":
            self._json({"session_id": "w-1"})
        else:
            type(self).observations.append(payload)
            self._json({"ok": True})

    def log_message(self, *args):
        pass


@pytest.fixture
def worker():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Worker)
    _Worker.observations = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server.server_address[1]
    server.shutdown()
    server.server_close()


def _closed_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _provider(tmp_path, monkeypatch, port: int):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "claude-mem.json").write_text(
        json.dumps({"host": "127.0.0.1", "port": port}), encoding="utf-8-sig")
    from plugins.memory import load_memory_provider

    provider = load_memory_provider("claude-mem")
    assert provider is not None
    provider.initialize("s-1", hermes_home=str(tmp_path))
    return provider


def test_recall_and_remember_go_through_the_worker(tmp_path, monkeypatch, worker):
    provider = _provider(tmp_path, monkeypatch, worker)

    assert "the user prefers tabs" in provider.prefetch("tabs or spaces?")
    found = json.loads(provider.handle_tool_call("claudemem_search", {"query": "tabs"}))
    assert found["count"] == 1
    assert json.loads(provider.handle_tool_call("claudemem_remember", {"content": "ship on Fridays"})) == {
        "result": "Remembered."}
    assert any("ship on Fridays" in o.get("text", "") for o in _Worker.observations)


def test_a_dead_worker_degrades_and_trips_the_breaker(tmp_path, monkeypatch):
    provider = _provider(tmp_path, monkeypatch, _closed_port())

    assert "error" in json.loads(provider.handle_tool_call("claudemem_search", {"query": "x"}))
    for _ in range(3):
        assert provider.prefetch("anything") == ""
    assert provider._breaker_open()
