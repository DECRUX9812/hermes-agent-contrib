import { backendScopeKey, registryBackendScopeKey } from '@hermes/shared'
import { atom, computed } from 'nanostores'

import type { ClientSessionState } from '@/app/types'
import type { WorkspaceMode } from '@/contrib/types'
import { readJson, writeJson } from '@/lib/storage'

import { $activeGatewayProfile, normalizeProfileKey } from './profile'
import {
  $activeSessionId,
  $connection,
  $selectedStoredSessionId,
  $sessions,
  knownSessionOwner,
  lineageAliases,
  ownerLookupSessionRows
} from './session'
import { $focusedTreePaneId } from './session-focus'
import {
  isSessionOwnerRoute,
  type SessionOwnerRoute,
  type SessionOwnerScope
} from './session-request-router'
import { forgetSessionOwnerHold, ownerProfileKey, sameSessionOwner, sessionOwnerHolds, sessionScopeByRuntimeId, windowRouteSessionId } from './session-states-owners'
import { knownOwnerForSession, storedSessionIdForRuntimeId } from './session-states-routing'
import { isBrowserWindow, isSecondaryWindow } from './windows'


/**
 * Registry scopes owned by an open foreground surface, when known.
 *
 * The secondary-gateway pruner normally keeps only busy/needs-input work. A
 * source switch briefly changes the active gateway before an idle conversation
 * is cleared, so the primary runtime must survive that handoff. Open panes have
 * the same ownership contract: a non-focused idle tile is still user-visible
 * state and must not be evicted just because another pane has focus. Prefer the
 * live event scope, with the tile's persisted route as the pre-bind fallback.
 *
 * A just-created session's owner is named by its create → foreground hold
 * (holdSessionOwnerUntilForeground) until the selected/tiled publication or
 * a bounded TTL retires it, so nothing can close the socket that minted the
 * runtime before the first prompt lands.
 */
export function foregroundSessionScopes(): Set<string> {
  const scopes = new Set<string>()

  const addRouteScope = (route: SessionOwnerRoute | undefined) => {
    const connectionId = route?.connectionId?.trim()
    const profile = route?.profile?.trim()

    if (connectionId && profile) {
      scopes.add(registryBackendScopeKey(connectionId, profile))
    }
  }

  const addOwnerScope = (owner: SessionOwnerScope | undefined) => {
    if (!owner) {
      return
    }

    if (typeof owner === 'string') {
      const key = normalizeProfileKey(owner)

      if (key) {
        scopes.add(key)
      }

      return
    }

    addRouteScope(owner)
  }

  const addRuntimeScope = (runtimeId: string | undefined) => {
    if (!runtimeId) {
      return
    }

    const scope = sessionScopeByRuntimeId.get(runtimeId)

    if (scope) {
      scopes.add(scope)

      return
    }

    addOwnerScope(knownOwnerForSession(runtimeId))
  }

  addRuntimeScope($activeSessionId.get() ?? undefined)

  for (const tile of $sessionTiles.get()) {
    addRuntimeScope(tile.runtimeId)
    addRouteScope(tile.ownerRoute)

    if (!tile.ownerRoute && tile.ownerProfile) {
      scopes.add(normalizeProfileKey(tile.ownerProfile))
    }
  }

  // Create → foreground holds. A hold whose scope the rungs above already
  // name (the runtime's event scope once selected, a mounted tile's route) is
  // covered and retires; an expired one retires too.
  const now = Date.now()

  for (const [storedSessionId, hold] of [...sessionOwnerHolds]) {
    const scope =
      typeof hold.owner === 'string'
        ? normalizeProfileKey(hold.owner)
        : hold.owner?.connectionId?.trim()
          ? registryBackendScopeKey(hold.owner.connectionId.trim(), normalizeProfileKey(hold.owner.profile))
          : null

    if (!scope || hold.until <= now || scopes.has(scope)) {
      // This recompute was already triggered by the covering publication (or
      // is itself observing expiry), so avoid recursively publishing.
      forgetSessionOwnerHold(storedSessionId, false)

      continue
    }

    scopes.add(scope)
  }

  return scopes
}


/** Whether the user is still focused on a session that belongs to the same
 *  durable lineage as the given stored id. Used to decide whether a
 *  backgrounded session's delayed id-rotation may follow the route/selection
 *  to its new tip, or whether the user has already navigated away.
 *
 *  Every surface that can name the on-screen session must agree: the focused
 *  tile or primary (`$focusedStoredSessionId` already folds the layout's
 *  interaction tracker, an open tile, and the primary selection into one
 *  answer) AND the HashRouter route. A fast A -> B switch can leave route and
 *  selection on A while tile B holds focus; either surface naming a session
 *  outside the lineage means the user has already moved on (#86106). */
