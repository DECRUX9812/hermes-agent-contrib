"""Session share links — a revocable, read-only live view of one session.

Two surfaces:

- ``/api/share/create|revoke|list`` — owner operations, behind the normal
  session-token/dash-auth gate like every other ``/api`` route.
- ``GET /share/view`` + ``GET /api/share/view`` — the PUBLIC read path,
  self-secured by the capability token (the ``/api/cron/fire`` pattern, not the
  session token): the token resolves to a ``(profile home, session_id)`` grant,
  after which the transcript is read through a read-only SessionDB handle.
  ``/share/view`` sits outside ``/api/`` so the loopback token middleware skips
  it, and ``/share`` is allowlisted in the OAuth gate's public prefixes so a
  shared link opens for an unauthenticated viewer.

The events payload is deliberately narrow: user/assistant text plus tool-call
NAMES only — no tool arguments, no tool results, no system rows — so a leaked
link exposes a transcript, not the session's working data.
"""

import json
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

from hermes_cli import share_grants
from hermes_cli.web_deps import late
from hermes_cli.web_models import ShareCreateBody, ShareRevokeBody

router = APIRouter()

# Late-bound: the sessions router's seams stay monkeypatchable in tests.
_cron_profile_home = late("_cron_profile_home", "hermes_cli.web_server_cron")
_cron_default_profile = late("_cron_default_profile", "hermes_cli.web_server_cron")
_open_session_db_for_profile = late("_open_session_db_for_profile", "hermes_cli.web_server_sessions")

_LIVE_WINDOW_S = 300
_PAGE_LIMIT = 400          # transcript rows returned per poll
_TEXT_MAX_CHARS = 200_000  # per-message text bound, defense-in-depth


def _profile_home(profile: Optional[str]) -> tuple[str, object]:
    """``(name, home)`` for a profile argument — same rule as the session-db
    path: an explicit name resolves through the profiles tree; absent means the
    SERVING home (the launch process's own state.db parent), which may be a
    named profile or a custom HERMES_HOME under pooled backends."""
    if profile:
        name, home = _cron_profile_home(profile)
        return name, home
    from hermes_state import _default_db_path
    return _cron_default_profile(), Path(_default_db_path()).parent


def _resolve_grant(profile: str, token: str) -> tuple[str, str, dict]:
    """Profile name + token → ``(profile, home, grant)`` or a 404 (a dead link
    and a never-minted one are indistinguishable to a crawler). ``profile`` is
    empty for the serving home — never substitute the literal "default", which
    is a different home under a named-profile launch."""
    try:
        name, home = _profile_home(profile or None)
    except Exception:
        raise HTTPException(status_code=404, detail="share link not found")
    grant = share_grants.resolve_share(token, home)
    if grant is None:
        raise HTTPException(status_code=404, detail="share link not found")
    return name, home, grant


# ── owner operations (token-gated like the rest of /api) ──────────────────────


@router.post("/api/share/create")
def share_create(body: ShareCreateBody, request: Request):
    name, home = _profile_home(body.profile)
    db = _open_session_db_for_profile(body.profile, read_only=True)
    try:
        exists = db.get_session(body.session_id) is not None
    finally:
        db.close()
    if not exists:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        minted = share_grants.mint_share(body.session_id, home, body.ttl_seconds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    # p= is omitted for the serving home: under a named-profile launch "default"
    # is a different home than this process's, and the grant lives in the latter.
    query = f"t={minted['token']}" if not body.profile else f"p={name}&t={minted['token']}"
    path = f"/share/view?{query}"
    return {"token": minted["token"], "expires_at": minted["expires_at"],
            "profile": name, "path": path,
            # The origin the caller actually reached us on — a remote gateway's
            # share URL must point at that host, not a guessed loopback one.
            "url": f"{str(request.base_url).rstrip('/')}{path}"}


@router.post("/api/share/revoke")
def share_revoke(body: ShareRevokeBody):
    _name, home = _profile_home(body.profile)
    return {"revoked": share_grants.revoke_share(body.token, home)}


@router.get("/api/share/list")
def share_list(session_id: str, profile: Optional[str] = None):
    _name, home = _profile_home(profile)
    return {"shares": share_grants.list_shares(session_id, home)}


# ── public read path (capability-token self-secured) ─────────────────────────


def _sanitize_row(row: dict) -> Optional[dict]:
    """One message row → a share event, or None to skip it (system/tool rows)."""
    role = row.get("role")
    if role not in ("user", "assistant"):
        return None
    text = row.get("content")
    if not isinstance(text, str):
        text = json.dumps(text, ensure_ascii=False)[:_TEXT_MAX_CHARS] if text else ""
    tools = []
    raw_calls = row.get("tool_calls")
    if isinstance(raw_calls, str):
        try:
            raw_calls = json.loads(raw_calls)
        except json.JSONDecodeError:
            raw_calls = None
    for call in raw_calls or []:
        name = call.get("name") or (call.get("function") or {}).get("name")
        if name:
            tools.append(str(name))
    return {"id": row.get("id"), "role": role, "text": text[:_TEXT_MAX_CHARS],
            "tools": tools, "timestamp": row.get("timestamp")}


@router.get("/api/share/view")
def share_view(p: str = Query(""), t: str = Query(""), after_id: int = Query(0, ge=0)):
    """Public, capability-secured transcript read (PUBLIC_API_PATHS)."""
    _name, _home, grant = _resolve_grant(p, t)
    session_id = grant["session_id"]

    db = _open_session_db_for_profile(p or None, read_only=True)
    try:
        session = db.get_session(session_id) or {}
        rows = db.get_messages(session_id, after_id=after_id, limit=_PAGE_LIMIT)
    finally:
        db.close()

    events = [e for e in (_sanitize_row(r) for r in rows) if e is not None]
    now = time.time()
    live = (session.get("ended_at") is None
            and (now - (session.get("last_activity_at") or session.get("started_at") or 0)) < _LIVE_WINDOW_S)
    return JSONResponse(
        {"title": session.get("title") or "Shared session",
         "live": live, "model": session.get("model") or "",
         "events": events, "next_after_id": events[-1]["id"] if events else after_id},
        headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})


