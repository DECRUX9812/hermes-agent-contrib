"""SQLite-backed bot registry for the rakazo plugin.

Tables:
  bots      — bot metadata, session binding, approval mode, status
  audit     — per-tool-call audit log (timestamp, tool, args, result, approved_by)
  routines  — cached routine metadata (the cron jobs live in Hermes cron)

All paths are profile-aware via get_hermes_home().
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home

_LOCK = threading.Lock()
_DB_PATH: Path | None = None


def _db_path() -> Path:
    global _DB_PATH
    if _DB_PATH is None:
        p = get_hermes_home() / "rakazo"
        p.mkdir(parents=True, exist_ok=True)
        _DB_PATH = p / "bots.db"
    return _DB_PATH


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path()), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS bots (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    instructions    TEXT DEFAULT '',
    color           TEXT DEFAULT '#7c3aed',
    session_id      TEXT,           -- Hermes session ID (the bot's thread)
    status          TEXT DEFAULT 'idle',   -- idle | running | waiting | error
    approval_mode   TEXT DEFAULT 'auto',   -- auto | strict
    workspace_path  TEXT,           -- bot sandbox directory
    model           TEXT,           -- optional model override
    notify_on_finish INTEGER DEFAULT 1,
    parent_bot_id   TEXT,            -- for child bots (sub-bots)
    created_at      REAL,
    updated_at      REAL,
    last_run_at     REAL,
    run_count       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id      TEXT NOT NULL,
    tool_name   TEXT NOT NULL,
    tool_args   TEXT,          -- JSON
    result_summary TEXT,       -- truncated result
    approved    INTEGER DEFAULT 0,   -- 1 if approved by user, 0 if auto
    approved_by TEXT,           -- who approved (user / auto / strict-blocked)
    timestamp   REAL,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS routines (
    id          TEXT PRIMARY KEY,   -- matches cron job ID
    bot_id      TEXT NOT NULL,
    name        TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    cron        TEXT NOT NULL,
    active      INTEGER DEFAULT 1,
    last_run_at REAL,
    created_at  REAL,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_bot ON audit(bot_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_routines_bot ON routines(bot_id);
"""


def init_db() -> None:
    """Create the schema if it doesn't exist. Safe to call multiple times."""
    with _LOCK:
        conn = _connect()
        try:
            conn.executescript(SCHEMA)
            conn.commit()
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Bot CRUD
# ---------------------------------------------------------------------------

import uuid


