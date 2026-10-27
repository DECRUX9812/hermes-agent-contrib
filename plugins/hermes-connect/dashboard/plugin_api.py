"""Onboarding connection routes (hermes-connect plugin), mounted at ``/api/plugins/hermes-connect/``.

GitHub routes run wherever the dashboard API does, behind its auth gate. The tunnel decides what
this machine exposes, so its routes carry Web Access's own guard
(:func:`hermes_cli.web_routers.webapp_access.owner_on_this_machine`: native Desktop on this computer
only, on the gateway's listener) and the ``web_access`` surface gate, exactly as they did in core.
Starting a tunnel turns on Web Access in its ``public`` mode with the tunnel's address, so the Nous
sign-in gate is engaged before the address is used; stopping it turns Web Access off.
"""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from hermes_cli.web_routers import webapp_access as access_routes
from hermes_cli.web_server_surface import route_on


def _load_connect():
    name = "hermes_connect_setup"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name("connect.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # before exec: @dataclass resolves its module by name
    try:
        spec.loader.exec_module(mod)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return mod


setup_connect = _load_connect()

router = APIRouter()
tunnel_router = APIRouter(dependencies=[Depends(access_routes.owner_on_this_machine)])


async def _run(fn, *args, **kwargs):
    try:
        return await asyncio.to_thread(fn, *args, **kwargs)
    except setup_connect.SetupConnectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/github")
async def github_status():
    return await _run(setup_connect.github_status)


@router.post("/github/login")
async def github_login_start():
    return await _run(setup_connect.github_login_start)


@router.delete("/github/login")
async def github_login_cancel():
    await _run(setup_connect.github_login_cancel)
    return {"ok": True}


def _pinned_and_port() -> tuple[str, int]:
    from gateway.webapp_listener import webapp_settings
    from hermes_cli.webapp_access import gateway_home

    settings = webapp_settings(gateway_home())
    return settings.public_url or "", settings.port


@tunnel_router.get("/tunnel")
async def tunnel_status(profile: Optional[str] = None):
    def _status(_gateway):
        pinned, _port = _pinned_and_port()
        return setup_connect.tunnel_status(pinned)

    try:
        return await access_routes._scoped(profile, _status)
    except setup_connect.SetupConnectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@tunnel_router.post("/tunnel/start")
async def tunnel_start(profile: Optional[str] = None):
    """Start the tunnel, then Web Access on its address (Web Access refuses without a Nous account,
    and then the tunnel is stopped again rather than left forwarding to an ungated Webapp)."""
    def _start(_gateway):
        _pinned, port = _pinned_and_port()
        return setup_connect.tunnel_start(port)

    try:
        tunnel = await access_routes._scoped(profile, _start)
    except setup_connect.SetupConnectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        access = await access_routes.start_webapp_access(
            access_routes.StartBody(mode="public", public_url=tunnel["url"]), profile)
    except BaseException:
        await access_routes._scoped(profile, lambda _gateway: setup_connect.tunnel_stop())
        raise
    return {"tunnel": tunnel, "access": access}


@tunnel_router.post("/tunnel/stop")
async def tunnel_stop(profile: Optional[str] = None):
    await access_routes._scoped(profile, lambda _gateway: setup_connect.tunnel_stop())
    access = await access_routes.stop_webapp_access(profile)
    return {"tunnel": {"running": False, "url": None}, "access": access}


router.include_router(tunnel_router, dependencies=[Depends(route_on("web_access"))])