export function isSessionInForeground(storedSessionId: string): boolean {
  const sessions = $sessions.get()
  const foregroundIds = new Set(lineageAliases(storedSessionId, sessions))
  const focused = $focusedStoredSessionId.get()

  if (focused !== null && !foregroundIds.has(focused)) {
    return false
  }

  const routed = windowRouteSessionId()

  if (routed !== null && !foregroundIds.has(routed)) {
    return false
  }

  // Neither surface names a session: a fresh unpersisted chat is still the
  // thing on screen. The caller already requires the rotating runtime to be
  // $activeSessionId, so allow that session's own A -> A-next.
  return true
}


// ---------------------------------------------------------------------------
// Session tiles.
// ---------------------------------------------------------------------------

/** Edge a tile docks against main when it first joins the tree. Shared by
 *  session tiles and route (page) tiles. */
export type SplitDir = 'bottom' | 'left' | 'right' | 'top'


/** Where a tile lands on adoption: an edge split, or `center` = stack into
 *  the anchor's zone as a tab (a drop on the zone's tab strip). */
export type TileDock = 'center' | SplitDir


export interface SessionTile {
  /** Stored session id — the durable identity (runtime ids are ephemeral). */
  storedSessionId: string
  /** Dock against `anchor` on adoption (default right; center = stack). */
  dir?: TileDock
  /** Pane to dock against (a drop's target zone) — default the workspace.
   *  Persisted so a restart re-docks in place; a stale id falls back to the
   *  workspace (findGroupOfPane misses → the move is skipped). */
  anchor?: string
  /** Center docks: stack BEFORE this pane id (`null`/omitted = append) — the
   *  strip divider's slot. Persisted, like `anchor`; a stale id appends. */
  before?: null | string
  /** Live runtime id once the tile's resume has bound one. */
  runtimeId?: string
  /** Resume failed terminally (shown in the tile; retryable). */
  error?: string
  /** Presentation workspace this tab belongs to. Missing legacy values are Sessions. */
  workspaceMode?: WorkspaceMode
  /** Exact opaque owner key for Bot Mode tabs. */
  workspaceOwnerKey?: string
  /** Legacy profile-pool owner when no registry connection identifies the route. */
  ownerProfile?: string
  /** Credential-free exact route used to resume this tab after relaunch. */
  ownerRoute?: SessionOwnerRoute
  /** Stable title for hidden relationship chats absent from the Sessions list. */
  workspaceTabTitle?: string
}


export interface SessionTileWorkspaceScope {
  ownerProfile?: string
  ownerRoute?: SessionOwnerRoute
  workspaceMode: WorkspaceMode
  workspaceOwnerKey?: string
  workspaceTabTitle?: string
}

/** The workspace bucket a session was last opened under, read-only and
 *  all-optional: the union of a tile's own record and a remembered
 *  main-surface scope, where absent fields simply mean no bucket was
 *  stamped. $sessionWorkspaceScopes answers with this shape. */
export interface SessionWorkspaceScope {
  ownerProfile?: string
  ownerRoute?: SessionOwnerRoute
  workspaceMode?: WorkspaceMode
  workspaceOwnerKey?: string
  workspaceTabTitle?: string
}


// Tiles are persisted per connection and profile: same-named profiles on two
// backends own different sessions. Switching either scope swaps the visible
// set, with runtime bindings dropped so tiles re-resume on their own gateway.
const TILES_KEY = 'hermes.desktop.sessionTiles.v2'

const LEGACY_TILES_KEY = 'hermes.desktop.sessionTiles.v1'

export const TILE_PANE_PREFIX = 'session-tile:'

export const BOTS_TILE_BUCKET = '__bots_workspace__'


/** Persisted placement — `dir` + strip slot (`before`) + dock `anchor` so a
 *  restart / profile swap re-adopts tiles in the same order, not all stacked
 *  right of workspace. */
type StoredTile = Pick<
  SessionTile,
  | 'anchor'
  | 'before'
  | 'dir'
  | 'ownerProfile'
  | 'ownerRoute'
  | 'storedSessionId'
  | 'workspaceMode'
  | 'workspaceOwnerKey'
  | 'workspaceTabTitle'
>


export const toStored = (t: SessionTile): StoredTile => ({
  anchor: t.anchor,
  before: t.before,
  dir: t.dir,
  ...(t.ownerProfile ? { ownerProfile: t.ownerProfile } : {}),
  ...(t.ownerRoute ? { ownerRoute: t.ownerRoute } : {}),
  storedSessionId: t.storedSessionId,
  ...(t.workspaceMode ? { workspaceMode: t.workspaceMode } : {}),
  ...(t.workspaceOwnerKey ? { workspaceOwnerKey: t.workspaceOwnerKey } : {}),
  ...(t.workspaceTabTitle ? { workspaceTabTitle: t.workspaceTabTitle } : {})
})


