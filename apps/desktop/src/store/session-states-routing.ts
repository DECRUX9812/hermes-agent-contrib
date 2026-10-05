import { type GatewayEvent, registryBackendScopeKey } from '@hermes/shared'

import { setSessionOwnerResolver } from '@/api/client'

import { setPreviewScope } from './preview'
import { $activeGatewayProfile, normalizeProfileKey } from './profile'
import {
  $activeSessionId,
  $connection,
  $selectedStoredSessionId,
  getSessionOwnerHint,
  knownSessionOwner,
  ownerLookupSessionRows
} from './session'
import { secondaryProfileOwnerForEvent } from './session-event-provenance'
import { assertSessionOwnerResolved } from './session-owner-resolution'
import { isSessionOwnerRoute, requestForSessionProfile, type SessionOwnerScope } from './session-request-router'
import { $sessionStates } from './session-states-live'
import { ownerConnectionMode, sessionOwnerByRuntimeId, sessionScopeByRuntimeId } from './session-states-owners'
import type { SessionTile } from './session-states-tiles-core'
import { $sessionTiles, sessionTileDelegate, sessionTileOwner, toStored } from './session-states-tiles-core'

export function recordSessionEventScope(event: { connectionId?: string; profile?: string; session_id?: string }): void {
  if (!event.session_id) {
    return
  }

  if (event.connectionId) {
    sessionScopeByRuntimeId.set(event.session_id, registryBackendScopeKey(event.connectionId, event.profile))
    sessionOwnerByRuntimeId.set(event.session_id, {
      connectionId: event.connectionId,
      profile: String(event.profile ?? '').trim() || 'default'
    })

    // An owner resolved after the focus moved must still re-home the rail.
    syncPreviewScope()

    return
  }

  // Only gateway.ts's secondary closure can add this non-serializable marker.
  // A profile field from a primary or arbitrary inbound event is descriptive,
  // not an owner route, and must keep failing closed in multi-profile installs.
  const profile = secondaryProfileOwnerForEvent(event as GatewayEvent)

  if (profile) {
    const profileKey = normalizeProfileKey(profile)
    sessionOwnerByRuntimeId.set(event.session_id, profileKey)
    sessionScopeByRuntimeId.set(event.session_id, profileKey)
  }

  syncPreviewScope()
}

/**
 * Sync owner resolution for a session id that may be a RUNTIME or a STORED id.
 * Tile route first (exact connectionId+profile, survives relaunch), then the
 * exact unique owner hint (stamped when a routed create returns / at open
 * time; persisted), then the session row's owner (an exact route when the row
 * is connection-tagged, else its bare profile, else the hint's profile). The
 * row rung searches every source-scoped slice (recents, cron, messaging), not
 * just recents — a cron session's approval.respond used to find no owner here
 * and fail closed on registry-topology installs even though its row (with its
 * `profile` stamp) was already loaded for the sidebar's cron section. The
 * hint outranks the row for the same reason as contrib/wiring's ladder: a
 * row can be stamped from the ambient profile and carries no connection.
 * Last rung: the owner recorded from the inbound runtime event itself
 * (sessionOwnerByRuntimeId, #97511) — an orphan runtime whose tile/hint/row
 * binding is absent or stale still routes through the exact
 * (connectionId, profile) or secondary socket's proven local profile. It sits
 * BELOW every durable EXACT route, so a stored-id collision never inherits a
 * stale runtime ledger entry, but it must sit ABOVE a bare profile name: a
 * bare profile carries no connection, and the profile door resolves it against
 * the PRIMARY connection (store/gateway gatewayForProfile), which for an
 * ordinary session that runs on a non-primary connection — two connections
 * both exposing `default` is enough — is another machine that answers
 * `4001 session not found`. Unproven profile fields record nothing, so unknown
 * owners in multi-profile topology still fail closed.
 * Returns undefined when no owner is known — the caller fails closed
 * (assertSessionOwnerResolved), never falls to "active".
 */
