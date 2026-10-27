"""Hermes Browser routes (hermes-bots-plus), mounted at ``/api/plugins/hermes-bots-plus/``.

``GET  browser/probe?url=&origin=``  can the viewer frame this page, and can the gateway reach it
``POST browser/view``                render / drive a page in the gateway's headless browser
``DELETE browser/view/{tab}``        close that page
``GET  browser/mode/{profile}``     where that local bot's browser runs (cloud / local headed)
``POST browser/mode``               switch it (config backed up first; settings page confirms)

All behind the dashboard's auth gate like every plugin API. Only http(s) addresses are accepted.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


def _load(name: str, file: str):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    try:
        spec.loader.exec_module(mod)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return mod


web_view = _load("hermes_bots_plus_web_view", "web_view.py")
browser_mode = _load("hermes_bots_plus_browser_mode", "browser_mode.py")
router = APIRouter()


class ViewRequest(BaseModel):
    tab: str
    url: Optional[str] = None
    action: Optional[dict[str, Any]] = None
    width: int = 1024
    height: int = 720


@router.get("/browser/probe")
async def browser_probe(url: str, origin: Optional[str] = None) -> dict[str, Any]:
    try:
        return await web_view.probe(url, origin)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/browser/view")
async def browser_view(body: ViewRequest) -> dict[str, Any]:
    if not body.tab or len(body.tab) > 80:
        raise HTTPException(status_code=400, detail="bad tab id")
    try:
        return await web_view.VIEW.act(body.tab, body.url, body.action, body.width, body.height)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.delete("/browser/view/{tab}")
async def browser_view_close(tab: str) -> dict[str, bool]:
    await web_view.VIEW.drop(tab)
    return {"ok": True}


class ModeRequest(BaseModel):
    profile: str
    mode: str


def _mode_call(work):
    try:
        return work()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=500, detail=type(exc).__name__) from exc


@router.get("/browser/mode/{profile}")
async def browser_mode_get(profile: str) -> dict[str, Any]:
    return _mode_call(lambda: browser_mode.modes().get(profile))


@router.post("/browser/mode")
async def browser_mode_set(body: ModeRequest) -> dict[str, Any]:
    return _mode_call(lambda: browser_mode.modes().set(body.profile, body.mode))