function parseTileList(value: unknown): StoredTile[] {
  return Array.isArray(value)
    ? value
        .filter((t): t is SessionTile => Boolean(t && typeof (t as SessionTile).storedSessionId === 'string'))
        .map(t => {
          const raw = t as SessionTile

          return {
            // #108679: a tile whose anchor is its OWN pane id is
            // self-referential — the re-dock target can never exist (the
            // pane is not in the tree at adoption time), so the dock falls
            // through to an arbitrary same-placement neighbor instead of the
            // recorded layout. Rewrite it to the workspace anchor at load,
            // the same surface an anchorless tile re-docks against.
            anchor:
              typeof raw.anchor === 'string' && raw.anchor !== `${TILE_PANE_PREFIX}${raw.storedSessionId}`
                ? raw.anchor
                : undefined,
            before: typeof raw.before === 'string' || raw.before === null ? raw.before : undefined,
            dir: raw.dir,
            ownerProfile: typeof raw.ownerProfile === 'string' ? normalizeProfileKey(raw.ownerProfile) : undefined,
            ownerRoute:
              raw.ownerRoute &&
              typeof raw.ownerRoute.connectionId === 'string' &&
              typeof raw.ownerRoute.profile === 'string'
                ? {
                    connectionId: raw.ownerRoute.connectionId,
                    mode: raw.ownerRoute.mode,
                    profile: raw.ownerRoute.profile,
                    ...(typeof raw.ownerRoute.targetProfile === 'string'
                      ? { targetProfile: raw.ownerRoute.targetProfile }
                      : {})
                  }
                : undefined,
            storedSessionId: raw.storedSessionId,
            workspaceMode: raw.workspaceMode === 'bots' ? 'bots' : 'sessions',
            workspaceOwnerKey:
              raw.workspaceMode === 'bots' && typeof raw.workspaceOwnerKey === 'string'
                ? raw.workspaceOwnerKey
                : undefined,
            workspaceTabTitle: typeof raw.workspaceTabTitle === 'string' ? raw.workspaceTabTitle : undefined
          }
        })
    : []
}


function loadTilesByProfile(): Record<string, StoredTile[]> {
  const byProfile: Record<string, StoredTile[]> = Object.create(null)
  const parsed = readJson<unknown>(TILES_KEY)

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [profile, list] of Object.entries(parsed as Record<string, unknown>)) {
      const tiles = parseTileList(list)
      // Existing profile-only buckets belong to the local connection. New
      // remote buckets carry the same backend scope key as the socket pool;
      // never collapse them back into a same-named local profile on reload.
      const separator = profile.lastIndexOf('::')
      const isScopedBucket = profile.startsWith('conn:') && separator > 'conn:'.length

      const key =
        profile === BOTS_TILE_BUCKET
          ? BOTS_TILE_BUCKET
          : isScopedBucket
            ? backendScopeKey(
                profile.slice('conn:'.length, separator),
                normalizeProfileKey(profile.slice(separator + 2))
              )
            : normalizeProfileKey(profile)

      if (tiles.length > 0) {
        const sessionTiles = tiles.filter(tile => tile.workspaceMode !== 'bots')
        const botTiles = tiles.filter(tile => tile.workspaceMode === 'bots')

        for (const tile of sessionTiles) {
          // Old profile-only buckets can contain remote tiles whose owner was
          // already recorded. Preserve those tabs on upgrade; unknown owners
          // stay local rather than being guessed onto another backend.
          const scope = isScopedBucket ? key : backendScopeKey(tile.ownerRoute?.connectionId, key)
          byProfile[scope] = [...(byProfile[scope] ?? []), tile]
        }

        if (botTiles.length > 0) {
          byProfile[BOTS_TILE_BUCKET] = [...(byProfile[BOTS_TILE_BUCKET] ?? []), ...botTiles]
        }
      }
    }
  }

  // Migrate a v1 flat list into the default profile, then retire the key.
  const legacy = parseTileList(readJson<unknown>(LEGACY_TILES_KEY))

  if (legacy.length > 0) {
    const key = normalizeProfileKey('default')
    const sessionTiles = legacy.filter(tile => tile.workspaceMode !== 'bots')
    const botTiles = legacy.filter(tile => tile.workspaceMode === 'bots')

    byProfile[key] = [...(byProfile[key] ?? []), ...sessionTiles]
    byProfile[BOTS_TILE_BUCKET] = [...(byProfile[BOTS_TILE_BUCKET] ?? []), ...botTiles]
  }

  if (byProfile[BOTS_TILE_BUCKET]?.length) {
    byProfile[BOTS_TILE_BUCKET] = [
      ...new Map(byProfile[BOTS_TILE_BUCKET].map(tile => [tile.storedSessionId, tile])).values()
    ]
  }

  writeJson(LEGACY_TILES_KEY, null)

  return byProfile
}