export function knownOwnerForSession(sessionId: null | string | undefined): SessionOwnerScope {
  if (!sessionId) {
    return undefined
  }

  const storedSessionId = storedSessionIdForRuntimeId(sessionId) ?? sessionId

  const durable =
    sessionTileOwner(storedSessionId) ??
    getSessionOwnerHint(storedSessionId) ??
    knownSessionOwner(ownerLookupSessionRows(), storedSessionId)

  if (isSessionOwnerRoute(durable)) {
    return durable
  }

  return sessionOwnerByRuntimeId.get(sessionId) ?? durable
}

// Session-scoped REST reads (detail / messages / timeline) resolve their
// connection pin through the SAME owner ladder as RPC dispatch (#125372).
setSessionOwnerResolver(knownOwnerForSession)

/** The profile whose chat is on screen — the rail's scope.
 *
 *  NOT `$activeGatewayProfile`: a focused tab does not swap the gateway socket,
 *  and every bot chat is served by one pooled backend, so the socket stays on
 *  the launch profile while you read another agent's chat. Keying the rail there
 *  showed one agent's previews in every agent's chat. `bot-row.tsx` documents
 *  the same trap for the roster highlight and resolves it the same way. */
function railScopeForActiveSession(): string {
  return previewScopeForRuntime($activeSessionId.get() ?? undefined)
}

/** The preview-rail profile a runtime's chat belongs to — the bucket whose
 *  pins its agent may use. Same resolution as the rail's own scope, so the
 *  primary's runtime always lands on the bucket in view. */
export function previewScopeForRuntime(runtimeId: string | undefined): string {
  const owner = knownOwnerForSession(runtimeId)
  const profile = typeof owner === 'string' ? owner : owner?.profile

  return normalizeProfileKey(profile || $activeGatewayProfile.get())
}

/** Keep the rail on the chat in view, so switching agents re-homes it. */
function syncPreviewScope() {
  setPreviewScope(railScopeForActiveSession())
}

$activeSessionId.subscribe(syncPreviewScope)

syncPreviewScope()

/**
 * Whether the connection that OWNS `sessionId` is remote — never the ambient
 * `$connection`. A session tied to a registered secondary connection (Bot
 * Mode, the unified Sessions list) can differ from whichever connection the
 * window currently shows; its RPCs already route to their own owner via
 * `requestForSessionProfile`, but a caller that instead reads ambient mode to
 * decide image.attach vs image.attach_bytes ships a client-local path to a
 * remote backend that can't resolve it (#94640, #120730). Only an owner whose
 * backend is still unknown falls back to ambient mode.
 */
export function isSessionRemote(sessionId: null | string | undefined): boolean {
  const mode = ownerConnectionMode(knownOwnerForSession(sessionId)) ?? $connection.get()?.mode

  return mode === 'remote'
}

/**
 * Dispatch a session-scoped RPC through the OWNER of `sessionId` (tile route →
 * hint → connection-tagged row / known profile). This is the client half of
 * #91684: approval.respond (and siblings) sent on the ambient socket land on
 * whatever backend is active, which for a cross-profile session is a backend
 * that never held the approval. An UNKNOWN owner fails closed with an
 * explicit SessionOwnerResolutionError unless the ambient gateway is provably
 * the only backend (legacy single-profile, no registry source).
 */
export function requestForOwnedSession<T>(
  sessionId: null | string | undefined,
  ambientRequest: <R>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
    signal?: AbortSignal
  ) => Promise<R>,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs?: number,
  signal?: AbortSignal
): Promise<T> {
  const owner = knownOwnerForSession(sessionId)

  try {
    assertSessionOwnerResolved(owner, { method, sessionId })
  } catch (error) {
    return Promise.reject(error)
  }

  return requestForSessionProfile<T>(owner, ambientRequest, method, params, timeoutMs, signal)
}

