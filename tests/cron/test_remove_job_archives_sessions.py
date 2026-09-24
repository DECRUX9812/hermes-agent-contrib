"""#43965: remove_job must archive the job's cron run sessions.

Deleting a job removed the jobs.json row, output dir and notepad but left its
``source='cron'`` session rows (``cron_{job_id}_{ts}``) visible in state.db —
orphan sidebar entries with no list/reset path. remove_job now archives that
job's run sessions in the same removal window and reports the count.
"""

import os
from pathlib import Path

import pytest

from cron.jobs import create_job, remove_job
from hermes_state import SessionDB


@pytest.fixture()
def cron_home(monkeypatch):
    """Point the job store at the same isolated home state.db resolves to."""
    home = Path(os.environ["HERMES_HOME"])
    import cron.jobs as jobs_mod

    monkeypatch.setattr(jobs_mod, "CRON_DIR", home / "cron")
    monkeypatch.setattr(jobs_mod, "JOBS_FILE", home / "cron" / "jobs.json")
    monkeypatch.setattr(jobs_mod, "OUTPUT_DIR", home / "cron" / "output")
    return home


def test_remove_job_archives_its_cron_sessions(cron_home):
    db = SessionDB()
    try:
        job = create_job(prompt="feed check", schedule="every 1h")
        other = create_job(prompt="keep me", schedule="every 2h")
        sid1, sid2 = f"cron_{job['id']}_1", f"cron_{job['id']}_2"
        other_sid = f"cron_{other['id']}_1"
        for sid in (sid1, sid2, other_sid):
            db.create_session(session_id=sid, source="cron")
        db.create_session(session_id="unrelated-cli", source="cli")

        assert remove_job(job["id"]) is True

        # No visible (non-archived) run sessions remain for the removed job.
        assert db.get_session(sid1)["archived"] == 1
        assert db.get_session(sid2)["archived"] == 1
        # Unrelated sessions — another job's runs and non-cron rows — are untouched.
        assert db.get_session(other_sid)["archived"] == 0
        assert db.get_session("unrelated-cli")["archived"] == 0
    finally:
        db.close()


def test_remove_job_reports_archived_session_count(cron_home):
    db = SessionDB()
    try:
        job = create_job(prompt="feed check", schedule="every 1h")
        db.create_session(session_id=f"cron_{job['id']}_1", source="cron")
        db.create_session(session_id=f"cron_{job['id']}_2", source="cron")

        out = {}
        assert remove_job(job["id"], out=out) is True
        assert out.get("sessions_archived") == 2
    finally:
        db.close()
