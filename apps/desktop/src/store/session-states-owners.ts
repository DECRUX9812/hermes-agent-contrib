
import { routeSessionId } from '@/app/routes'

import { registryConnectionKind } from './connection-registry-state'
import { dialedGatewayModeFor } from './gateway'
import { normalizeProfileKey } from './profile'
import { isSessionOwnerRoute, type SessionOwnerScope } from './session-request-router'
import { $sessionStates } from './session-states-live'

// ---------------------------------------------------------------------------
// Event-source scopes: which registry connection's socket (or local secondary
// gateway) delivered a runtime session's events. Working/attention membership
// alone is profile-blind — two connected gateways can both expose a 'default'
// profile, so the gateway keep-set (pruneSecondaryGateways) must key live work
// by the composite (connectionId, profile) scope for remote connections, or
// by the normalized profile name for local secondary gateways. Recorded at
// event fan-in (use-gateway-boot); local primary events carry no connectionId
// or secondary marker and record nothing, so single-source behavior is untouched.
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

/** The composite source scope (connection + profile) a runtime's own events
 *  proved — `registryBackendScopeKey` of the socket that delivered them.
 *  Undefined for a runtime whose events arrived untagged (the local legacy
 *  primary), whose source is then whatever gateway is actively serving this
 *  window. Reaction-overlay reads key the displayed session's scope with
 *  this, so an overlay recorded on one source never paints another
 *  source's same-numbered row. */
export function sessionEventScopeFor(runtimeId: null | string | undefined): string | undefined {
  const id = String(runtimeId ?? '').trim()

  return id ? sessionScopeByRuntimeId.get(id) : undefined
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
      sessionScopeByRuntimeId.delete(runtimeId)
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

// The create → foreground owner hold (map, TTL, hold/release/reset and the
// foreground-scope sweep) lives in ./session-owner-holds.
export {
  $sessionOwnerHoldRevision,
  _resetSessionOwnerHoldsForTests,
  holdSessionOwnerUntilForeground,
  releaseSessionOwnerHold
} from './session-owner-holds'

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
