import { backendScopeKey, LOCAL_CONNECTION_ID } from '@hermes/shared'

import { dropComposerDraftsForProfile, migrateComposerDraftsForProfile } from './composer'
import { dropStatusDrawersForProfile, migrateStatusDrawersForProfile } from './composer-status-drawer'
import { dropPreviewTabsForProfile, migratePreviewTabsForProfile } from './preview'
import { dropPreviewArtifactsForProfile, migratePreviewArtifactsForProfile } from './preview-status'
import { normalizeProfileKey } from './profile'
import {
  migrateRememberedNavigationForProfile,
  migrateSessionOwnerHintsForProfile
} from './session'
import { dropSessionAskForProfile, migrateSessionAskForProfile } from './session-ask'
import { dropOwnerNotifyModesForProfile, migrateOwnerNotifyModesForProfile } from './session-mute'
import {
  type SessionProfileRoute
} from './session-request-router'
import {
  $sessionTiles,
  BOTS_TILE_BUCKET,
  closedTilesByProfile,
  persistTiles,
  tileConnectionId,
  tilesByProfile,
  visibleTileScope
} from './session-states-tiles-core'
import { dropSessionTagsForProfile, migrateSessionTagsForProfile } from './session-tags'
import { dropWatchedSessionsForProfile, migrateWatchedSessionsForProfile } from './session-watch'
import { migrateTranscriptTailsForProfile } from './transcript-tail-cache'


/**
 * Drop every persisted tile owned by a profile that is being deleted — the
 * profile's own session-tile bucket and any Bot Mode tile whose ownerRoute
 * points at it (matched by desktop profile name, or by exact connection /
 * backend target profile when a source-scoped route is given).
 *
 * A leftover tile RESURRECTS the deleted profile on the next launch: Bot tab
 * restore re-dials the profile's backend, whose ensure_hermes_home() re-creates
 * the profile directory the delete just removed (hermes-agent#94235). Same
 * discard (no ⌘⇧T) semantics as discardSessionTile — undoing the delete of the
 * owning profile would resolve to a 404 again.
 */
export function dropTilesForProfile(
  profile: string,
  route?: { connectionId?: string; profile?: string; targetProfile?: string }
): void {
  // A route without profile has no owner side to match: it would silently fall
  // into the local-delete branch below and require `ownerConnection === 'local'`,
  // dropping nothing remotely owned while appearing to succeed. Both current
  // call sites always populate profile, so refuse the malformed shape loudly
  // instead of letting a future caller misuse the optional route (Enough1122
  // review of #94426).
  if (route && !route.profile?.trim()) {
    throw new Error('dropTilesForProfile: route without profile cannot be scoped')
  }

  const name = normalizeProfileKey(profile)
  dropPreviewArtifactsForProfile(name, route)
  dropStatusDrawersForProfile(name, route)
  // The composer's per-profile fresh-draft bucket dies with the profile — a
  // later same-name profile must not inherit its unsent text.
  dropComposerDraftsForProfile(name, route)
  dropSessionTagsForProfile(name, route)
  dropSessionAskForProfile(name, route)
  dropWatchedSessionsForProfile(name, route)
  dropOwnerNotifyModesForProfile(name, route)
  // Route fields go through the SAME canonicalization as `name` below — a
  // source-scoped delete must not be defeated by stray whitespace around a
  // profile name that a non-route delete trims away.
  const routeProfile = route?.profile ? normalizeProfileKey(route.profile) : ''
  const routeTarget = route?.targetProfile ? normalizeProfileKey(route.targetProfile) : ''
  const routeConnection = String(route?.connectionId ?? '').trim()
  // A route-less deletion targets the active backend, including legacy direct
  // remotes whose tile key uses the URL fallback. Reuse the writer's resolved
  // connection scope so deletion cannot erase same-named local tabs instead.
  const ambientConnection = tileConnectionId || LOCAL_CONNECTION_ID
  const removedScope = backendScopeKey(route ? routeConnection : ambientConnection, routeProfile || name)

  const ownerMatches = (owner: SessionProfileRoute | undefined): boolean => {
    if (!owner) {
      return false
    }

    const ownerProfile = normalizeProfileKey(owner.profile)
    const ownerTarget = normalizeProfileKey(owner.targetProfile)
    const ownerConnection = String(owner.connectionId ?? '').trim()

    if (routeProfile) {
      // Source-scoped delete: the route's desktop profile name, backend target,
      // and connection must all agree with the tile's owner route.
      if (ownerProfile !== routeProfile) {
        return false
      }

      if (routeTarget && ownerTarget !== routeTarget) {
        return false
      }

      return !routeConnection || ownerConnection === routeConnection
    }

    // Ambient delete: only the active connection owns this profile. Legacy
    // owner routes without an id can be matched to local, but not guessed onto
    // an id-less remote — that would delete a same-named local Bot tab.
    return (
      (ownerProfile === name || ownerTarget === name) &&
      (ownerConnection || LOCAL_CONNECTION_ID) === ambientConnection
    )
  }

  // The profile's own sessions bucket (Bot tiles live in the shared bucket
  // and are keyed by ownerRoute, not by bucket).
  delete tilesByProfile[removedScope]
  delete closedTilesByProfile[removedScope]

  const botTiles = tilesByProfile[BOTS_TILE_BUCKET]

  if (botTiles) {
    const remaining = botTiles.filter(tile => !ownerMatches(tile.ownerRoute))

    if (remaining.length > 0) {
      tilesByProfile[BOTS_TILE_BUCKET] = remaining
    } else {
      delete tilesByProfile[BOTS_TILE_BUCKET]
    }
  }

  // Live atom: drop the deleted profile's Bot tiles, and — when the deleted
  // profile IS the live gateway's profile — the session tiles in view (they
  // belong to that bucket; the caller re-homes afterwards).
  const live = $sessionTiles.get()

  const next = live.filter(tile =>
    // Bot tiles map to the shared Bot bucket (keyed by ownerRoute here): drop
    // the deleted profile's bots, matched by owner.
    tile.workspaceMode === 'bots'
      ? !ownerMatches(tile.ownerRoute)
      : // Session tiles map to the owning profile's own bucket: drop only when
        // the deleted profile IS the live gateway's profile.
        visibleTileScope !== removedScope
  )

  if (next.length !== live.length) {
    $sessionTiles.set(next)
  }

  persistTiles()
  // The rail is a profile-keyed family too: a deleted profile's tabs must not
  // outlive it, or a later profile of the same name inherits them.
  dropPreviewTabsForProfile(name)
}


