"""Rakazo backend API routes for the Hermes Desktop & Dashboard.

Mounted at /api/plugins/rakazo/ by the dashboard plugin loader.
Exposes REST endpoints for listing bots, creating bots, sending turns,
fetching audit logs, reading bot memory, and querying routines.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from plugins.rakazo.bot_db import (
    create_bot,
    delete_bot,
    get_audit_log,
    get_bot,
    get_bot_by_name,
    list_bots,
    list_routines,
    update_bot,
)
from plugins.rakazo.tools import _launch_bot_turn, _queue_message

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateBotPayload(BaseModel):
    name: str
    description: str = ""
    instructions: str = ""
    color: str = "#7c3aed"
    approval_mode: str = "auto"
    model: str = ""
    notify_on_finish: bool = True


class SendMessagePayload(BaseModel):
    message: str
    block: bool = False


class UpdateBotPayload(BaseModel):
    """Partial bot update — used by the desktop Fleet plugin to persist the
    Hermes session binding (`session_id`) and live status after a turn."""

    session_id: Optional[str] = None
    status: Optional[str] = None
    run_count: Optional[int] = None
    model: Optional[str] = None
    color: Optional[str] = None


@router.get("/bots")
def api_list_bots() -> List[Dict[str, Any]]:
    return list_bots()


@router.post("/bots")
def api_create_bot(payload: CreateBotPayload) -> Dict[str, Any]:
    existing = get_bot_by_name(payload.name)
    if existing:
        raise HTTPException(status_code=400, detail=f"Bot '{payload.name}' already exists.")
    bot = create_bot(
        name=payload.name,
        description=payload.description,
        instructions=payload.instructions,
        color=payload.color,
        approval_mode=payload.approval_mode,
        model=payload.model,
        notify_on_finish=payload.notify_on_finish,
    )
    return bot


@router.get("/bots/{bot_id}")
def api_get_bot(bot_id: str) -> Dict[str, Any]:
    bot = get_bot(bot_id) or get_bot_by_name(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    return bot


@router.delete("/bots/{bot_id}")
def api_delete_bot(bot_id: str) -> Dict[str, Any]:
    bot = get_bot(bot_id) or get_bot_by_name(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    delete_bot(bot["id"])
    return {"success": True, "bot_id": bot["id"]}


@router.patch("/bots/{bot_id}")
def api_update_bot(bot_id: str, payload: UpdateBotPayload) -> Dict[str, Any]:
    bot = get_bot(bot_id) or get_bot_by_name(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    fields = payload.model_dump(exclude_none=True)
    if not fields:
        return bot
    updated = update_bot(bot["id"], **fields)
    return updated or bot


@router.post("/bots/{bot_id}/send")
def api_send_message(bot_id: str, payload: SendMessagePayload) -> Dict[str, Any]:
    bot = get_bot(bot_id) or get_bot_by_name(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    
    if payload.block:
        _queue_message(bot["id"], payload.message)
        return {"success": True, "status": "queued", "bot_id": bot["id"]}
    else:
        _launch_bot_turn(bot["id"], payload.message)
        update_bot(bot["id"], status="running")
        return {"success": True, "status": "launched", "bot_id": bot["id"]}


@router.get("/bots/{bot_id}/audit")
def api_get_audit(bot_id: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    bot = get_bot(bot_id) or get_bot_by_name(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    return get_audit_log(bot["id"], limit=limit, offset=offset)


@router.get("/bots/{bot_id}/routines")
def api_get_routines(bot_id: str) -> List[Dict[str, Any]]:
    bot = get_bot(bot_id) or get_bot_by_name(bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    return list_routines(bot["id"])