export const tilesByProfile = loadTilesByProfile()

// Keyed by the GATEWAY profile: the rail's profile switch is a soft swap
// ($activeGatewayProfile moves, no reload) — $activeProfile mirrors the
// window's primary backend and never changes on a rail switch, so keying on
// it left the previous profile's tiles registered (phantom "Session" tabs).
export const profileKey = () => normalizeProfileKey($activeGatewayProfile.get())


const tileConnectionScopeId = (connection: ReturnType<typeof $connection.get>) => {
  const id = connection?.connectionId?.trim()

  if (id) {
    return id
  }

  // Older direct remotes have no registry id. Keep them separate from local
  // and from each other instead of writing into the local profile bucket.
  return connection?.mode === 'remote' ? `url:${connection.baseUrl || 'remote'}` : null
}

export let tileConnectionId = tileConnectionScopeId($connection.get())
const tileScopeKey = () => backendScopeKey(tileConnectionId, profileKey())
export let visibleTileScope = tileScopeKey()

// Runtime ids are process-scoped — never trust a persisted one, so the live
// atom hydrates from the stored (runtime-less) tiles for the active profile.
// A secondary window (single-chat pop-out) shows ONLY its routed session — no
// tiles, and no repopulation on a profile switch.
/** Stored ids of session tiles whose pane is PARKED (unmounted by the zone's
 *  bounded keep-alive, pane-lifecycle.ts). A parked tile still exists, so it
 *  used to count as "referenced" and its full transcript stayed pinned in the
 *  warm cache forever — the retained-`$messages` leak of #77311. Parked tiles
 *  are unreferenced for eviction; the tile's resume path re-hydrates from the
 *  backend on unpark exactly as a cold mount does. */
export const $parkedTileStoredIds = atom<ReadonlySet<string>>(new Set())


const parkedTilesByZone = new Map<string, readonly string[]>()


/** Each pane zone reports its own parked session tiles; the atom is the union. */
export function setZoneParkedTiles(zoneKey: string, storedSessionIds: readonly string[]): void {
  if (storedSessionIds.length === 0) {
    parkedTilesByZone.delete(zoneKey)
  } else {
    parkedTilesByZone.set(zoneKey, storedSessionIds)
  }

  const next = new Set([...parkedTilesByZone.values()].flat())
  const prev = $parkedTileStoredIds.get()

  if (next.size === prev.size && [...next].every(id => prev.has(id))) {
    return
  }

  $parkedTileStoredIds.set(next)
}


export const $sessionTiles = atom<SessionTile[]>(
  isSecondaryWindow() || isBrowserWindow()
    ? []
    : [...(tilesByProfile[visibleTileScope] ?? []), ...(tilesByProfile[BOTS_TILE_BUCKET] ?? [])]
)


export function persistTiles() {
  // Shares the origin's storage; a secondary / browser pop-out holds no tiles,
  // so a write back would only wipe the primary's set.
  if (isSecondaryWindow() || isBrowserWindow()) {
    return
  }

  writeJson(TILES_KEY, Object.keys(tilesByProfile).length === 0 ? null : tilesByProfile)
}


export function saveTiles(tiles: SessionTile[]) {
  const stored = tiles.map(toStored)
  const sessionTiles = stored.filter(tile => tile.workspaceMode !== 'bots')
  const botTiles = stored.filter(tile => tile.workspaceMode === 'bots')

  if (sessionTiles.length > 0) {
    tilesByProfile[visibleTileScope] = sessionTiles
  } else {
    delete tilesByProfile[visibleTileScope]
  }

  if (botTiles.length > 0) {
    tilesByProfile[BOTS_TILE_BUCKET] = botTiles
  } else {
    delete tilesByProfile[BOTS_TILE_BUCKET]
  }

  persistTiles()
  $sessionTiles.set(tiles)
}


function saveTileBucket(bucket: string, tiles: SessionTile[]) {
  const stored = tiles.map(toStored)

  if (stored.length > 0) {
    tilesByProfile[bucket] = stored
  } else {
    delete tilesByProfile[bucket]
  }

  persistTiles()
}

