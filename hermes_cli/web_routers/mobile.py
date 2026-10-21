"""Mobile companion (roadmap #45): a paired phone's minimal read/approve surface.

``GET /mobile`` serves the paired web client — a single self-contained page.
Pairing is a short-lived numeric code: an operator mints one through
``POST /api/mobile/pairing`` (authed like every other ``/api`` route), the phone
exchanges it at the public, code-gated ``POST /api/mobile/pair`` for the
dashboard session token, then calls the REST surface with
``Authorization: Bearer``. On OAuth-gated deployments (``auth_required``)
pairing refuses — the phone signs in through the normal dashboard login and the
page rides the cookie session instead.

The data surface is deliberately narrow — live session status, pending
approvals/clarifies, quick replies — reaching in-process ``tui_gateway``
handlers via ``handle_request`` directly, never ``dispatch``/``bind_transport``:
an RPC without a real client socket must not rebind a live session's event
stream onto the stdio fallback.
"""

from __future__ import annotations

import hmac
import logging
import secrets
import threading
import time
import uuid
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from starlette.concurrency import run_in_threadpool

from hermes_cli.web_models import MobilePairExchange, MobileReply, MobileRespond

log = logging.getLogger(__name__)

router = APIRouter()

# Pairing codes are single-use, short-lived, and rate-limited on failure:
# ``/api/mobile/pair`` is on the PUBLIC_API_PATHS allowlist (an unpaired phone
# cannot authenticate yet), so the code itself is the credential-issuance
# boundary.
_PAIRING_TTL_SECONDS = 600.0
_PAIRING_CODE_DIGITS = 6
_PAIRING_MAX_OUTSTANDING = 8
_PAIRING_FAIL_LIMIT = 5
_PAIRING_LOCKOUT_SECONDS = 60.0

_pairing_lock = threading.Lock()
_pairing_codes: dict[str, float] = {}  # code -> expiry epoch
_pairing_failures = 0
_pairing_lockout_until = 0.0

_REQUEST_VALUE_MAX_CHARS = 800
_REPLY_MAX_CHARS = 20_000
_SUMMARY_KEYS = ("command", "description", "question", "message", "prompt", "title")


def _session_token() -> str:
    """Read ``web_server._SESSION_TOKEN`` at call time (tests monkeypatch it there)."""
    import hermes_cli.web_server as ws
    return str(getattr(ws, "_SESSION_TOKEN", "") or "")


def _oauth_gated(request: Request) -> bool:
    return bool(getattr(request.app.state, "auth_required", False))


def _gateway_rpc(method: str, params: dict) -> dict:
    """Call an in-process ``tui_gateway`` RPC handler synchronously.

    NOT ``rpc_dispatch.dispatch``: dispatch binds the stdio transport for
    transport-less callers and session-scoped handlers (``prompt.submit``)
    would rebind a live session's event stream onto it. ``handle_request``
    returns the response frame directly and leaves transports alone.
    """
    from tui_gateway import rpc_dispatch

    frame = rpc_dispatch.handle_request(
        {"jsonrpc": "2.0", "id": f"mobile-{uuid.uuid4().hex[:8]}",
         "method": method, "params": params})
    if not isinstance(frame, dict):
        raise HTTPException(status_code=502, detail="Gateway did not answer")
    err = frame.get("error")
    if isinstance(err, dict):
        code = err.get("code")
        status = 404 if code == 4001 else (409 if code == 4090 else 400)
        raise HTTPException(status_code=status, detail=str(err.get("message") or "Gateway error"))
    result = frame.get("result")
    return result if isinstance(result, dict) else {}


def _stored_title(profile: Optional[str], session_key: str) -> str:
    """Title for a live session's durable row; "" on any lookup failure (never fail the overview)."""
    if not session_key:
        return ""
    try:
        import tui_gateway.server as gateway
        params = {"profile": profile} if profile else {}
        with gateway._profile_db(params) as db:
            row = db.get_session(session_key) if db is not None else None
            return str(row.get("title") or "") if isinstance(row, dict) else ""
    except Exception:
        return ""


def _trim_request(req: dict) -> dict:
    """Wire view of an open server→client request: the fields a phone needs to
    decide, each string capped so a blob param cannot bloat a 4s poll."""
    params = req.get("params") if isinstance(req.get("params"), dict) else {}
    out: dict[str, Any] = {
        "id": req.get("id"),
        "method": req.get("method"),
        "session_id": params.get("session_id"),
    }
    for key in _SUMMARY_KEYS:
        value = params.get(key)
        if isinstance(value, str) and value.strip():
            out["summary"] = value[:_REQUEST_VALUE_MAX_CHARS]
            break
    if isinstance(params.get("choices"), list):
        out["choices"] = [str(c)[:100] for c in params["choices"][:8]]
    if params.get("allow_permanent") is False:
        out["allow_permanent"] = False
    if isinstance(params.get("questions"), list):
        questions = []
        for q in params["questions"][:16]:
            if not isinstance(q, dict):
                continue
            entry: dict[str, Any] = {
                "qid": str(q.get("qid") or ""),
                "question": str(q.get("question") or "")[:_REQUEST_VALUE_MAX_CHARS],
            }
            if isinstance(q.get("choices"), list):
                entry["choices"] = [str(c)[:100] for c in q["choices"][:8]]
            if q.get("multi_select"):
                entry["multi_select"] = True
            questions.append(entry)
        out["questions"] = questions
    return out