/**
 * Rename counterpart of dropTilesForProfile: the profile's sessions still exist
 * under the new name, so its persisted tabs, Bot tiles routed at it, cached
 * transcript tails, remembered session/route and owner hints move to the new
 * name instead of being left under `local::<old>` where every open resolves
 * to a backend that no longer exists ("Couldn't open this session", #111868).
 * Local-connection state only; a remote gateway rename executes there.
 */
export function migrateTilesForProfile(oldProfile: string, newProfile: string): void {
  const from = normalizeProfileKey(oldProfile)
  const to = normalizeProfileKey(newProfile)

  if (!from || !to || from === to) {
    return
  }

  const isLocal = (owner: SessionProfileRoute | undefined) =>
    Boolean(owner) && (String(owner?.connectionId ?? '').trim() || 'local') === 'local'

  const renamedOwner = (owner: SessionProfileRoute | undefined): SessionProfileRoute | undefined => {
    if (!owner || !isLocal(owner)) {
      return owner
    }

    const profile = normalizeProfileKey(owner.profile) === from ? to : owner.profile
    const targetProfile = normalizeProfileKey(owner.targetProfile) === from ? to : owner.targetProfile

    return profile === owner.profile && targetProfile === owner.targetProfile
      ? owner
      : { ...owner, profile, ...(targetProfile === undefined ? {} : { targetProfile }) }
  }

  const moved = tilesByProfile[from]

  if (moved) {
    delete tilesByProfile[from]
    tilesByProfile[to] = [
      ...(tilesByProfile[to] ?? []),
      ...moved.map(tile => ({ ...tile, ownerRoute: renamedOwner(tile.ownerRoute) }))
    ]
  }

  const botTiles = tilesByProfile[BOTS_TILE_BUCKET]

  if (botTiles) {
    tilesByProfile[BOTS_TILE_BUCKET] = botTiles.map(tile => ({ ...tile, ownerRoute: renamedOwner(tile.ownerRoute) }))
  }

  const live = $sessionTiles.get()
  const next = live.map(tile => (tile.ownerRoute ? { ...tile, ownerRoute: renamedOwner(tile.ownerRoute) } : tile))

  if (next.some((tile, index) => tile !== live[index] && tile.ownerRoute !== live[index].ownerRoute)) {
    $sessionTiles.set(next)
  }

  persistTiles()
  migrateTranscriptTailsForProfile(from, to)
  migrateRememberedNavigationForProfile(from, to)
  migrateSessionOwnerHintsForProfile(from, to)
  migratePreviewArtifactsForProfile(from, to)
  migrateStatusDrawersForProfile(from, to)
  migrateComposerDraftsForProfile(from, to)
  migrateSessionTagsForProfile(from, to)
  migrateSessionAskForProfile(from, to)
  migrateWatchedSessionsForProfile(from, to)
  migrateOwnerNotifyModesForProfile(from, to)
  // Sibling family: the rail's profile-keyed buckets move with the rename, or
  // the renamed profile opens with an empty rail and the old name keeps them.
  migratePreviewTabsForProfile(from, to)
}