// Profile or connection switch: surface only this backend's stored tiles.
// Null connection is a reconnect blip, not a switch; keep the last scope.
// A secondary window never carries tiles, so it stays out entirely.
if (!isSecondaryWindow() && !isBrowserWindow()) {
  const restoreVisibleTiles = () => {
    const nextScope = tileScopeKey()

    if (nextScope === visibleTileScope) {
      return
    }

    visibleTileScope = nextScope
    $sessionTiles.set([...(tilesByProfile[nextScope] ?? []), ...(tilesByProfile[BOTS_TILE_BUCKET] ?? [])])
  }

  $activeGatewayProfile.subscribe(restoreVisibleTiles)
  $connection.subscribe(connection => {
    if (!connection) {
      return
    }

    tileConnectionId = tileConnectionScopeId(connection)
    restoreVisibleTiles()
  })
}


export function patchSessionTile(storedSessionId: string, patch: Partial<SessionTile>) {
  saveTiles($sessionTiles.get().map(t => (t.storedSessionId === storedSessionId ? { ...t, ...patch } : t)))
}


function tileWorkspaceMode(tile: SessionTile): WorkspaceMode {
  return tile.workspaceMode ?? 'sessions'
}


function tilesShareOwner(left: SessionTile, right: SessionTile): boolean {
  if (left.workspaceMode && right.workspaceMode && left.workspaceMode !== right.workspaceMode) {
    return false
  }

  const workspaceMode = left.workspaceMode ?? right.workspaceMode ?? 'sessions'

  if (workspaceMode === 'bots') {
    if (left.workspaceOwnerKey && right.workspaceOwnerKey) {
      return left.workspaceOwnerKey === right.workspaceOwnerKey
    }

    if (left.ownerRoute && right.ownerRoute) {
      return sameSessionOwner(left.ownerRoute, right.ownerRoute)
    }

    return true
  }

  if (left.ownerRoute && right.ownerRoute) {
    return sameSessionOwner(left.ownerRoute, right.ownerRoute)
  }

  return true
}


function tileBelongsToMain(tile: SessionTile, selectedStoredSessionId: string, tileProfile = profileKey()): boolean {
  if (tileWorkspaceMode(tile) === 'bots') {
    return false
  }

  const mainOwner = knownSessionOwner(ownerLookupSessionRows(), selectedStoredSessionId) ?? profileKey()

  if (tile.ownerRoute) {
    return isSessionOwnerRoute(mainOwner) && sameSessionOwner(tile.ownerRoute, mainOwner)
  }

  return typeof mainOwner === 'string' && normalizeProfileKey(mainOwner) === normalizeProfileKey(tileProfile)
}


function mergeSessionTile(previous: SessionTile, next: SessionTile, storedSessionId: string): SessionTile {
  const merged: SessionTile = { ...previous, storedSessionId }

  if (next.anchor !== undefined) {
    merged.anchor = next.anchor
  }

  if (next.before !== undefined) {
    merged.before = next.before
  }

  if (next.dir !== undefined) {
    merged.dir = next.dir
  }

  if (next.error !== undefined) {
    merged.error = next.error
  }

  if (next.ownerRoute !== undefined) {
    merged.ownerRoute = next.ownerRoute
  }

  if (next.runtimeId !== undefined) {
    merged.runtimeId = next.runtimeId
  }

  if (next.workspaceMode !== undefined) {
    merged.workspaceMode = next.workspaceMode
  }

  if (next.workspaceOwnerKey !== undefined) {
    merged.workspaceOwnerKey = next.workspaceOwnerKey
  }

  if (next.workspaceTabTitle !== undefined) {
    merged.workspaceTabTitle = next.workspaceTabTitle
  }

  return merged
}


function rekeyTileList(
  tiles: SessionTile[],
  tileProfile: string,
  previousStoredSessionId: string,
  nextStoredSessionId: string
): SessionTile[] | null {
  const stale = tiles.find(t => t.storedSessionId === previousStoredSessionId)

  if (!stale) {
    return null
  }

  const selectedStoredSessionId = $selectedStoredSessionId.get()

  const mainOwnsRotation =
    Boolean(selectedStoredSessionId) &&
    (selectedStoredSessionId === previousStoredSessionId || selectedStoredSessionId === nextStoredSessionId) &&
    tileBelongsToMain(stale, selectedStoredSessionId!, tileProfile)

  const nextTile = tiles.find(t => t.storedSessionId === nextStoredSessionId && tilesShareOwner(stale, t))

  if (mainOwnsRotation) {
    return tiles.filter(t => t !== stale)
  }

  if (nextTile) {
    return tiles
      .map(t => (t === nextTile ? mergeSessionTile(stale, t, nextStoredSessionId) : t))
      .filter(t => t !== stale)
  }

  return tiles.map(t => (t === stale ? { ...t, storedSessionId: nextStoredSessionId } : t))
}