def _overview_sessions() -> list[dict]:
    """Live sessions with their pending requests, needs-you first."""
    import tui_gateway.server as gateway
    from tui_gateway import server_requests
    from hermes_constants import profile_name_for_home

    with gateway._sessions_lock:
        live = list(gateway._sessions.items())
    rows = []
    for sid, sess in live:
        profile = profile_name_for_home(sess.get("profile_home")) or ""
        session_key = str(sess.get("session_key") or "")
        rows.append({
            "session_id": sid,
            "session_key": session_key,
            "title": _stored_title(profile, session_key),
            "profile": profile,
            "running": bool(sess.get("running")),
            "cwd": str(sess.get("cwd") or ""),
            "source": str(sess.get("source") or ""),
            "last_active": float(sess.get("last_active") or 0),
            "pending": server_requests.pending_kind(sid),
            "requests": [_trim_request(r) for r in server_requests.open_requests(sid)],
        })
    rows.sort(key=lambda s: (not s["pending"], not s["running"], -s["last_active"]))
    return rows


# ── pairing ─────────────────────────────────────────────────────────────────


def _prune_codes(now: float) -> None:
    for code in [c for c, exp in _pairing_codes.items() if exp <= now]:
        _pairing_codes.pop(code, None)


@router.post("/api/mobile/pairing")
async def mint_pairing_code(request: Request):
    """Mint a short-lived pairing code. Operator-side call (authed /api route)."""
    if _oauth_gated(request):
        raise HTTPException(
            status_code=409,
            detail="This backend uses OAuth sign-in — open /mobile on the phone and sign in there instead")
    now = time.time()
    with _pairing_lock:
        _prune_codes(now)
        while len(_pairing_codes) >= _PAIRING_MAX_OUTSTANDING:
            oldest = min(_pairing_codes, key=lambda c: _pairing_codes[c])
            _pairing_codes.pop(oldest, None)
        code = f"{secrets.randbelow(10 ** _PAIRING_CODE_DIGITS):0{_PAIRING_CODE_DIGITS}d}"
        _pairing_codes[code] = now + _PAIRING_TTL_SECONDS
    return {"code": code, "expires_in": int(_PAIRING_TTL_SECONDS), "page": "/mobile"}


@router.post("/api/mobile/pair")
async def pair_mobile(body: MobilePairExchange, request: Request):
    """Exchange a valid pairing code for the dashboard session token.

    Public (see ``PUBLIC_API_PATHS``): the phone has no credential until this
    call succeeds. Codes are single-use, expire in minutes, and repeated misses
    lock the endpoint briefly."""
    global _pairing_failures, _pairing_lockout_until
    if _oauth_gated(request):
        raise HTTPException(
            status_code=409,
            detail="This backend uses OAuth sign-in — open /mobile and sign in there instead")
    code = (body.code or "").strip()
    now = time.time()
    with _pairing_lock:
        if now < _pairing_lockout_until:
            raise HTTPException(status_code=429, detail="Too many attempts; wait a minute and mint a new code")
        expires = _pairing_codes.pop(code, None)  # single-use, whether it was valid or not
        if expires is None or now > expires:
            _pairing_failures += 1
            if _pairing_failures >= _PAIRING_FAIL_LIMIT:
                _pairing_failures = 0
                _pairing_lockout_until = now + _PAIRING_LOCKOUT_SECONDS
            raise HTTPException(status_code=403, detail="Invalid or expired pairing code")
        _pairing_failures = 0
        token = _session_token()
    if not token:
        raise HTTPException(status_code=503, detail="Token auth is not active on this backend")
    return {"token": token}


# ── status / approvals / replies ────────────────────────────────────────────


@router.get("/api/mobile/overview")
async def mobile_overview():
    return {"sessions": await run_in_threadpool(_overview_sessions), "generated_at": time.time()}


@router.post("/api/mobile/respond")
async def mobile_respond(body: MobileRespond):
    """Answer an open server→client request (approval / clarify / sudo / …) as a
    proxied response frame — the same seam ``request.answer`` serves room windows."""
    request_id = (body.request_id or "").strip()
    if not request_id or not isinstance(body.result, dict):
        raise HTTPException(status_code=400, detail="request_id and an object result are required")
    result = await run_in_threadpool(
        _gateway_rpc, "request.answer", {"id": request_id, "result": body.result})
    return {"status": result.get("status", "ok")}


