#!/usr/bin/env python3
"""Mock Hermes gateway for Bot Room E2E + demo captures.

Speaks the real /api/ws JSON-RPC dialect the extension expects:
  POST /api/auth/ws-ticket   -> {"ticket": ...}
  GET  /api/health           -> {"status": "ok"}
  WS   /api/ws?ticket=|?token=
       profiles.list / session.resume / session.create / session.list /
       browser.controller.register / prompt.submit / browser.controller.result

On prompt.submit each profile runs a canned "agent" that streams status +
tool events, issues browser.controller.command frames against the USER'S TAB
(the extension answers them), then completes with a reply.

Run:  uv run --with aiohttp demo/mock_gateway.py   (or: python3 with aiohttp installed)
Port: 9944
"""

import asyncio
import json
import re
import time
import uuid

from aiohttp import web

PORT = 9944

PROFILES = [
    {
        "name": "Coder",
        "display_name": "Coder",
        "ui_meta": {"color": "#5ac8fa"},
        "worker_session": None,
        "canonical_session": {"id": "canon-coder", "resolved_id": None, "last_active": 0},
    },
    {
        "name": "Muse",
        "display_name": "Muse",
        "ui_meta": {"color": "#ff6fb5"},
        "worker_session": None,
        "canonical_session": {"id": "canon-muse", "resolved_id": None, "last_active": 0},
    },
    {
        "name": "Scout",
        "display_name": "Scout",
        "ui_meta": {"color": "#8be36f"},
        "worker_session": None,
        "canonical_session": {"id": "canon-scout", "resolved_id": None, "last_active": 0},
    },
    {
        "name": "Grok",
        "display_name": "Grok",
        "ui_meta": {"color": "#e8e8ee"},
        "worker_session": None,
        "canonical_session": {"id": "canon-grok", "resolved_id": None, "last_active": 0},
    },
]

# live runtime session ids, minted on resume
LIVE = {}
# session_id -> profile name
SID_PROFILE = {}
# session_id -> websocket that "owns" it (for controller commands)
SID_WS = {}
# pending controller commands: command_id -> Future
PENDING_CMD = {}


def live_session_for(profile: str) -> str:
    key = f"live-{profile.lower()}"
    if key not in LIVE:
        LIVE[key] = f"sess-{uuid.uuid4().hex[:10]}"
    SID_PROFILE[LIVE[key]] = profile
    return LIVE[key]


def ev(type_: str, session_id: str, payload: dict) -> dict:
    return {"method": "event", "params": {"type": type_, "session_id": session_id, "payload": payload}}


async def send(ws, obj):
    try:
        await ws.send_str(json.dumps(obj))
    except Exception:
        pass


async def controller_cmd(ws, session_id: str, action: str, arguments: dict, timeout=20):
    """Issue browser.controller.command and await browser.controller.result."""
    cid = uuid.uuid4().hex[:12]
    print(f"[cmd] {action} {json.dumps(arguments)[:100]}", flush=True)
    fut = asyncio.get_event_loop().create_future()
    PENDING_CMD[cid] = fut
    await send(ws, ev("browser.controller.command", session_id,
                      {"command_id": cid, "action": action, "arguments": arguments}))
    try:
        return await asyncio.wait_for(fut, timeout)
    except asyncio.TimeoutError:
        return {"ok": False, "error": "controller command timed out"}
    finally:
        PENDING_CMD.pop(cid, None)


SNARKY = {
    "Muse": {
        "greet": "Oh we're LIVE. Watch this —",
        "done": "Did you SEE that? Iconic. Anything else, darling?",
    },
    "Coder": {
        "greet": "On it.",
        "done": "Done. Logged the page state, made the change, ready for the next one.",
    },
    "Scout": {
        "greet": "Scanning…",
        "done": "Sweep complete — page understood, action executed where applicable.",
    },
    "Grok": {
        "greet": "Based. Moving.",
        "done": "Handled. Next time ask for something with stakes.",
    },
}


