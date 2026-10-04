"""Revocable read-only share grants for a single session's transcript.

A grant is a capability token bound to ``(profile home, session_id)``: the
public share route resolves ``(profile, token)`` to that row, then reads the
session's transcript read-only. Grants persist in ``<home>/share_grants.json``
(0600) so a server restart keeps links alive; the file stores only the token's
SHA-256 plus a display suffix, so a leaked grants file is not a session oracle.

The raw token is returned exactly once — at mint — like a deploy key: the owner
copies the URL then; ``list_shares`` only ever returns the suffix for revocation.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

_GRANTS_FILENAME = "share_grants.json"
DEFAULT_TTL_SECONDS = 7 * 24 * 3600
_MAX_ACTIVE_PER_SESSION = 32
_PREVIEW_CHARS = 6


def _grants_path(home: str | Path) -> Path:
    return Path(home) / _GRANTS_FILENAME


def _load(home: str | Path) -> dict[str, Any]:
    path = _grants_path(home)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "grants": []}
    if not isinstance(data, dict) or not isinstance(data.get("grants"), list):
        return {"version": 1, "grants": []}
    return data


def _save(home: str | Path, data: dict[str, Any]) -> None:
    path = _grants_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".share_grants-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _find(data: dict[str, Any], token: str) -> Optional[dict[str, Any]]:
    hashed = _token_hash(token)
    for grant in data["grants"]:
        if grant.get("token_hash") == hashed:
            return grant
    return None


def _active(grant: dict[str, Any], now: float) -> bool:
    return not grant.get("revoked") and (grant.get("expires_at") is None or grant["expires_at"] > now)


def mint_share(session_id: str, home: str | Path,
               ttl_seconds: Optional[float] = None) -> dict[str, Any]:
    """Mint a grant. Returns ``{token, expires_at}`` — the token exists nowhere
    else; callers show the share URL once."""
    data = _load(home)
    now = time.time()
    live = [g for g in data["grants"] if g.get("session_id") == session_id and _active(g, now)]
    if len(live) >= _MAX_ACTIVE_PER_SESSION:
        raise ValueError(f"share cap reached for this session ({_MAX_ACTIVE_PER_SESSION} active links)")

    token = secrets.token_urlsafe(32)
    expires_at = None if ttl_seconds is None else now + max(60.0, float(ttl_seconds))
    data["grants"].append({
        "session_id": session_id,
        "token_hash": _token_hash(token),
        "token_preview": token[-_PREVIEW_CHARS:],
        "created_at": now,
        "expires_at": expires_at,
        "revoked": False,
    })
    _save(home, data)
    return {"token": token, "expires_at": expires_at}


def revoke_share(token: str, home: str | Path) -> bool:
    data = _load(home)
    grant = _find(data, token)
    if grant is None or grant.get("revoked"):
        return False
    grant["revoked"] = True
    _save(home, data)
    return True


def list_shares(session_id: str, home: str | Path) -> list[dict[str, Any]]:
    now = time.time()
    return [
        {"token_preview": g.get("token_preview", ""),
         "created_at": g.get("created_at"),
         "expires_at": g.get("expires_at"),
         "revoked": bool(g.get("revoked")),
         "expired": not _active(g, now) and not g.get("revoked")}
        for g in _load(home)["grants"]
        if g.get("session_id") == session_id
    ]


def resolve_share(token: str, home: str | Path) -> Optional[dict[str, Any]]:
    """``{session_id}`` when the token names a live grant under *home*, else None."""
    if not token or len(token) < 32:
        return None
    grant = _find(_load(home), token)
    if grant is None or not _active(grant, time.time()):
        return None
    return {"session_id": grant["session_id"]}