@router.post("/api/mobile/reply")
async def mobile_reply(body: MobileReply):
    """Quick reply to a session — a real ``prompt.submit`` turn (queues when the
    session is busy)."""
    sid = (body.session_id or "").strip()
    text = (body.text or "").strip()
    if not sid or not text:
        raise HTTPException(status_code=400, detail="session_id and text are required")
    if len(text) > _REPLY_MAX_CHARS:
        raise HTTPException(status_code=413, detail=f"Reply exceeds {_REPLY_MAX_CHARS} characters")
    return await run_in_threadpool(_gateway_rpc, "prompt.submit", {"session_id": sid, "text": text})


@router.get("/mobile", include_in_schema=False)
async def mobile_page():
    """The paired web client. Static shell only — every data call goes through
    the authed ``/api/mobile/*`` surface, so the page itself carries no secrets."""
    return HTMLResponse(_MOBILE_PAGE)


_MOBILE_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Hermes — mobile companion</title>
<style>
  :root { color-scheme: dark; --bg:#0c0d10; --card:#15171c; --line:#262a33; --fg:#e8eaf0;
          --mut:#8a90a0; --acc:#5b8cff; --ok:#34c77b; --warn:#e0a93e; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.45 system-ui,-apple-system,sans-serif; }
  main { max-width:44rem; margin:0 auto; padding:1rem; }
  h1 { font-size:1.05rem; font-weight:600; margin:.25rem 0 1rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:.85rem; margin-bottom:.75rem; }
  .row { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
  .grow { flex:1; min-width:0; }
  .mut { color:var(--mut); font-size:.8rem; }
  .pill { border:1px solid var(--line); border-radius:99px; padding:.05rem .5rem; font-size:.72rem; color:var(--mut); }
  .pill.wait { color:var(--warn); border-color:var(--warn); }
  .pill.run { color:var(--ok); border-color:var(--ok); }
  input[type=text], textarea, input[type=password] { width:100%; background:var(--bg); color:var(--fg);
     border:1px solid var(--line); border-radius:8px; padding:.55rem .65rem; font:inherit; font-size:.9rem; }
  button { background:var(--acc); color:#fff; border:0; border-radius:8px; padding:.5rem .8rem; font:inherit;
     font-size:.85rem; font-weight:600; cursor:pointer; }
  button.sec { background:transparent; border:1px solid var(--line); color:var(--fg); }
  button.deny { background:transparent; border:1px solid var(--warn); color:var(--warn); }
  button:disabled { opacity:.5; cursor:default; }
  .req { border-top:1px solid var(--line); margin-top:.6rem; padding-top:.6rem; }
  .req .sum { font-size:.85rem; white-space:pre-wrap; word-break:break-word; }
  .btns { display:flex; gap:.4rem; margin-top:.5rem; flex-wrap:wrap; }
  .err { color:#e06a6a; font-size:.8rem; margin-top:.4rem; }
  code { font-size:.8rem; }
</style>
</head>
<body>
<main>
  <h1>Hermes companion</h1>
  <div id="pair" class="card" hidden>
    <div class="mut">Enter the pairing code shown in the desktop app (Webhooks &rarr; Pair a phone),
      or sign in first if this deployment uses OAuth.</div>
    <div class="row" style="margin-top:.6rem">
      <input id="code" class="grow" type="text" inputmode="numeric" maxlength="6" placeholder="6-digit code">
      <button id="pairBtn">Pair</button>
    </div>
    <div id="pairErr" class="err"></div>
  </div>
  <div id="list"></div>
  <div class="mut" id="status"></div>
</main>
<script>
const API = {
  overview: '/api/mobile/overview',
  pair: '/api/mobile/pair',
  respond: '/api/mobile/respond',
  reply: '/api/mobile/reply'
};
let token = new URLSearchParams(location.hash.slice(1)).get('token')
  || sessionStorage.getItem('hermesMobileToken') || '';
if (token) sessionStorage.setItem('hermesMobileToken', token);
if (location.hash) history.replaceState(null, '', location.pathname);

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function call(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: Object.assign({'Content-Type': 'application/json'},
      token ? {Authorization: 'Bearer ' + token} : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 401) { token = ''; sessionStorage.removeItem('hermesMobileToken'); showPair('Session expired — pair again.'); throw new Error('unauthorized'); }
  if (!res.ok) {
    let msg = res.status;
    try { msg = (await res.json()).detail || msg; } catch (e) {}
    throw new Error(String(msg));
  }
  return res.json();
}

function showPair(msg) {
  $('pair').hidden = false;
  if (msg) $('pairErr').textContent = msg;
}

async function doPair() {
  const code = $('code').value.trim();
  $('pairErr').textContent = '';
  try {
    const r = await call(API.pair, {code});
    token = r.token;
    sessionStorage.setItem('hermesMobileToken', token);
    $('pair').hidden = true;
    refresh();
  } catch (e) {
    $('pairErr').textContent = e.message;
  }
}

async function respond(requestId, result) {
  await call(API.respond, {request_id: requestId, result});
  await refresh();
}

async function sendReply(sid) {
  const el = document.getElementById('reply-' + sid);
  const text = (el.value || '').trim();
  if (!text) return;
  el.value = '';
  await call(API.reply, {session_id: sid, text});
  await refresh();
}

function reqCard(r) {
  const m = esc(r.method || '');
  let inner = '<div class="req"><div class="mut">' + m + '</div>';
  if (r.summary) inner += '<div class="sum">' + esc(r.summary) + '</div>';
  if (r.method === 'approval') {
    const choices = (r.choices && r.choices.length ? r.choices : ['once', 'deny']);
    inner += '<div class="btns">' + choices.map(c =>
      '<button class="' + (c === 'deny' ? 'deny' : 'sec') + '" data-act="choice" data-id="' + esc(r.id) +
      '" data-choice="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>';
  } else if (r.method === 'clarify') {
    const qs = r.questions && r.questions.length ? r.questions : [{qid: '', question: r.summary || ''}];
    inner += qs.map(q =>
      '<div class="mut" style="margin-top:.4rem">' + esc(q.question || '') + '</div>' +
      '<input type="text" id="q-' + esc(r.id) + '-' + esc(q.qid) + '" placeholder="Answer">').join('') +
      '<div class="btns"><button data-act="clarify" data-id="' + esc(r.id) + '">Send answers</button></div>';
  } else {
    inner += '<input type="text" id="raw-' + esc(r.id) + '" placeholder=\'Result JSON, e.g. {"answer":"yes"}\'>' +
      '<div class="btns"><button class="sec" data-act="raw" data-id="' + esc(r.id) + '">Send</button></div>';
  }
  return inner + '</div>';
}

async function refresh() {
  if (!token) { showPair(); return; }
  try {
    const d = await call(API.overview);
    const list = $('list');
    if (!d.sessions.length) {
      list.innerHTML = '<div class="card mut">No live sessions on this backend.</div>';
    } else {
      list.innerHTML = d.sessions.map(s => {
        const state = s.pending
          ? '<span class="pill wait">waiting</span>'
          : (s.running ? '<span class="pill run">running</span>' : '<span class="pill">idle</span>');
        const reqs = (s.requests || []).map(reqCard).join('');
        return '<div class="card"><div class="row"><div class="grow"><b>' + esc(s.title || s.session_key || s.session_id) +
          '</b> <span class="mut">' + esc(s.profile || '') + '</span></div>' + state + '</div>' + reqs +
          '<div class="row" style="margin-top:.6rem"><input class="grow" type="text" id="reply-' + esc(s.session_id) +
          '" placeholder="Quick reply"><button class="sec" data-act="reply" data-id="' + esc(s.session_id) + '">Send</button></div></div>';
      }).join('');
    }
    $('status').textContent = 'Updated ' + new Date(d.generated_at * 1000).toLocaleTimeString();
  } catch (e) {
    if (e.message !== 'unauthorized') $('status').textContent = String(e.message);
  }
}

document.addEventListener('click', async ev => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  try {
    if (b.dataset.act === 'choice') {
      await respond(b.dataset.id, {choice: b.dataset.choice});
    } else if (b.dataset.act === 'clarify') {
      const answers = {};
      document.querySelectorAll('[id^="q-' + b.dataset.id + '-"]').forEach(el => {
        const qid = el.id.slice(b.dataset.id.length + 3);
        if (qid) answers[qid] = el.value;
      });
      await respond(b.dataset.id, Object.keys(answers).length ? {answers}
        : {answer: document.getElementById('q-' + b.dataset.id + '-')?.value || ''});
    } else if (b.dataset.act === 'raw') {
      const raw = document.getElementById('raw-' + b.dataset.id).value.trim();
      await respond(b.dataset.id, raw ? JSON.parse(raw) : {});
    } else if (b.dataset.act === 'reply') {
      await sendReply(b.dataset.id);
    }
  } catch (e) {
    $('status').textContent = String(e.message);
  }
});
$('pairBtn').addEventListener('click', doPair);
refresh();
setInterval(refresh, 4000);
</script>
</body>
</html>
"""


def _reset_for_tests() -> None:
    global _pairing_failures, _pairing_lockout_until
    with _pairing_lock:
        _pairing_codes.clear()
        _pairing_failures = 0
        _pairing_lockout_until = 0.0