/** Resolve a session id THAT MAY BE A RUNTIME ID to the stored id its tile
 *  keys on. Session-scoped RPC params carry the runtime id, while tile owner
 *  routes (and everything else durable) key on the stored id — so routing an
 *  RPC by its own target session needs this translation first (#93080 /
 *  Bot Mode misroute). Ids that match a tile's stored id pass through, so
 *  callers can hand in either identity. Unknown ids return null: the caller
 *  falls back to its ambient routing rather than guessing. */
export function storedSessionIdForRuntimeId(sessionId: string): null | string {
  const tiles = $sessionTiles.get()

  // Stored-id claims are authoritative (durable identity): check them all
  // before any runtime binding, so a stale tile whose dead runtimeId collides
  // with a live tile's stored id cannot hijack the lookup.
  for (const tile of tiles) {
    if (tile.storedSessionId === sessionId) {
      return tile.storedSessionId
    }
  }

  for (const tile of tiles) {
    if (tile.runtimeId && tile.runtimeId === sessionId) {
      return tile.storedSessionId
    }
  }

  // The per-runtime state mirror carries the stored id the wiring cache bound
  // (ensureSessionState / a resume). This is how a MAIN-PANE runtime id — an
  // approval.respond from a native notification, a queued send — finds its
  // durable identity, and through it the exact owner (hint / tagged row).
  // Without this rung such ids fell straight to the ambient socket.
  const mirrored = $sessionStates.get()[sessionId]?.storedSessionId?.trim()

  if (mirrored) {
    return mirrored
  }

  // Main's own binding. A tile promoted into main (⌘W on the workspace tab,
  // a tab dragged out of main) loses its tile AND its evicted mirror entry in
  // the same tick, while the resume sets the runtime active before the view
  // republishes the mirror. The composer's control read lands in that gap
  // and, with nothing to translate, never reaches the stored-id hint.
  const selected = $selectedStoredSessionId.get()

  return sessionId === $activeSessionId.get() && selected ? selected : null
}

/** Drop live runtime bindings so every tile re-resumes — used on gateway
 *  reconnect, where a respawned backend re-mints (recycles) runtime ids.
 *  Also invalidates the wiring cache's stored→runtime map: clearing only the
 *  tile atoms left `resumeTile`'s warm path free to re-bind the same dead
 *  runtime id from the cache, so post-wake tiles repainted empty and never
 *  actually re-resumed. */
export interface RuntimeReconnectScope {
  connectionId: string
  profile?: null | string
}

/** Fallback scope for a restarted connection whose registry identity is
 *  unknown (a legacy remote primary with no connectionId). We cannot name the
 *  dead owner, so instead preserve only Bot runtimes whose owner is provably
 *  alive elsewhere; every other binding is dropped and re-resumes. A reset
 *  only costs a re-resume, so unknown owners fail toward recovery. */
export interface UnknownRuntimeReconnectScope {
  liveConnectionIds: ReadonlySet<string>
}

