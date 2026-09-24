"""remove_job must delete the job's ``cron_{id}_{ts}`` run sessions (source='cron'),
sparing pinned rows and every other job's sessions — previously they orphaned forever."""

from cron.jobs import create_job, remove_job
from hermes_state import SessionDB


def _run_ids(db, job_id):
    return {r["id"] for r in db.list_cron_job_runs(job_id, limit=100)}


def test_remove_job_deletes_run_sessions():
    job = create_job(prompt="gone", schedule="every 1h")
    other = create_job(prompt="stays", schedule="every 1h")

    db = SessionDB()
    try:
        db.create_session(f"cron_{job['id']}_20260101_000000", source="cron")
        db.create_session(f"cron_{job['id']}_20260101_000001", source="cron")
        foreign_id = f"cron_{other['id']}_20260101_000000"
        db.create_session(foreign_id, source="cron")
        pinned_id = f"cron_{job['id']}_20260101_000002"
        db.create_session(pinned_id, source="cron")
        db.set_session_pinned(pinned_id, True)
        # Same id prefix but not a cron run: the source='cron' binding must spare it.
        non_cron_id = f"cron_{job['id']}_imported"
        db.create_session(non_cron_id, source="cli")

        details = {}
        assert remove_job(job["id"], details) is True

        assert _run_ids(db, job["id"]) == {pinned_id}
        assert _run_ids(db, other["id"]) == {foreign_id}
        assert details["run_sessions_deleted"] == 2
    finally:
        db.close()
