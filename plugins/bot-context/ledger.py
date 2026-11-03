"""Bounded in-memory ledger of activity approvals, plus a durable decision log.

Pending approvals live in the host's own gateway queue, not here: this ledger is
the *index* that lets a caller who only knows "some bot is waiting on me" find
the activity's context and its prompt id. It is therefore rebuilt from hooks on
every start and never trusted as the source of truth for whether something is
still pending — ``approvals.respond`` always asks the host.

Durability is limited on purpose to settled decisions (``decisions.jsonl``),
bounded by row count and age. A restart loses pending rows, which is correct:
after a restart the queue they pointed at is gone too, and replaying them would
offer the user buttons that resolve nothing.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Iterable, Iterator

from .activities import STATUS_EXPIRED, STATUS_PENDING, Activity, is_settled

logger = logging.getLogger("plugins.bot-context")

_MAX_DECISIONS_DEFAULT = 5000
_BYTES_SOFT_CAP = 2 * 1024 * 1024


def _data_dir():
    """``plugin-data/bot-context/`` — the sanctioned per-plugin store (never the install dir)."""
    try:
        from plugins.plugin_storage import plugin_data_dir
        return plugin_data_dir("bot-context")
    except Exception as exc:  # pragma: no cover - storage is best-effort
        logger.debug("bot-context: no plugin data dir (%s); running memory-only", exc)
        return None


class Ledger:
    """Thread-safe activity index. All methods never raise on I/O failure."""

    def __init__(
        self,
        *,
        store_dir: Path | None = None,
        max_pending: int = 200,
        retention_days: float = 3.0,
        max_decisions: int = _MAX_DECISIONS_DEFAULT,
        now=None,
    ):
        self._lock = threading.RLock()
        self._pending: dict[str, Activity] = {}
        self._settled: dict[str, Activity] = {}
        self._max_pending = max(1, int(max_pending))
        self._retention_s = max(0.0, float(retention_days)) * 86400.0
        self._max_decisions = max(1, int(max_decisions))
        self._now = now or time.time
        self._dir = Path(store_dir) if store_dir is not None else _data_dir()
        self._decisions_path = (self._dir / "decisions.jsonl") if self._dir else None
        self._write_failures = 0
        self.dropped: list[dict[str, Any]] = []

    # ── reads ────────────────────────────────────────────────────────────────
    @property
    def store_path(self) -> str | None:
        return str(self._decisions_path) if self._decisions_path else None

    def configure(self, *, max_pending: int | None = None,
                  retention_days: float | None = None) -> None:
        """Apply settings re-read after a config edit, without losing pending rows."""
        with self._lock:
            if max_pending is not None:
                self._max_pending = max(1, int(max_pending))
                while len(self._pending) > self._max_pending:
                    oldest = min(self._pending.values(), key=lambda a: a.requested_at)
                    del self._pending[oldest.activity_id]
            if retention_days is not None:
                self._retention_s = max(0.0, float(retention_days)) * 86400.0

    def rebind(self, store_dir: Path | None) -> bool:
        """Follow the active profile's ``plugin-data`` directory.

        Returns True when the store changed. Pending rows are dropped on a
        profile switch: they address queues in the old profile's process and
        must never leak into another profile's view.
        """
        target = Path(store_dir) if store_dir is not None else None
        with self._lock:
            if target == self._dir:
                return False
            self._dir = target
            self._decisions_path = (target / "decisions.jsonl") if target else None
            self._pending.clear()
            self._settled.clear()
            return True

    def get(self, activity_id: str) -> Activity | None:
        with self._lock:
            return self._pending.get(activity_id) or self._settled.get(activity_id)

    def pending(self, *, profile: str | None = None, room: str | None = None,
                session_key: str | None = None, session_id: str | None = None) -> list[Activity]:
        now = self._now()
        with self._lock:
            rows = [a for a in self._pending.values() if not self._is_stale(a, now)]
        if profile:
            rows = [a for a in rows if a.context.profile == profile]
        if room:
            rows = [a for a in rows if a.context.room == room]
        if session_key:
            rows = [a for a in rows if a.context.session_key == session_key]
        if session_id:
            rows = [a for a in rows if a.context.session_id == session_id]
        return sorted(rows, key=lambda a: a.requested_at)

    def recent(self, *, limit: int = 20, since_hours: float | None = None,
               profile: str | None = None, session_key: str | None = None,
               session_id: str | None = None) -> list[Activity]:
        """Settled decisions from disk + memory, newest first."""
        cutoff = None
        if since_hours is not None:
            cutoff = self._now() - float(since_hours) * 3600.0
        rows: list[Activity] = []
        with self._lock:
            for line in self._read_decisions():
                record = line.get("activity")
                if not isinstance(record, dict):
                    continue
                if cutoff is not None and float(record.get("settled_at") or 0) < cutoff:
                    continue
                rows.append(_from_record(record))
            if not rows:  # no durable log: fall back to this process's memory
                rows = [a for a in self._settled.values() if is_settled(a.status)]
        if profile:
            rows = [a for a in rows if a.context.profile == profile]
        if session_key:
            rows = [a for a in rows if a.context.session_key == session_key]
        if session_id:
            rows = [a for a in rows if a.context.session_id == session_id]
        # One row per activity: the answer path and the host's own post-hook both
        # settle the same id, and history must not read as two decisions.
        newest: dict[str, Activity] = {}
        for activity in rows:
            seen = newest.get(activity.activity_id)
            if seen is None or (activity.settled_at or 0) >= (seen.settled_at or 0):
                newest[activity.activity_id] = activity
        unique = list(newest.values())
        unique.sort(key=lambda a: a.settled_at or a.requested_at, reverse=True)
        return unique[: max(0, int(limit))]

    def sessions(self) -> list[dict[str, Any]]:
        """One row per session that currently owns pending activity (oldest first).

        This is the session-isolation boundary for UIs: a caller selects a
        session by key and never has to filter another session's rows itself.
        """
        rows = self.pending()
        grouped: dict[str, dict[str, Any]] = {}
        for activity in rows:
            key = activity.context.session_key or activity.context.session_id or f"activity:{activity.activity_id}"
            entry = grouped.setdefault(key, {
                "session_key": activity.context.session_key,
                "session_id": activity.context.session_id,
                "profile": activity.context.profile,
                "bot": {
                    "profile": activity.context.profile,
                    "title": activity.context.bot_title,
                    "label": activity.context.label,
                },
                "room": activity.context.room,
                "pending": 0,
                "answerable": 0,
                "oldest_requested_at": activity.requested_at,
                "activity_ids": [],
            })
            entry["pending"] += 1
            entry["answerable"] += 1 if activity.answerable else 0
            entry["oldest_requested_at"] = min(entry["oldest_requested_at"], activity.requested_at)
            entry["activity_ids"].append(activity.activity_id)
        return sorted(grouped.values(), key=lambda row: row["oldest_requested_at"])

    def pending_ids(self) -> set[str]:
        with self._lock:
            return set(self._pending)

    # ── writes ───────────────────────────────────────────────────────────────
    def record(self, activity: Activity) -> Activity:
        """Insert or replace one pending activity, evicting the oldest when over the cap."""
        with self._lock:
            self._pending[activity.activity_id] = activity
            self._settled.pop(activity.activity_id, None)
            while len(self._pending) > self._max_pending:
                oldest = min(self._pending.values(), key=lambda a: a.requested_at)
                del self._pending[oldest.activity_id]
                self.dropped.append({
                    "activity_id": oldest.activity_id,
                    "reason": "max_pending",
                    "at": self._now(),
                })
                del self.dropped[:-50]
                logger.warning(
                    "bot-context: dropping pending activity %s (%s) — max_pending=%d",
                    oldest.activity_id, oldest.context.label, self._max_pending)
            return activity

    def settle(self, activity_id: str, *, status: str, choice: str | None = None,
               by: str = "", note: str = "") -> Activity | None:
        """Move one activity out of pending and append the decision to disk."""
        with self._lock:
            current = self._pending.pop(activity_id, None) or self._settled.get(activity_id)
            if current is None:
                return None
            if (current.status == status and current.settled_choice == choice
                    and is_settled(current.status)):
                # The same decision arriving twice (our answer, then the host's
                # post-hook) is one decision, not two log rows.
                return current
            settled = current.with_status(status, choice=choice, by=by, note=note)
            self._settled[activity_id] = settled
            # Bound the memory map the same way as pending.
            while len(self._settled) > self._max_decisions:
                oldest = min(self._settled.values(), key=lambda a: a.settled_at or a.requested_at)
                self._settled.pop(oldest.activity_id, None)
            self._append_decision(settled)
            return settled

    def expire_stale(self, ttl_seconds: float) -> int:
        """Settle every pending row older than ``ttl_seconds`` as expired. Returns how many."""
        if ttl_seconds <= 0:
            return 0
        now = self._now()
        expired = []
        with self._lock:
            for activity_id, activity in list(self._pending.items()):
                if now - activity.requested_at >= ttl_seconds:
                    expired.append(activity_id)
        for activity_id in expired:
            self.settle(activity_id, status=STATUS_EXPIRED, by="ttl",
                        note="no further prompt observed inside the retention window")
        return len(expired)

    def reset(self) -> None:
        with self._lock:
            self._pending.clear()
            self._settled.clear()

    # ── internals ────────────────────────────────────────────────────────────
    def _is_stale(self, activity: Activity, now: float) -> bool:
        if not self._retention_s:
            return False
        if now - activity.requested_at < self._retention_s:
            return False
        self.settle(activity.activity_id, status=STATUS_EXPIRED, by="retention",
                    note="retention window elapsed")
        return True

    def _read_decisions(self) -> Iterator[dict[str, Any]]:
        path = self._decisions_path
        if not path or not path.is_file():
            return iter(())
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return iter(())

        def _iter() -> Iterator[dict[str, Any]]:
            for line in lines[-self._max_decisions:]:
                line = line.strip()
                if not line:
                    continue
                try:
                    parsed = json.loads(line)
                except ValueError:
                    continue
                if isinstance(parsed, dict):
                    yield parsed

        return _iter()

    def _append_decision(self, activity: Activity) -> None:
        path = self._decisions_path
        if not path:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"activity": activity.to_dict()}, ensure_ascii=False) + "\n")
            self._trim_if_needed(path)
        except OSError as exc:  # pragma: no cover - disk problems must not break approval
            self._write_failures += 1
            logger.debug("bot-context: could not append decision (%s)", exc)

    def _trim_if_needed(self, path: Path) -> None:
        try:
            if path.stat().st_size <= _BYTES_SOFT_CAP:
                return
            lines = path.read_text(encoding="utf-8").splitlines()[-self._max_decisions:]
            tmp = path.with_suffix(".jsonl.tmp")
            tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
            tmp.replace(path)
        except OSError:  # pragma: no cover - best-effort trim
            pass

    def diagnostics(self) -> dict[str, Any]:
        with self._lock:
            return {
                "store_path": self.store_path,
                "pending": len(self._pending),
                "settled_in_memory": len(self._settled),
                "max_pending": self._max_pending,
                "retention_days": self._retention_s / 86400.0 if self._retention_s else 0,
                "write_failures": self._write_failures,
                "dropped": list(self.dropped[-10:]),
            }


def _sub(record: dict[str, Any], key: str) -> dict[str, Any]:
    value = record.get(key)
    return value if isinstance(value, dict) else {}


def _from_record(record: dict[str, Any]) -> Activity:
    """Rebuild an ``Activity`` from a durable decision row (tolerant of older rows)."""
    from .context import BotContext

    bot = _sub(record, "bot")
    session = _sub(record, "session")
    room = _sub(record, "room")
    ctx = BotContext(
        profile=str(bot.get("profile") or ""),
        profile_home=str(bot.get("profile_home") or ""),
        bot_title=str(bot.get("title") or ""),
        session_key=str(session.get("key") or ""),
        session_id=str(session.get("id") or ""),
        turn_id=str(session.get("turn_id") or ""),
        tool_call_id=str(session.get("tool_call_id") or ""),
        platform=str(session.get("platform") or ""),
        surface=str(session.get("surface") or ""),
        room=(str(room.get("id")) if room.get("id") else None),
        room_generation=(str(room.get("generation")) if room.get("generation") else None),
        missing=tuple(record.get("context_missing") or ()),
        degraded=tuple(record.get("context_degraded") or ()),
    )
    return Activity(
        activity_id=str(record.get("activity_id") or ""),
        kind=str(record.get("kind") or "command"),
        status=str(record.get("status") or STATUS_PENDING),
        command=str(record.get("command") or ""),
        description=str(record.get("description") or ""),
        pattern_key=str(record.get("pattern_key") or ""),
        pattern_keys=tuple(record.get("pattern_keys") or ()),
        choices=tuple(record.get("choices") or ()),
        choices_source=str(record.get("choices_source") or "inferred"),
        requested_at=float(record.get("requested_at") or 0),
        context=ctx,
        answerable=bool(record.get("answerable", True)),
        source=str(record.get("source") or "gateway"),
        settled_at=(float(record["settled_at"]) if record.get("settled_at") else None),
        settled_choice=record.get("settled_choice"),
        settled_by=str(record.get("settled_by") or ""),
        note=str(record.get("note") or ""),
    )


def iter_activities(activities: Iterable[Activity]) -> Iterator[dict[str, Any]]:
    for activity in activities:
        yield activity.to_dict()
