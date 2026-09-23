"""#84525: `hermes sessions optimize` must refuse while another process holds state.db.

``db.vacuum()``'s contract requires the caller to ensure no other writers are
active; against a live gateway+dashboard the exclusive rewrite/checkpoint is
refused and leaves stale WAL/SHM handles (empty sidebar, disk I/O error). The
command must preflight with the same fail-closed foreign-holder scan repair
uses (``hermes_state_holders.foreign_state_db_holders``) and refuse with a
named error before attempting VACUUM.
"""

from __future__ import annotations

import select
import subprocess
import sys
import uuid
from argparse import Namespace

import hermes_cli.sessions_cmd as sc

_HOLDER = """
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.execute("SELECT count(*) FROM sessions").fetchall()
print("ready", flush=True)
sys.stdin.read(1)
conn.close()
"""


def _spawn_holder(db_path):
    holder = subprocess.Popen([sys.executable, "-c", _HOLDER, str(db_path)],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True)
    assert select.select([holder.stdout], [], [], 10)[0] \
        and holder.stdout.readline().strip() == "ready"
    return holder


def _release(holder):
    try:
        holder.stdin.write("x")
        holder.stdin.close()
    except Exception:
        holder.kill()
    holder.wait(timeout=10)


def test_optimize_refuses_while_another_process_holds_state_db(tmp_path, monkeypatch, capsys):
    """A second process holding state.db (the gateway) must make optimize refuse
    before VACUUM; the holder's handle must still read rows afterwards."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_state import SessionDB

    store = SessionDB(tmp_path / "state.db")
    sid = store.create_session(session_id=str(uuid.uuid4()), source="cli")
    store.append_message(sid, role="user", content="seed")
    store.close()

    holder = _spawn_holder(tmp_path / "state.db")
    vacuum_calls = []
    monkeypatch.setattr(SessionDB, "vacuum", lambda self: vacuum_calls.append(True) or 0)
    try:
        rc = sc.cmd_sessions(Namespace(sessions_action="optimize"))
        out = capsys.readouterr().out
        # The held handle still reads rows after the refusal.
        check = subprocess.run([sys.executable, "-c",
                                "import sqlite3, sys; print(sqlite3.connect(sys.argv[1])"
                                ".execute('SELECT count(*) FROM sessions').fetchone()[0])",
                                str(tmp_path / "state.db")],
                               capture_output=True, text=True, timeout=30)
    finally:
        _release(holder)

    assert rc == 1
    assert vacuum_calls == [], "VACUUM was attempted under a live holder"
    assert "gateway stop" in out.lower()
    assert check.stdout.strip() == "1"