def create_bot(
    name: str,
    description: str = "",
    instructions: str = "",
    color: str = "#7c3aed",
    approval_mode: str = "auto",
    model: str = "",
    notify_on_finish: bool = True,
    parent_bot_id: str | None = None,
) -> dict[str, Any]:
    bot_id = f"bot_{uuid.uuid4().hex[:12]}"
    now = time.time()
    ws = get_hermes_home() / "rakazo" / "bots" / bot_id / "workspace"
    ws.mkdir(parents=True, exist_ok=True)
    (get_hermes_home() / "rakazo" / "bots" / bot_id / "memory").mkdir(parents=True, exist_ok=True)

    with _LOCK:
        conn = _connect()
        try:
            conn.execute(
                """INSERT INTO bots
                   (id, name, description, instructions, color, session_id, status,
                    approval_mode, workspace_path, model, notify_on_finish,
                    parent_bot_id, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    bot_id, name, description, instructions, color,
                    "idle", approval_mode, str(ws), model or None,
                    1 if notify_on_finish else 0, parent_bot_id, now, now,
                ),
            )
            conn.commit()
        finally:
            conn.close()
    return get_bot(bot_id)


def get_bot(bot_id: str) -> dict[str, Any] | None:
    with _LOCK:
        conn = _connect()
        try:
            row = conn.execute("SELECT * FROM bots WHERE id = ?", (bot_id,)).fetchone()
        finally:
            conn.close()
    return dict(row) if row else None


def get_bot_by_name(name: str) -> dict[str, Any] | None:
    with _LOCK:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT * FROM bots WHERE name = ? COLLATE NOCASE", (name,)
            ).fetchone()
        finally:
            conn.close()
    return dict(row) if row else None


def list_bots() -> list[dict[str, Any]]:
    with _LOCK:
        conn = _connect()
        try:
            rows = conn.execute("SELECT * FROM bots ORDER BY updated_at DESC").fetchall()
        finally:
            conn.close()
    return [dict(r) for r in rows]


def update_bot(bot_id: str, **fields) -> dict[str, Any] | None:
    allowed = {"name", "description", "instructions", "color", "status",
               "approval_mode", "model", "notify_on_finish", "session_id",
               "last_run_at", "run_count"}
    sets = []
    vals = []
    for k, v in fields.items():
        if k in allowed:
            sets.append(f"{k} = ?")
            vals.append(v)
    if not sets:
        return get_bot(bot_id)
    sets.append("updated_at = ?")
    vals.append(time.time())
    vals.append(bot_id)
    with _LOCK:
        conn = _connect()
        try:
            conn.execute(f"UPDATE bots SET {', '.join(sets)} WHERE id = ?", vals)
            conn.commit()
        finally:
            conn.close()
    return get_bot(bot_id)


def delete_bot(bot_id: str) -> bool:
    with _LOCK:
        conn = _connect()
        try:
            cur = conn.execute("DELETE FROM bots WHERE id = ?", (bot_id,))
            conn.commit()
            deleted = cur.rowcount > 0
        finally:
            conn.close()
    return deleted


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

def add_audit(
    bot_id: str,
    tool_name: str,
    tool_args: dict | str,
    result_summary: str = "",
    approved: bool = False,
    approved_by: str = "auto",
) -> int:
    args_str = json.dumps(tool_args) if isinstance(tool_args, dict) else str(tool_args)
    if len(args_str) > 4000:
        args_str = args_str[:4000] + "…"
    # Normalize result_summary: dict → JSON, else str
    if isinstance(result_summary, dict):
        result_summary = json.dumps(result_summary)
    elif not isinstance(result_summary, str):
        result_summary = str(result_summary)
    if len(result_summary) > 2000:
        result_summary = result_summary[:2000] + "…"
    with _LOCK:
        conn = _connect()
        try:
            cur = conn.execute(
                """INSERT INTO audit (bot_id, tool_name, tool_args, result_summary,
                   approved, approved_by, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    bot_id, tool_name, args_str, result_summary,
                    1 if approved else 0, approved_by, time.time(),
                ),
            )
            conn.commit()
            audit_id = cur.lastrowid
        finally:
            conn.close()
    return audit_id


def get_audit_log(bot_id: str, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    with _LOCK:
        conn = _connect()
        try:
            rows = conn.execute(
                """SELECT * FROM audit WHERE bot_id = ?
                   ORDER BY timestamp DESC LIMIT ? OFFSET ?""",
                (bot_id, limit, offset),
            ).fetchall()
        finally:
            conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Routines
# ---------------------------------------------------------------------------

def save_routine(
    routine_id: str, bot_id: str, name: str, prompt: str, cron: str
) -> None:
    now = time.time()
    with _LOCK:
        conn = _connect()
        try:
            conn.execute(
                """INSERT INTO routines (id, bot_id, name, prompt, cron, active, created_at)
                   VALUES (?, ?, ?, ?, ?, 1, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     name=excluded.name, prompt=excluded.prompt, cron=excluded.cron""",
                (routine_id, bot_id, name, prompt, cron, now),
            )
            conn.commit()
        finally:
            conn.close()


def list_routines(bot_id: str) -> list[dict[str, Any]]:
    with _LOCK:
        conn = _connect()
        try:
            rows = conn.execute(
                "SELECT * FROM routines WHERE bot_id = ? ORDER BY created_at",
                (bot_id,),
            ).fetchall()
        finally:
            conn.close()
    return [dict(r) for r in rows]


def delete_routine(routine_id: str) -> bool:
    with _LOCK:
        conn = _connect()
        try:
            cur = conn.execute("DELETE FROM routines WHERE id = ?", (routine_id,))
            conn.commit()
            deleted = cur.rowcount > 0
        finally:
            conn.close()
    return deleted


def get_routine(routine_id: str) -> dict[str, Any] | None:
    with _LOCK:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT * FROM routines WHERE id = ?", (routine_id,)
            ).fetchone()
        finally:
            conn.close()
    return dict(row) if row else None
