"""Per-job wall-clock max duration for cron agent runs (WP-10 #105983).

The inactivity watchdog only fires when the agent goes quiet; a job that stays
busy forever was never bounded. A job carrying ``max_duration_seconds`` must be
hard-interrupted at that wall-clock deadline even while activity continues, and
the recorded reason must be distinct from the inactivity timeout.
"""

import sys
import threading
import time
from pathlib import Path

import pytest

# Ensure project root is importable
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


class BusyAgent:
    """Agent whose activity is always fresh — the inactivity watchdog can never
    fire on it. ``run_conversation`` keeps working until interrupted."""

    def __init__(self, run_for=10.0):
        self._run_for = run_for
        self._stop = threading.Event()
        self.interrupted_with = None

    def get_activity_summary(self):
        return {
            "last_activity_ts": time.time(),
            "last_activity_desc": "tool_call",
            "seconds_since_activity": 0.0,
            "current_tool": "terminal",
            "api_call_count": 7,
            "max_iterations": 90,
        }

    def interrupt(self, msg=None, **kwargs):
        self.interrupted_with = msg
        self._stop.set()

    def run_conversation(self, prompt, task_id=None):
        self._stop.wait(self._run_for)
        return {"final_response": "worked until stopped", "messages": []}


def _job(**extra):
    job = {"id": "maxdurtst1", "name": "maxdur-test", "schedule": {"kind": "interval"}}
    job.update(extra)
    return job


class TestMaxDuration:
    def test_busy_agent_hard_interrupted_at_max_duration(self):
        """A job with max_duration_seconds is cut at the wall-clock deadline even
        though get_activity_summary reports fresh activity every poll."""
        from cron.scheduler import _run_agent_with_watchdog

        agent = BusyAgent(run_for=10.0)
        started = time.monotonic()
        with pytest.raises(TimeoutError) as excinfo:
            _run_agent_with_watchdog(
                agent, "do work", _job(max_duration_seconds=0.4),
                "maxdurtst1", "maxdur-test", "task-1", None)
        elapsed = time.monotonic() - started

        message = str(excinfo.value).lower()
        assert "max duration" in message
        # Distinct from the inactivity watchdog's "idle for Ns (limit Ns)" shape.
        assert "idle for" not in message
        # Wall-clock bound: interrupted near the deadline, never ran the full 10s.
        assert elapsed < 5.0
        assert agent._stop.is_set()

    def test_job_without_max_duration_runs_past_deadline(self):
        """Same busy agent with no max_duration_seconds finishes normally — the
        inactivity watchdog alone governs it and never fires on an active run."""
        from cron.scheduler import _run_agent_with_watchdog

        agent = BusyAgent(run_for=0.8)  # longer than the deadline used above
        result = _run_agent_with_watchdog(
            agent, "do work", _job(), "maxdurtst1", "maxdur-test", "task-2", None)
        assert result["final_response"] == "worked until stopped"
        assert not agent._stop.is_set()