/**
 * Re-home an open tile after auto-compression rotates the conversation's stored
 * id (#98622). Without this, the tile stays keyed on the pre-rotation id while
 * the rest of the app (selection, route, composer) moves to the new tip — the
 * same conversation then renders as two tabs (identical or differently-titled,
 * since each tip is titled independently).
 *
 * Placement fields (`dir`/`anchor`/`before`) are preserved so the pane mirror
 * re-docks the re-keyed tile in the same slot; pane-mirror's wanted-set diff
 * disposes the old pane and adopts the new one from this single change.
 *
 * Main-vs-tile reconciliation is scoped to the same Sessions workspace/owner.
 * Bot tiles and tiles on distinct backend routes remain independent surfaces.
 * When a rotation arrives for a background runtime, the persisted profile bucket
 * owning that runtime is updated without replacing the active profile's atom.
 */
export function rekeySessionTile(
  previousStoredSessionId: string,
  nextStoredSessionId: string,
  runtimeSessionId?: string
) {
  if (!previousStoredSessionId || !nextStoredSessionId || previousStoredSessionId === nextStoredSessionId) {
    return
  }

  const visibleTiles = $sessionTiles.get()

  if (visibleTiles.some(t => t.storedSessionId === previousStoredSessionId)) {
    const nextTiles = rekeyTileList(visibleTiles, profileKey(), previousStoredSessionId, nextStoredSessionId)

    if (nextTiles) {
      saveTiles(nextTiles)
    }

    return
  }

  const candidateBuckets = Object.entries(tilesByProfile).filter(([, tiles]) =>
    tiles.some(t => t.storedSessionId === previousStoredSessionId)
  )

  if (candidateBuckets.length === 0) {
    return
  }

  const owner =
    (runtimeSessionId ? knownOwnerForSession(runtimeSessionId) : undefined) ??
    knownSessionOwner(ownerLookupSessionRows(), previousStoredSessionId)

  const resolvedProfile = ownerProfileKey(owner)

  const candidate = resolvedProfile
    ? candidateBuckets.find(([bucket]) => bucket === resolvedProfile)
    : candidateBuckets.length === 1
      ? candidateBuckets[0]
      : undefined

  if (!candidate) {
    return
  }

  const [bucket, storedTiles] = candidate
  const nextTiles = rekeyTileList(storedTiles, bucket, previousStoredSessionId, nextStoredSessionId)

  if (nextTiles) {
    saveTileBucket(bucket, nextTiles)
  }
}


export function sessionTileOwnerRoute(storedSessionId: string): SessionOwnerRoute | undefined {
  return $sessionTiles.get().find(tile => tile.storedSessionId === storedSessionId)?.ownerRoute
}


export function sessionTileOwner(storedSessionId: string): SessionOwnerScope {
  const tile = $sessionTiles.get().find(candidate => candidate.storedSessionId === storedSessionId)

  return tile?.ownerRoute ?? tile?.ownerProfile
}


const BOT_CHAT_SCOPE_KEY = 'hermes.desktop.botChatSessions.v1'


/** Stored ids last opened as a bot's chat. A tile carries `workspaceMode`, but
 *  a bot chat normally lands in MAIN — `in-place` mints no tile when there is
 *  none to front — and main has no tile to carry the scope on. Kept here so a
 *  surface can still tell a companion chat from a working session, persisted
 *  so that survives a relaunch the way tile scope does. */
export const $botChatSessionIds = atom<ReadonlySet<string>>(
  new Set((readJson<unknown>(BOT_CHAT_SCOPE_KEY) as unknown[] | null)?.filter(id => typeof id === 'string') ?? [])
)


/** The bot-mode scope each stored id was last opened under, for the main tab
 *  (which has no tile to carry one). Window-local: the caption falls back to
 *  the stored title until the chat is opened again. */
export const $botChatScopes = atom<Readonly<Record<string, SessionTileWorkspaceScope>>>({})


function rememberBotChatScope(storedSessionId: string, scope: SessionTileWorkspaceScope): void {
  const isBotChat = scope.workspaceMode === 'bots'
  const current = $botChatSessionIds.get()
  const { [storedSessionId]: previous, ...rest } = $botChatScopes.get()

  const changed = isBotChat
    ? previous?.workspaceOwnerKey !== scope.workspaceOwnerKey || previous?.workspaceTabTitle !== scope.workspaceTabTitle
    : Boolean(previous)

  if (changed) {
    $botChatScopes.set(isBotChat ? { ...rest, [storedSessionId]: scope } : rest)
  }

  if (current.has(storedSessionId) === isBotChat) {
    return
  }

  const next = new Set(current)

  if (isBotChat) {
    next.add(storedSessionId)
  } else {
    next.delete(storedSessionId)
  }

  $botChatSessionIds.set(next)
  writeJson(BOT_CHAT_SCOPE_KEY, next.size ? [...next] : null)
}


