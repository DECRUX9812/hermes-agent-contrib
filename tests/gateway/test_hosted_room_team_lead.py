"""Behavior tests for the team-orchestrated listening gate in
``hosted_room_discussion.plan_next_task`` — the durable same-gateway Discussion engine.

An orchestrated room (``lead_profile`` names a local member, resolved by the caller from
``tools/bot_team.room_lead``) wakes the LEAD on every user turn; teammates wake only on an
explicit @mention (or @everyone/@all broadcast). Unled rooms keep fan-out listening."""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from gateway import hosted_room_discussion as discussion
from gateway import hosted_rooms


ROOM_ID = "room-team-1"
GATEWAY_ID = "gateway-a"
LEAD = "research"
LOCAL_PROFILES = ("research", "build", "review", "ops", "qa", "docs")
MEMBERS = [
    {
        "member_id": f"member-{profile}",
        "profile": profile,
        "handle": profile,
        "display_name": profile.title(),
    }
    for profile in LOCAL_PROFILES[:3]
]


@pytest.fixture
def room_db(tmp_path: Path) -> tuple[Path, dict]:
    db = tmp_path / "state.db"
    room = hosted_rooms.create_room(
        db,
        room_id=ROOM_ID,
        name="Release",
        members=MEMBERS,
        authority_gateway_id=GATEWAY_ID,
        now=1,
    )
    return db, room


def _events(db: Path) -> list[dict]:
    return hosted_rooms.read_events(
        db,
        room_id=ROOM_ID,
        since_seq=0,
        limit=hosted_rooms.MAX_LOG_LIMIT,
    )["events"]


def _append_user(
    db: Path,
    *,
    event_id: str,
    text: str,
    thread_id: str = "thread-1",
) -> dict:
    return hosted_rooms.append_event(
        db,
        room_id=ROOM_ID,
        event_id=event_id,
        kind="message.user",
        actor={"kind": "user", "id": "local-user"},
        authority_gateway_id=GATEWAY_ID,
        authority_epoch=1,
        payload={"text": text, "thread_id": thread_id},
        now=time.time(),
    )


def _append_publication(db: Path, plan: discussion.PublicationPlan) -> None:
    for event in plan.events:
        hosted_rooms.append_event(db, **event.append_kwargs(ROOM_ID), now=time.time())


def _decide(room: dict, db: Path, lead: str | None = LEAD) -> discussion.DiscussionDecision:
    return discussion.plan_next_task(
        room, _events(db), local_profiles=LOCAL_PROFILES, lead_profile=lead)


def _settle_next(
    room: dict,
    db: Path,
    *,
    text: str,
    lead: str | None = LEAD,
) -> discussion.DiscussionTaskPlan:
    decision = _decide(room, db, lead)
    assert decision.status == "task" and decision.task is not None, decision
    publication = discussion.plan_publication(
        room, _events(db), decision.task, status="settled",
        result={"text": text}, local_profiles=LOCAL_PROFILES)
    _append_publication(db, publication)
    return decision.task


def test_plain_user_turn_wakes_only_the_lead(room_db):
    """Orchestrator invariant: an unaddressed send reaches the lead and NO teammate —
    the unaddressed member burns zero turns on user messages."""
    db, room = room_db
    _append_user(db, event_id="user-1", text="Report.")
    lead_task = _settle_next(room, db, text="Done.")
    assert lead_task.member.profile == LEAD
    decision = _decide(room, db)
    # Nobody else is owed a turn: the room settles instead of waking build/review.
    assert decision.status != "task", decision
    assert decision.status in {"settled", "idle"}


def test_mentioned_member_wakes_alongside_the_lead(room_db):
    """Direct addressing beats orchestrator-only: the lead answers first, then the
    @mentioned member gets its turn, and the third member never wakes."""
    db, room = room_db
    _append_user(db, event_id="user-1", text="Plan it, then @build executes.")
    first = _settle_next(room, db, text="Build, please take it.")
    assert first.member.profile == LEAD
    second = _settle_next(room, db, text="On it.")
    assert second.member.profile == "build"
    decision = _decide(room, db)
    assert decision.status != "task", decision
    assert decision.status in {"settled", "idle"}


def test_broadcast_mention_wakes_the_whole_roster(room_db):
    db, room = room_db
    _append_user(db, event_id="user-1", text="@everyone weigh in.")
    profiles = [_settle_next(room, db, text=f"view {i}").member.profile for i in range(3)]
    assert set(profiles) == {"research", "build", "review"}
    assert profiles[0] == LEAD  # the orchestrator answers first


def test_no_lead_keeps_fanout_listening(room_db):
    """``lead_profile=None`` is the unled shape: a plain send still fans out."""
    db, room = room_db
    _append_user(db, event_id="user-1", text="Report.")
    first = _settle_next(room, db, text="one", lead=None)
    second = _settle_next(room, db, text="two", lead=None)
    assert first.member.profile != second.member.profile


def test_lead_naming_a_non_member_stays_unled(room_db):
    """A lead the roster doesn't seat cannot gate anything — the room stays on fan-out."""
    db, room = room_db
    _append_user(db, event_id="user-1", text="Report.")
    first = _settle_next(room, db, text="one", lead="stranger")
    second = _settle_next(room, db, text="two", lead="stranger")
    assert first.member.profile != second.member.profile


def test_peer_targeted_member_cannot_be_the_room_lead(tmp_path):
    """Only a LOCAL member can orchestrate: a lead profile seated only as a peer leaves
    the room unled (the gate matches the same locality rule the resolver uses)."""
    db = tmp_path / "state.db"
    members = [
        {"member_id": "member-research", "profile": "research", "handle": "research",
         "target": {"kind": "peer", "peer_id": "peer-9", "installation_id": "inst-9",
                    "profile": "research", "capability_digest": "a" * 64}},
        *MEMBERS[1:],
    ]
    room = hosted_rooms.create_room(
        db, room_id=ROOM_ID, name="Release", members=members,
        authority_gateway_id=GATEWAY_ID, now=1)
    _append_user(db, event_id="user-1", text="Report.")
    first = _settle_next(room, db, text="one", lead="research")
    second = _settle_next(room, db, text="two", lead="research")
    assert first.member.profile != second.member.profile
