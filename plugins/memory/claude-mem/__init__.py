"""claude-mem memory provider for Hermes — MemoryProvider interface.

Local-first persistent memory via the claude-mem worker service
(SQLite + FTS5 + Chroma vector search). No cloud, no API keys, no paid tier.

The worker must be running: `npx claude-mem start` (default port 37700).
Configure via $HERMES_HOME/claude-mem.json or env vars:
  CLAUDE_MEM_WORKER_HOST (default 127.0.0.1)
  CLAUDE_MEM_WORKER_PORT (default 37700)
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
import urllib.parse
from contextlib import suppress
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_DEFAULT_HOST = "127.0.0.1"
_DEFAULT_PORT = 37700
_PREFETCH_WAIT_SECS = 3.0
_SYNC_MSG_MAX_CHARS = 8000
_BREAKER_THRESHOLD = 3
_BREAKER_COOLDOWN_SECS = 60

_PROMPT_BODY = """You have persistent memory across sessions. Relevant memories are injected automatically.
Use the `claudemem_search` tool to recall past work, decisions, and context when helpful.
Use `claudemem_remember` to store facts worth keeping (user preferences, project decisions, gotchas)."""

TOOL_SCHEMAS = [
    {
        "name": "claudemem_search",
        "description": "Search persistent memory for past observations, decisions, and context.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to search for"},
                "top_k": {"type": "integer", "description": "Max results (1-20)", "default": 5},
            },
            "required": ["query"],
        },
    },
    {
        "name": "claudemem_remember",
        "description": "Store a fact worth remembering across sessions.",
        "parameters": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "The fact to remember"},
            },
            "required": ["content"],
        },
    },
]


def _load_config(hermes_home: Optional[str] = None) -> dict:
    import os
    cfg: dict = {}
    if hermes_home:
        p = Path(hermes_home) / "claude-mem.json"
        if p.exists():
            try:
                cfg = json.loads(p.read_text())
            except Exception:
                pass
    cfg.setdefault("host", os.environ.get("CLAUDE_MEM_WORKER_HOST", _DEFAULT_HOST))
    cfg.setdefault("port", int(os.environ.get("CLAUDE_MEM_WORKER_PORT", _DEFAULT_PORT)))
    return cfg


class ClaudeMemBackend:
    """Thin HTTP client for the claude-mem worker API."""

    def __init__(self, host: str, port: int):
        self.base = f"http://{host}:{port}"
        self._session_id: Optional[str] = None

    def _req(self, method: str, path: str, data: Optional[dict] = None) -> Any:
        url = self.base + path
        body = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(url, data=body, method=method,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())

    def health(self) -> bool:
        try:
            r = self._req("GET", "/api/health")
            return r.get("status") == "ok"
        except Exception:
            return False

    def init_session(self, prompt: str = "") -> Optional[str]:
        try:
            r = self._req("POST", "/api/sessions/init", {"prompt": prompt})
            self._session_id = r.get("session_id") or r.get("id")
            return self._session_id
        except Exception as e:
            logger.debug("claude-mem init_session failed: %s", e)
            return None

    def add_observation(self, text: str) -> None:
        if not self._session_id:
            return
        try:
            self._req("POST", "/api/sessions/observations",
                      {"session_id": self._session_id, "text": text[:_SYNC_MSG_MAX_CHARS]})
        except Exception as e:
            logger.debug("claude-mem add_observation failed: %s", e)

    def search(self, query: str, top_k: int = 5) -> list:
        try:
            r = self._req("GET", "/api/search?" + urllib.parse.urlencode(
                {"q": query, "limit": top_k}))
            if isinstance(r, dict):
                return r.get("results", []) or r.get("observations", [])
            return r if isinstance(r, list) else []
        except Exception as e:
            logger.debug("claude-mem search failed: %s", e)
            return []

    def inject_context(self) -> str:
        try:
            r = self._req("GET", "/api/context/inject")
            if isinstance(r, dict):
                return r.get("context", "") or r.get("text", "")
            return str(r)
        except Exception as e:
            logger.debug("claude-mem inject_context failed: %s", e)
            return ""


class ClaudeMemProvider:
    """Hermes MemoryProvider backed by the local claude-mem worker."""

    def __init__(self):
        self._config: dict = {}
        self._backend: Optional[ClaudeMemBackend] = None
        self._session_id: str = ""
        self._prefetch_thread = None
        self._prefetch_query = ""
        self._prefetch_result = ""
        self._prefetch_done = False
        self._prefetch_lock = threading.Lock()
        self._sync_thread = None
        self._sync_lock = threading.Lock()
        self._failures = 0
        self._breaker_until = 0.0
        self._breaker_lock = threading.Lock()

    @property
    def name(self) -> str:
        return "claude-mem"

    def is_available(self) -> bool:
        cfg = _load_config()
        try:
            b = ClaudeMemBackend(cfg["host"], int(cfg["port"]))
            return b.health()
        except Exception:
            return False

    def get_config_schema(self):
        return [
            {"key": "host", "description": "claude-mem worker host", "default": _DEFAULT_HOST, "env_var": "CLAUDE_MEM_WORKER_HOST"},
            {"key": "port", "description": "claude-mem worker port", "default": str(_DEFAULT_PORT), "env_var": "CLAUDE_MEM_WORKER_PORT"},
        ]

    def initialize(self, session_id: str, **kwargs) -> None:
        hermes_home = kwargs.get("hermes_home")
        self._config = _load_config(hermes_home)
        self._session_id = session_id
        self._backend = ClaudeMemBackend(self._config["host"], int(self._config["port"]))
        # Register this Hermes session with the worker (best-effort)
        try:
            self._backend.init_session(prompt=kwargs.get("agent_identity") or "")
        except Exception:
            pass

    def _breaker_open(self) -> bool:
        with self._breaker_lock:
            if self._failures >= _BREAKER_THRESHOLD and time.monotonic() < self._breaker_until:
                return True
            if self._failures >= _BREAKER_THRESHOLD:
                self._failures = 0
            return False

    def _record(self, ok: bool) -> None:
        with self._breaker_lock:
            if ok:
                self._failures = 0
            else:
                self._failures += 1
                if self._failures >= _BREAKER_THRESHOLD:
                    self._breaker_until = time.monotonic() + _BREAKER_COOLDOWN_SECS
                    logger.warning("claude-mem circuit breaker tripped; pausing %ds", _BREAKER_COOLDOWN_SECS)

    def system_prompt_block(self) -> str:
        return f"# Claude-Mem Memory\nActive (local worker at {self._config.get('host')}:{self._config.get('port')}).\n{_PROMPT_BODY}"

    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
        # Pull session-priming context on the first turn
        if turn_number <= 1 and self._backend and not self._breaker_open():
            def _prime():
                try:
                    ctx = self._backend.inject_context()
                    self._record(True)
                    if ctx:
                        logger.debug("claude-mem primed %d chars", len(ctx))
                except Exception:
                    self._record(False)
            t = threading.Thread(target=_prime, daemon=True, name="claudemem-prime")
            t.start()

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if not query or not self._backend or self._breaker_open():
            return ""
        try:
            results = self._backend.search(query, top_k=5)
            self._record(True)
        except Exception:
            self._record(False)
            return ""
        lines = []
        for r in results or []:
            text = r.get("text") or r.get("memory") or r.get("content") or ""
            if text:
                lines.append(f"- {text[:500]}")
        return "## Claude-Mem Recall\n" + "\n".join(lines) if lines else ""

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "") -> None:
        if not self._backend or self._breaker_open():
            return

        def _sync():
            try:
                combined = f"User: {user_content[:4000]}\nAssistant: {assistant_content[:4000]}"
                self._backend.add_observation(combined)
                self._record(True)
            except Exception:
                self._record(False)

        with self._sync_lock:
            prev = self._sync_thread
            if prev and prev.is_alive():
                return  # skip if a sync is already running
            self._sync_thread = threading.Thread(target=_sync, daemon=True, name="claudemem-sync")
            self._sync_thread.start()

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return list(TOOL_SCHEMAS)

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        if not self._backend:
            return json.dumps({"error": "claude-mem backend not initialized"})
        if tool_name == "claudemem_search":
            results = self._backend.search(args.get("query", ""), top_k=max(1, min(int(args.get("top_k", 5)), 20)))
            items = [{"text": (r.get("text") or r.get("memory") or "")[:800]} for r in results or []]
            return json.dumps({"results": items, "count": len(items)})
        if tool_name == "claudemem_remember":
            content = args.get("content", "")
            if not content:
                return json.dumps({"error": "missing content"})
            self._backend.add_observation(f"[user-saved] {content}")
            return json.dumps({"result": "Remembered."})
        return json.dumps({"error": f"Unknown tool: {tool_name}"})

    def shutdown(self) -> None:
        for t in (self._prefetch_thread, self._sync_thread):
            if t and t.is_alive():
                t.join(timeout=5.0)


def register(ctx) -> None:
    """Register claude-mem as a memory provider plugin."""
    ctx.register_memory_provider(ClaudeMemProvider())