_VIEWER_HTML = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Hermes — shared session</title>
<style>
  :root{color-scheme:dark;--bg:#0b0d10;--fg:#e8eaed;--dim:#8b95a1;--line:#22272e;--accent:#5eb1ef}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);
  font:14px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);
  padding:10px 16px;display:flex;gap:8px;align-items:center}
  #live{width:8px;height:8px;border-radius:50%;background:#3f4;box-shadow:0 0 6px #3f4}
  #live.off{background:#555;box-shadow:none}
  main{max-width:760px;margin:0 auto;padding:16px}
  .m{margin:10px 0;padding:10px 14px;border-radius:12px;max-width:92%;white-space:pre-wrap;
  overflow-wrap:anywhere}
  .user{background:#1c2733;margin-left:auto}
  .assistant{background:#14181d;border:1px solid var(--line)}
  .tool{color:var(--dim);font-size:12px;margin:2px 0 2px 14px}
  .tool::before{content:"⚙ ";color:var(--accent)}
  #err{color:#f66;text-align:center;margin-top:40px}
  footer{color:var(--dim);font-size:11px;text-align:center;padding:24px}
</style></head><body>
<header><span id="live" class="off"></span><strong id="title">Hermes — shared session</strong>
<span style="margin-left:auto;color:var(--dim);font-size:11px" id="model"></span></header>
<main id="chat"></main><div id="err"></div>
<footer>Read-only live view · shared via Hermes</footer>
<script>
const P = new URLSearchParams(location.search).get('p') || 'default';
const T = new URLSearchParams(location.search).get('t') || '';
const chat = document.getElementById('chat'), err = document.getElementById('err');
let after = 0, dead = false;
const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
function render(ev){
  const div = document.createElement('div');
  div.className = 'm ' + ev.role;
  div.innerHTML = esc(ev.text || '');
  chat.appendChild(div);
  for (const name of ev.tools || []){
    const t = document.createElement('div');
    t.className = 'tool'; t.textContent = name; chat.appendChild(t);
  }
}
async function poll(){
  if (dead) return;
  try {
    const r = await fetch(`/api/share/view?p=${encodeURIComponent(P)}&t=${encodeURIComponent(T)}&after_id=${after}`);
    if (r.status === 404){ dead = true; err.textContent = 'This share link was revoked or expired.'; document.getElementById('live').className = 'off'; return; }
    const d = await r.json();
    document.getElementById('title').textContent = d.title || 'Shared session';
    document.getElementById('model').textContent = d.model || '';
    document.getElementById('live').className = d.live ? '' : 'off';
    const grow = d.events && d.events.length;
    for (const ev of d.events || []) render(ev);
    after = d.next_after_id || after;
    if (grow) scrollTo(0, document.body.scrollHeight);
  } catch(e) {}
  setTimeout(poll, 2500);
}
poll();
</script></body></html>"""


@router.get("/share/view", response_class=HTMLResponse)
def share_viewer_page(p: str = Query(""), t: str = Query("")):
    """The public viewer document — validates the grant before serving so a dead
    link shows the same 404 as the events endpoint."""
    _resolve_grant(p, t)
    return HTMLResponse(_VIEWER_HTML, headers={"Cache-Control": "no-store",
                                             "X-Robots-Tag": "noindex"})