export function resetTileRuntimeBindings(
  reconnectedScope?: null | string | RuntimeReconnectScope | UnknownRuntimeReconnectScope
) {
  const tiles = $sessionTiles.get()

  const liveConnectionIds =
    reconnectedScope && typeof reconnectedScope === 'object' && 'liveConnectionIds' in reconnectedScope
      ? reconnectedScope.liveConnectionIds
      : null

  const reconnected =
    typeof reconnectedScope === 'string'
      ? { connectionId: reconnectedScope.trim(), profile: null }
      : reconnectedScope && !liveConnectionIds
        ? {
            connectionId: (reconnectedScope as RuntimeReconnectScope).connectionId.trim(),
            profile: (reconnectedScope as RuntimeReconnectScope).profile?.trim() || null
          }
        : null

  const belongsToReconnectedRuntime = (tile: SessionTile): boolean => {
    const route = tile.ownerRoute

    if (liveConnectionIds) {
      // Unknown restarted identity: a tile survives only when its owner is a
      // connection we know is still live — anything else rebinds on resume.
      return !route?.connectionId || !liveConnectionIds.has(route.connectionId)
    }

    if (!reconnected?.connectionId || route?.connectionId !== reconnected.connectionId) {
      return false
    }

    return !reconnected.profile || (route.targetProfile || route.profile) === reconnected.profile
  }

  const preservedStoredIds = new Set(
    tiles
      .filter(
        // Any tile with an EXACT owner route — bot tabs always, and a
        // sessions tile whose opener stamped one (a branch child on its
        // parent's connection). Its runtime lives on that owner's socket,
        // not the ambient gateway, so an unrelated connection's reconnect
        // must not drop the binding: each drop re-arms the tile's resume,
        // and a flapping sibling connection turns that into 4+ re-resumes
        // inside the storm window — latching the "keeps losing its backend
        // runtime" card over a session that is actually healthy.
        tile =>
          Boolean(tile.ownerRoute?.connectionId) &&
          (!(reconnected || liveConnectionIds) || !belongsToReconnectedRuntime(tile))
      )
      .map(tile => tile.storedSessionId)
  )

  sessionTileDelegate()?.invalidateRuntimeBindings?.(preservedStoredIds)

  if (tiles.some(tile => tile.runtimeId && !preservedStoredIds.has(tile.storedSessionId))) {
    $sessionTiles.set(tiles.map(tile => (preservedStoredIds.has(tile.storedSessionId) ? tile : toStored(tile))))
  }
}

/** Reset for a pooled secondary route that reopened while it was NOT the
 *  window's ambient gateway. Only tiles whose exact owner route names that
 *  runtime can hold ids it minted; un-owned tiles and the main thread ride the
 *  ambient socket, whose own reconnect path runs `resetTileRuntimeBindings`.
 *  Background request leases (the Bot relay drain) reopen such a route every
 *  tick, and a window-wide reset there re-resumed every open tile each time —
 *  remounting its composer (caret reset, layout shift, model pick reverted). */
export function resetRouteOwnedTileRuntimeBindings(scope: RuntimeReconnectScope) {
  const connectionId = scope.connectionId.trim()
  const profile = scope.profile?.trim() || null
  const tiles = $sessionTiles.get()

  const ownedStoredIds = new Set(
    tiles
      .filter(tile => {
        const route = tile.ownerRoute

        return (
          Boolean(connectionId) &&
          route?.connectionId === connectionId &&
          (!profile || (route.targetProfile || route.profile) === profile)
        )
      })
      .map(tile => tile.storedSessionId)
  )

  if (ownedStoredIds.size === 0) {
    return
  }

  sessionTileDelegate()?.dropRuntimeBindings?.(ownedStoredIds)

  if (tiles.some(tile => tile.runtimeId && ownedStoredIds.has(tile.storedSessionId))) {
    $sessionTiles.set(tiles.map(tile => (ownedStoredIds.has(tile.storedSessionId) ? toStored(tile) : tile)))
  }
}

/** Unbind ONE reclaimed runtime from whichever tile holds it — the targeted
 *  sibling of resetTileRuntimeBindings. The reconnect-time reset can't cover a
 *  backend reclaim: the WS re-dials immediately, but the orphan reaper fires a
 *  grace window LATER, so the reclaim lands after every reconnect-path unbind
 *  already ran. Without this, the tile keeps pointing at the dead runtime whose
 *  state `session.reclaimed` just dropped — an empty transcript under live
 *  chrome — and SessionTilePane's resume effect (gated on `!runtimeId`) never
 *  re-resumes. Clearing the binding re-arms that effect, which rebinds a fresh
 *  runtime from the stored row. The pane itself stays: the stored session is
 *  intact, only its live runtime was reclaimed. */
export function unbindTileRuntime(runtimeId: string) {
  const tiles = $sessionTiles.get()

  if (tiles.some(t => t.runtimeId === runtimeId)) {
    $sessionTiles.set(tiles.map(t => (t.runtimeId === runtimeId ? { ...t, runtimeId: undefined } : t)))
  }
}