/** Every session's workspace scope, merged across surfaces: a tiled session
 *  carries its scope on the tile; a session in MAIN has no tile, so its scope
 *  is remembered in $botChatScopes. One map so a reader tells a workspace
 *  chat from a working session without asking which surface holds it. */
export const $sessionWorkspaceScopes = computed([$sessionTiles, $botChatScopes], (tiles, remembered) => {
  const scopes: Record<string, SessionWorkspaceScope> = { ...remembered }

  for (const tile of tiles) {
    scopes[tile.storedSessionId] = tile
  }

  return scopes
})

/** True while this live session is a bot's chat rather than a working session.
 *  Surfaces read it to drop coding chrome that means nothing in a companion
 *  conversation — the composer's branch/worktree rail. */
export function isBotChatSession(sessionId: null | string | undefined): boolean {
  const stored = sessionId ? storedSessionIdForRuntimeId(sessionId) : null

  return Boolean(stored && $botChatSessionIds.get().has(stored))
}


export function setSessionTileWorkspaceScope(storedSessionId: string, scope: SessionTileWorkspaceScope): boolean {
  // Before the tile lookup: openSession routes every open through here, and a
  // bot chat usually has no tile to record the scope on.
  rememberBotChatScope(storedSessionId, scope)

  const tile = $sessionTiles.get().find(candidate => candidate.storedSessionId === storedSessionId)
  const workspaceOwnerKey = scope.workspaceMode === 'bots' ? scope.workspaceOwnerKey : undefined
  // Sessions-mode re-opens (sidebar click on an already-tiled session) pass no
  // route; that is absence of information, not a revocation — keep the exact
  // owner the tile was opened with (a branch child's parent connection) so a
  // plain re-open can't unpin the owning socket. Bot scopes stay authoritative
  // both ways: they always name their route explicitly.
  const ownerRoute = scope.workspaceMode === 'bots' ? scope.ownerRoute : (scope.ownerRoute ?? tile?.ownerRoute)
  const ownerProfile = scope.workspaceMode === 'bots' ? undefined : (scope.ownerProfile ?? tile?.ownerProfile)
  const workspaceTabTitle = scope.workspaceMode === 'bots' ? scope.workspaceTabTitle : undefined

  if (
    !tile ||
    ((tile.workspaceMode ?? 'sessions') === scope.workspaceMode &&
      tile.workspaceOwnerKey === workspaceOwnerKey &&
      tile.ownerProfile === ownerProfile &&
      tile.ownerRoute?.connectionId === ownerRoute?.connectionId &&
      tile.ownerRoute?.profile === ownerRoute?.profile &&
      tile.ownerRoute?.targetProfile === ownerRoute?.targetProfile &&
      tile.workspaceTabTitle === workspaceTabTitle)
  ) {
    return false
  }

  patchSessionTile(storedSessionId, {
    ownerProfile,
    ownerRoute,
    workspaceMode: scope.workspaceMode,
    workspaceOwnerKey,
    workspaceTabTitle
  })

  return true
}


// ---------------------------------------------------------------------------
// Delegate — the wiring layer (which owns the gateway + session cache) plugs
// its actions in; tile UI calls through here. Same inversion as the tree
// store's pane closers.
// ---------------------------------------------------------------------------

