import { atom } from 'nanostores'

import { routeSessionId } from '@/app/routes'

import { registryConnectionKind } from './connection-registry-state'
import { dialedGatewayModeFor } from './gateway'
import { normalizeProfileKey } from './profile'
import {
  isSessionOwnerRoute,
  type SessionOwnerScope
} from './session-request-router'
import { $sessionStates } from './session-states-live'


// ---------------------------------------------------------------------------
// Event-source scopes: which registry connection's socket delivered a runtime
// session's events. Working/attention membership alone is profile-blind — two
// connected gateways can both expose a 'default' profile, so the gateway
// keep-set (pruneSecondaryGateways) must key live work by the composite
// (connectionId, profile) scope, not the bare profile name. Recorded at
// event fan-in (use-gateway-boot); local/primary events carry no connectionId
// and record nothing, so single-source behavior is untouched.
// ---------------------------------------------------------------------------

export const sessionScopeByRuntimeId = new Map<string, string>()


// Structured twin of the scope ledger: inbound events can carry either an
// exact (connectionId, profile) owner or a producer-proven profile-only pool
// owner. Consumed as the LAST rung of knownOwnerForSession so a runtime whose
// event source already proved its owner can still route session-scoped RPCs
// (approval.respond) when every durable binding (tile / hint / row) is absent
// — while durable stored identity keeps outranking it (#97511).
export const sessionOwnerByRuntimeId = new Map<string, SessionOwnerScope>()


/** The owner an inbound runtime EVENT proved for `sessionId` (#97511): the
 *  exact (connectionId, profile) of the socket that delivered its events, or
 *  the bare profile of a legacy profile-only pool. Exported so the session-scoped
 *  RPC ladder can consult it WITHOUT the connection-blind profile rung
 *  preempting it (see knownOwnerForSession). */
export function runtimeSessionOwner(sessionId: null | string | undefined): SessionOwnerScope {
  const id = String(sessionId ?? '').trim()

  return id ? sessionOwnerByRuntimeId.get(id) : undefined
}


/** Forget only profile-pool runtime owners during permanent LOCAL profile
 * teardown. These string routes came exclusively from the legacy secondary
 * producer; exact connection descriptors must survive a same-named remote
 * profile's local delete/rename. */
export function forgetProfileOnlyRuntimeOwners(profile: string): void {
  const retired = normalizeProfileKey(profile)

  for (const [runtimeId, owner] of sessionOwnerByRuntimeId) {
    if (typeof owner === 'string' && normalizeProfileKey(owner) === retired) {
      sessionOwnerByRuntimeId.delete(runtimeId)
    }
  }
}


/** Composite scopes of registry-sourced sessions that are live (busy or
 * waiting on input) — the (connectionId, profile) half of the gateway
 * keep-set. Local-source live work keeps flowing through profile names. */
export function liveSessionScopes(): Set<string> {
  const scopes = new Set<string>()

  for (const [runtimeId, state] of Object.entries($sessionStates.get())) {
    if (!state || (!state.busy && !state.needsInput)) {
      continue
    }

    const scope = sessionScopeByRuntimeId.get(runtimeId)

    if (scope) {
      scopes.add(scope)
    }
  }

  return scopes
}


// ── Owner hold across the create → foreground gap ───────────────────────────
// A routed session.create returns a stored id on the owner's socket, but the
// surface that will PIN that socket (the selected primary thread, or a tile)
// is published later and asynchronously: navigate → route effect →
// $selectedStoredSessionId, or openSessionTile → $sessionTiles. In that gap
// the entry has no active request, is not yet foreground-bound and, if the
// user switched source meanwhile, is not the active key either — so the
// live-work pruner or a refcount-0 lease release could close the socket that
// holds the just-minted runtime before the first prompt.submit. The hold
// names the owner in foregroundSessionScopes from the moment the create
// returns until the foreground publication takes over (the stored id becomes
// selected or tiled), the caller releases it (failed create / drift close),
// or a bounded TTL expires — nothing latches.
const SESSION_OWNER_HOLD_TTL_MS = 60_000