async def run_agent(ws, session_id: str, profile: str, text: str):
    """The canned agent brain: status -> tools -> controller commands -> reply."""
    quips = SNARKY.get(profile, SNARKY["Coder"])
    # site-avatar prompts arrive as "[context …]\n\n<user text>" — only the
    # user portion should drive keyword behaviors, not our own preamble.
    user_text = text.split("\n\n")[-1] if text.startswith("[") else text
    low = user_text.lower()

    await send(ws, ev("status.update", session_id, {"text": "Thinking…"}))
    await asyncio.sleep(0.5)
    await send(ws, ev("message.start", session_id, {}))
    await send(ws, ev("tool.start", session_id, {"name": "browser_snapshot"}))

    snap = await controller_cmd(ws, session_id, "browser_snapshot", {})
    title = "the page"
    if snap.get("ok") and isinstance(snap.get("result"), dict):
        title = snap["result"].get("title") or title
    await send(ws, ev("status.update", session_id, {"text": f"Reading {title}…"}))
    await asyncio.sleep(0.4)

    did = []
    # --- keyword-driven demo behaviors --------------------------------------
    if any(w in low for w in ("dance", "celebr", "party")):
        await controller_cmd(ws, session_id, "mascot.perform",
                             {"action": "dance", "ms": 3000})
        did.append("danced on your page")

    if "spin" in low:
        await controller_cmd(ws, session_id, "mascot.perform", {"action": "spin", "ms": 1500})
        did.append("did a spin")

    if "hide" in low:
        m = re.search(r"hide (?:the )?(\w[\w -]{0,30})", low)
        what = m.group(1) if m else "element"
        sel = {
            "sponsor": '[data-testid="placementTracking"], aside, [class*="sponsor" i]',
            "nav": "nav",
            "header": "header",
            "footer": "footer",
            "sidebar": "aside",
            "button": "button",
        }.get(what.strip(), "aside")
        await send(ws, ev("tool.start", session_id, {"name": "browser_dom_hide"}))
        r = await controller_cmd(ws, session_id, "browser_dom_hide", {"selector": sel})
        did.append("hid it" if r.get("ok") else "tried to hide it")

    if "highlight" in low or "show me" in low:
        await send(ws, ev("tool.start", session_id, {"name": "browser_highlight"}))
        await controller_cmd(ws, session_id, "browser_highlight",
                             {"selector": "main", "ms": 1800})
        did.append("highlighted the main region")

    if any(w in low for w in ("tweet", "reply", "post", "compose", "write")):
        await send(ws, ev("tool.start", session_id, {"name": "browser_type"}))
        r = await controller_cmd(
            ws, session_id, "browser_compose",
            {"text": "bots living in the browser now. we really do be here. — sent by Bot Room",
             "mode": "append"})
        did.append("drafted a reply in the composer" if r.get("ok") else "looked for a composer")

    if "search" in low and ("youtube" in low or "video" in low):
        q = re.sub(r".*?search (?:for )?", "", user_text).strip()[:60] or "lofi beats"
        await send(ws, ev("tool.start", session_id, {"name": "web_fetch"}))
        feed = [
            {"title": f"{q.title()} — 4K result", "subtitle": "12:04 · 1.2M views",
             "image": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
             "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "badge": "HD"},
            {"title": f"Best of {q}", "subtitle": "8:31 · 640K views",
             "image": "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg",
             "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "badge": "New"},
            {"title": f"{q.title()} explained", "subtitle": "21:47 · 89K views",
             "image": "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
             "url": "https://www.youtube.com/watch?v=9bZkp7q19f0"},
        ]
        await controller_cmd(ws, session_id, "window.open",
                             {"title": f"Tube — {q}", "kind": "feed",
                              "items": feed, "size": "md"})
        did.append("opened a video feed window")

    if "window" in low or "video" in low and "feed" not in low:
        if not did or "feed" not in " ".join(did):
            await controller_cmd(ws, session_id, "window.open",
                                 {"title": "Bot Room — live pane", "kind": "thought",
                                  "text": "This is a widget window bots can open — small thought card now, "
                                          "fullscreen when you need it. Other bots dock on the side.",
                                  "size": "md"})
            did.append("opened a widget window")

    if "navigate" in low or "go to" in low:
        m = re.search(r"(?:to|navigate to) ([\w.-]+\.[a-z]{2,})", low)
        url = f"https://{m.group(1)}" if m else "https://github.com"
        await send(ws, ev("tool.start", session_id, {"name": "browser_navigate"}))
        await controller_cmd(ws, session_id, "browser_navigate", {"url": url})
        did.append(f"navigated to {url}")

    if "screenshot" in low:
        await send(ws, ev("tool.start", session_id, {"name": "browser_screenshot"}))
        r = await controller_cmd(ws, session_id, "browser_screenshot", {})
        did.append("took a screenshot" if r.get("ok") else "screenshot failed")

    # --- stream the reply ----------------------------------------------------
    action_line = f" I {', '.join(did)}." if did else ""
    reply = f"{quips['greet']} Read “{title}” — {len(str(snap.get('result') or ''))} bytes of page structure.{action_line} {quips['done']}"
    for chunk in re.findall(r"\S+\s*", reply):
        await send(ws, ev("message.delta", session_id, {"text": chunk}))
        await asyncio.sleep(0.05)
    await send(ws, ev("message.complete", session_id, {"text": reply, "error": None}))


async def handle_rpc(ws, msg):
    mid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}
    print(f"[rpc] {method} {json.dumps(params)[:120]}", flush=True)

    def result(r):
        return {"jsonrpc": "2.0", "id": mid, "result": r}

    if method == "profiles.list":
        rows = []
        for p in PROFILES:
            live = LIVE.get(f"live-{p['name'].lower()}")
            row = dict(p)
            row["canonical_session"] = dict(p["canonical_session"])
            row["canonical_session"]["resolved_id"] = live
            rows.append(row)
        return result({"profiles": rows})

    if method == "session.list":
        return result({"sessions": [{"id": v} for v in LIVE.values()]})

    if method == "session.resume":
        sid = params.get("session_id") or live_session_for(params.get("profile", "Coder"))
        LIVE.setdefault(f"live-{SID_PROFILE.get(sid, 'coder').lower()}", sid)
        SID_PROFILE[sid] = SID_PROFILE.get(sid, params.get("profile", "Coder"))
        SID_WS[sid] = ws
        return result({"session_id": sid, "resumed": True})

    if method == "session.create":
        sid = live_session_for(params.get("profile", "Coder"))
        SID_WS[sid] = ws
        return result({"session_id": sid})

    if method == "browser.controller.register":
        return result({"ok": True, "controller_id": params.get("controller_id")})

    if method == "prompt.submit":
        sid = params.get("session_id", "")
        profile = SID_PROFILE.get(sid, "Coder")
        SID_WS[sid] = ws
        asyncio.create_task(run_agent(ws, sid, profile, params.get("text", "")))
        return result({"ok": True})

    if method == "browser.controller.result":
        fut = PENDING_CMD.get(params.get("command_id"))
        if fut and not fut.done():
            fut.set_result({"ok": params.get("ok"), "result": params.get("result"),
                            "error": params.get("error")})
        return result({"ok": True})

    return {"jsonrpc": "2.0", "id": mid,
            "error": {"code": -32601, "message": f"mock: unknown method {method}"}}


async def ws_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    async for m in ws:
        if m.type == web.WSMsgType.TEXT:
            try:
                msg = json.loads(m.data)
            except Exception:
                continue
            if isinstance(msg, dict):
                res = await handle_rpc(ws, msg)
                if res is not None:
                    await send(ws, res)
    return ws


async def health(_):
    return web.json_response({"status": "ok"})


async def ticket(request):
    # any bearer credential mints a single-use ticket in the mock
    return web.json_response({"ticket": f"mock-ticket-{uuid.uuid4().hex[:8]}"})


app = web.Application()
app.router.add_get("/api/health", health)
app.router.add_post("/api/auth/ws-ticket", ticket)
app.router.add_get("/api/ws", ws_handler)

if __name__ == "__main__":
    print(f"mock hermes gateway on http://localhost:{PORT}  (profiles: "
          + ", ".join(p["name"] for p in PROFILES) + ")")
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)