export interface SessionTileDelegate {
  /** Archive a stored session (the sidebar's archive, incl. tile cleanup). */
  archiveSession(storedSessionId: string): Promise<void>
  /** Branch a stored session into a new chat (the sidebar's branch). */
  branchSession(storedSessionId: string): Promise<void>
  /** Delete a stored session (the sidebar's delete, incl. tile cleanup). */
  deleteSession(storedSessionId: string): Promise<void>
  /** Run a slash command against a tile's session (app-level effects — e.g.
   *  branch/handoff — act on the main surface, as they should). */
  executeSlash(rawCommand: string, sessionId: string, options?: { typed?: boolean }): Promise<void>
  /** Interrupt a tile's running turn. */
  interruptSession(runtimeId: string): Promise<void>
  /** Drop the wiring cache's stored→runtime bindings. Called on gateway
   *  reconnect: a respawned backend re-mints runtime ids, so every binding
   *  recorded before the reconnect is suspect — without this, `resumeTile`'s
   *  warm path re-binds tiles to dead runtime ids (the sleep/wake "empty
   *  right pane" bug). Bindings re-record from live post-reconnect events. */
  invalidateRuntimeBindings?(preserveStoredSessionIds?: ReadonlySet<string>): void
  /** Drop ONLY these stored→runtime bindings from the wiring cache — the
   *  route-scoped twin of invalidateRuntimeBindings for a reopened secondary
   *  (`resetRouteOwnedTileRuntimeBindings`). Bindings for every other stored
   *  session, including the main thread, stay warm. */
  dropRuntimeBindings?(storedSessionIds: ReadonlySet<string>): void
  /** Bind a live runtime id for a stored session (resume without touching
   *  the main view). Returns the runtime id, or throws.
   *  `refreshTranscript` forces a REST merge even when a warm cached
   *  transcript already exists — reopen-after-idle must not paint the
   *  snapshot that was current when the panel last had a socket. */
  resumeTile(storedSessionId: string, options?: { refreshTranscript?: boolean }): Promise<string>
  /** Retire one runtime's busy/awaiting claim through the wiring cache
   *  (updateSessionState), so cache, focused view, busyRef, and tile mirrors
   *  settle together. Returns false when the cache holds no busy state for
   *  it — the caller downgrades the mirror itself. Reconnect-time twin of
   *  invalidateRuntimeBindings (#93059). */
  retireBusyClaim?(runtimeId: string): boolean
  /** Apply `updater` through the wiring cache when it holds `runtimeId`, so
   *  cache, focused view, and tile mirrors settle together. Returns false
   *  without writing when the cache never held it (no phantom entries); the
   *  caller writes the mirror itself. */
  updateHeldSession?(runtimeId: string, updater: (state: ClientSessionState) => ClientSessionState): boolean
  /** Submit a prompt to a tile's live session. */
  submitToSession(runtimeId: string, text: string): Promise<void>
  /** THE session-state write path — routes through the wiring cache so the
   *  cache, the primary view (when active), and every tile mirror agree. */
  updateSession(runtimeId: string, updater: (state: ClientSessionState) => ClientSessionState): ClientSessionState
}


let delegate: SessionTileDelegate | null = null

export const $sessionTileDelegateRevision = atom(0)


export function setSessionTileDelegate(next: SessionTileDelegate) {
  delegate = next
  $sessionTileDelegateRevision.set($sessionTileDelegateRevision.get() + 1)
}


export function sessionTileDelegate(): SessionTileDelegate | null {
  return delegate
}


// Closed-tab stack for ⌘⇧T reopen (in-memory) — keyed PER PROFILE like the
// tiles themselves, so ⌘⇧T after a profile switch never resurrects the other
// profile's session. The tile's placement is remembered so it returns in place.
export const closedTilesByProfile: Record<string, SessionTile[]> = {}

export const closedStack = (): SessionTile[] => (closedTilesByProfile[visibleTileScope] ??= [])


// ---------------------------------------------------------------------------
// The FOCUSED session — one derivation, not another hand-maintained
// "$activeSession" sibling. session-focus resolves the interacted content zone,
// retaining it while the Sessions sidebar owns keyboard focus. Its active
// pane names the session: a `session-tile:<storedId>` pane IS that session,
// anything else falls back to the route-driven primary. Chrome that should
// follow the user between tiles (titlebar session title, statusbar context /
// timer / model) reads these instead of the primary-only atoms.
// ---------------------------------------------------------------------------

export const $focusedSessionIsTile = computed($focusedTreePaneId, active =>
  Boolean(active?.startsWith(TILE_PANE_PREFIX))
)


export const $focusedStoredSessionId = computed([$focusedTreePaneId, $selectedStoredSessionId], (active, selected) =>
  active?.startsWith(TILE_PANE_PREFIX) ? active.slice(TILE_PANE_PREFIX.length) : selected
)


/** Every session currently OPEN as a surface: the primary's selection plus
 *  every tile's stored id. The sidebar highlights all of them (the focused one
 *  at full strength, the rest dimmed) so a multi-pane workspace shows which
 *  chats are on screen, not just the one being typed into. */
export const $openStoredSessionIds = computed(
  [$selectedStoredSessionId, $sessionTiles],
  (selected, tiles) => new Set([...(selected ? [selected] : []), ...tiles.map(t => t.storedSessionId)])
)


/** Live runtime id of the focused session (a tile's bound runtime, else the
 *  primary's active session). */
export const $focusedRuntimeId = computed(
  [$focusedStoredSessionId, $selectedStoredSessionId, $activeSessionId, $sessionTiles],
  (focused, selected, primaryRuntime, tiles) => {
    if (focused && focused !== selected) {
      return tiles.find(t => t.storedSessionId === focused)?.runtimeId ?? null
    }

    return primaryRuntime
  }
)


/** A PRIMARY navigation (sidebar resume, route change, new chat) homes focus to
 *  the workspace — UNLESS the selected id is already an open TILE, where
 *  `focusOpenSession` owns the move and homing would yank every stacked tile
 *  behind the workspace (A+B "disappear" when switching to C). */
export const selectionHomesToWorkspace = (selected: null | string, tiles: readonly SessionTile[]): boolean =>
  !(selected && tiles.some(t => t.storedSessionId === selected))