export const sessionOwnerHolds = new Map<
  string,
  { owner: SessionOwnerScope; timer: ReturnType<typeof setTimeout>; until: number }
>()


export const $sessionOwnerHoldRevision = atom(0)


function bumpSessionOwnerHoldRevision(): void {
  $sessionOwnerHoldRevision.set($sessionOwnerHoldRevision.get() + 1)
}


export function forgetSessionOwnerHold(storedSessionId: string, publish: boolean): boolean {
  const hold = sessionOwnerHolds.get(storedSessionId)

  if (!hold) {
    return false
  }

  clearTimeout(hold.timer)
  sessionOwnerHolds.delete(storedSessionId)

  if (publish) {
    bumpSessionOwnerHoldRevision()
  }

  return true
}


export function holdSessionOwnerUntilForeground(storedSessionId: string, owner: SessionOwnerScope): () => void {
  const id = storedSessionId.trim()

  if (!id || !owner) {
    return () => undefined
  }

  forgetSessionOwnerHold(id, false)
  const until = Date.now() + SESSION_OWNER_HOLD_TTL_MS
  const timer = setTimeout(() => releaseSessionOwnerHold(id), SESSION_OWNER_HOLD_TTL_MS)

  sessionOwnerHolds.set(id, { owner, timer, until })
  bumpSessionOwnerHoldRevision()

  return () => releaseSessionOwnerHold(id)
}


export function releaseSessionOwnerHold(storedSessionId: string): void {
  forgetSessionOwnerHold(storedSessionId.trim(), true)
}


/** @internal Tests. */
export function _resetSessionOwnerHoldsForTests(): void {
  const hadHolds = sessionOwnerHolds.size > 0

  for (const hold of sessionOwnerHolds.values()) {
    clearTimeout(hold.timer)
  }

  sessionOwnerHolds.clear()

  if (hadHolds) {
    bumpSessionOwnerHoldRevision()
  }
}


/** The session id the live HashRouter route names, or null when the route has
 *  no session opinion (new-chat draft, reserved/overlay/contributed page, or
 *  no hash at all). Desktop mounts HashRouter, so the app route lives in
 *  `location.hash` (`#/stored-A`); `location.pathname` is always the
 *  document's own path and never carries the session segment. */
export function windowRouteSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  return routeSessionId(window.location.hash.replace(/^#/, ''))
}


export function sameSessionOwner(left: SessionOwnerScope, right: SessionOwnerScope): boolean {
  if (isSessionOwnerRoute(left) && isSessionOwnerRoute(right)) {
    return (
      left.connectionId.trim() === right.connectionId.trim() &&
      normalizeProfileKey(left.profile) === normalizeProfileKey(right.profile) &&
      normalizeProfileKey(left.targetProfile ?? left.profile) ===
        normalizeProfileKey(right.targetProfile ?? right.profile)
    )
  }

  if (typeof left === 'string' && typeof right === 'string') {
    return normalizeProfileKey(left) === normalizeProfileKey(right)
  }

  return false
}


export function ownerProfileKey(owner: SessionOwnerScope): string | undefined {
  if (isSessionOwnerRoute(owner)) {
    return normalizeProfileKey(owner.profile)
  }

  return typeof owner === 'string' ? normalizeProfileKey(owner) : undefined
}


/** The mode of the backend that serves `owner`: the route's own `mode`, else
 *  its registry connection's kind, else the socket already dialed for it (a
 *  bare profile rides the primary or its own pool secondary). Null = unknown. */
export function ownerConnectionMode(owner: SessionOwnerScope): 'local' | 'remote' | null {
  if (!owner) {
    return null
  }

  if (typeof owner === 'string') {
    return dialedGatewayModeFor(null, owner)
  }

  if (owner.mode) {
    return owner.mode
  }

  const kind = registryConnectionKind(owner.connectionId)

  if (kind) {
    return kind === 'local' ? 'local' : 'remote'
  }

  return dialedGatewayModeFor(owner.connectionId, owner.profile)
}
