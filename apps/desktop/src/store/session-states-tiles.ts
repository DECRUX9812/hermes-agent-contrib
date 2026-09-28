import { LOCAL_CONNECTION_ID, registryBackendScopeKey } from '@hermes/shared'

import type { ClientSessionState } from '@/app/types'
import { findGroupOfPane, type LayoutNode } from '@/components/pane-shell/tree/model'
import {
  $layoutTree,
  focusedSessionTabAnchor,
  isPaneVisible,
  moveTreePane,
  noteActiveTreeGroup,
  revealTreePane
} from '@/components/pane-shell/tree/store'
import { resolveRememberedActivePane, workspaceScopeKey } from '@/components/pane-shell/workspace-scope'
import { tileFocusStampOnFocusChange } from '@/lib/session-timer-since'
import type { SessionInfo } from '@/types/hermes'

import { normalizeProfileKey } from './profile'
import {
  $selectedStoredSessionId,
  $sessions,
  lineageAliases,
  markSessionRead,
  setSessions,
  setTileSessionFocusStartedAt
} from './session'
import { $sessionStates, dropSessionState, evictable, publishSessionState } from './session-states-live'
import type { SessionTile, SessionTileWorkspaceScope, TileDock} from './session-states-tiles-core';
import { $botChatScopes, $focusedStoredSessionId, $sessionTiles, closedStack, patchSessionTile, saveTiles, selectionHomesToWorkspace, sessionTileDelegate, setSessionTileWorkspaceScope, TILE_PANE_PREFIX, toStored } from './session-states-tiles-core'
import { ackStoredSessionId } from './session-unread'


/**
 * Gateway keep-set scopes for currently open tiles. Bot chats (and any other
 * owner-routed tile) hold a secondary socket even while chrome stays on the
 * launch profile; without these keys, idle prune closes that socket and the
 * tile's resume/unbind loop spins forever. Local routes contribute both the
 * bare profile (openGatewayForProfile) and the explicit `conn:local::…` key
 * (openGatewayForAgent). Remote routes contribute only the composite key so
 * a homelab tile cannot pin another source's same-named profile.
 */
export function openTileGatewayScopes(): Set<string> {
  const scopes = new Set<string>()

  for (const tile of $sessionTiles.get()) {
    const route = tile.ownerRoute

    if (!route) {
      if (tile.ownerProfile) {
        scopes.add(normalizeProfileKey(tile.ownerProfile))
      }

      continue
    }

    const profile = normalizeProfileKey(route.profile)
    const connectionId = String(route.connectionId ?? '').trim()
    const localRoute = !connectionId || connectionId === LOCAL_CONNECTION_ID || route.mode === 'local'

    if (localRoute) {
      scopes.add(profile)
    }

    if (connectionId) {
      scopes.add(registryBackendScopeKey(connectionId, profile))
    }
  }

  return scopes
}


/** Reorder tiles to match layout-tree encounter order (stored ids in the order
 *  their `session-tile:` panes are walked). Restore replays the array through
 *  sequential adoption (each center tile APPENDS after the ones before it), so
 *  array order IS strip order — no `before` stamping needed; a stale `before`
 *  naming an absent pane falls back to append anyway (see insertAtGroup). Tiles
 *  not yet adopted sort after placed ones, stably. Returns `null` when nothing
 *  moves so callers can skip a needless persist. */
export function orderTilesByTree<T extends { storedSessionId: string }>(
  tree: LayoutNode | null,
  tiles: readonly T[]
): null | T[] {
  if (!tree || tiles.length < 2) {
    return null
  }

  const order: string[] = []

  const walk = (node: LayoutNode) => {
    if (node.type === 'group') {
      for (const id of node.panes) {
        if (id.startsWith(TILE_PANE_PREFIX)) {
          order.push(id.slice(TILE_PANE_PREFIX.length))
        }
      }

      return
    }

    node.children.forEach(walk)
  }

  walk(tree)

  const rank = new Map(order.map((id, i) => [id, i]))

  const next = [...tiles].sort(
    (a, b) => (rank.get(a.storedSessionId) ?? Infinity) - (rank.get(b.storedSessionId) ?? Infinity)
  )

  return next.some((t, i) => t !== tiles[i]) ? next : null
}


function syncTileStripOrder() {
  const next = orderTilesByTree($layoutTree.get(), $sessionTiles.get())

  if (next) {
    saveTiles(next)
  }
}


/** Open a tile for a stored session, or MOVE an existing one to the new dock
 *  (`dir`; `center` = stack into the anchor's zone, `before` = strip slot). The
 *  move path is what lets a tile's own TAB be dragged like a sidebar row — drop
 *  it on a zone/edge/strip and the tile goes there (drop-on-a-composer links
 *  instead, handled by the drag resolver). The session LOADED IN MAIN never
 *  opens as a tile (same transcript twice, fighting one runtime — silly).
 *
 *  An unanchored open (⌘T, ⌘⇧T on a tile that predates anchors) docks into the
 *  FOCUSED chat zone — the same zone ⌘1…⌘9 and ⌘W act on — so a new tab lands
 *  in the strip the user is looking at, not always main's. */
export function openSessionTile(
  storedSessionId: string,
  dir: TileDock = 'right',
  anchor?: string,
  before?: null | string,
  explicitScope?: SessionTileWorkspaceScope
) {
  const tiles = $sessionTiles.get()
  const existing = tiles.find(t => t.storedSessionId === storedSessionId)

  // No scope on an already-open tile is a MOVE (a split drag re-docking a tab),
  // not a re-scope: keep the workspace it lives in instead of re-bucketing it
  // into Sessions — a Bot tab used to vanish from the Bot workspace on drop.
  // A bot chat dragged out of MAIN has no tile (Bot Mode has no main/tile
  // distinction) and no explicit scope — the tab it rides on is the bot
  // workspace itself. Left on the sessions fallback, the "loaded in MAIN never
  // opens as a tile" guard below swallowed the drop silently. The remembered
  // bot-chat scope is the discriminator: restore it so the drop mints a real
  // tile, which the drop hint's reveal then adopts and fronts. An existing-tile
  // move keeps the tile's own scope.
  const rememberedBotScope = !explicitScope && !existing ? $botChatScopes.get()[storedSessionId] : undefined

  const workspaceScope: SessionTileWorkspaceScope = explicitScope ??
    rememberedBotScope ?? { workspaceMode: existing?.workspaceMode ?? 'sessions' }

  // Opening a session in a tab/tile is "reading" it — clear its unread dot
  // exactly like main-thread resume does. Previously only
  // setSelectedStoredSessionId cleared unread, so tile-opened sessions kept
  // their green dot even while the user was reading them. Acks the persisted
  // watermark/marker too so a later list refresh doesn't repaint it.
  markSessionRead(storedSessionId)
  ackStoredSessionId(storedSessionId)

  const aliases = lineageAliases(storedSessionId, $sessions.get())

  if (workspaceScope.workspaceMode === 'sessions' && aliases.includes($selectedStoredSessionId.get() ?? '')) {
    return
  }

  const dock = anchor ?? focusedSessionTabAnchor() ?? undefined

  const workspaceOwnerKey = workspaceScope.workspaceMode === 'bots' ? workspaceScope.workspaceOwnerKey : undefined

  if (!tiles.some(t => aliases.includes(t.storedSessionId))) {
    saveTiles([
      ...tiles,
      {
        anchor: dock,
        before,
        dir,
        // The owner route pins the owning backend's socket in the gateway
        // keep-set (openTileGatewayScopes / foregroundSessionScopes) for as
        // long as the tile is open. Bot tabs always carry one; a sessions-mode
        // tile carries one when its opener knows the exact owner — e.g. a
        // branch child created on its parent's owning connection, whose
        // draft runtime is otherwise orphan-reaped the moment the pruner
        // closes the unpinned socket (the resume/reclaim flicker loop,
        // #93892 shape).
        ownerProfile: workspaceScope.ownerProfile,
        ownerRoute: workspaceScope.ownerRoute,
        storedSessionId,
        workspaceMode: workspaceScope.workspaceMode,
        workspaceOwnerKey,
        workspaceTabTitle: workspaceScope.workspaceMode === 'bots' ? workspaceScope.workspaceTabTitle : undefined
      }
    ])
    // Adoption is async via the registry — order sync runs after the move path
    // below; a brand-new tile's strip slot is already in `before`.

    return
  }

  if (explicitScope) {
    setSessionTileWorkspaceScope(storedSessionId, explicitScope)
  }

  // Already open: relocate the existing pane to the drop target (pane-mirror
  // only docks on first adoption, so a re-drag must move the tree pane itself).
  const tree = $layoutTree.get()
  const target = tree ? findGroupOfPane(tree, dock ?? 'workspace')?.id : null

  if (target) {
    moveTreePane(`${TILE_PANE_PREFIX}${storedSessionId}`, { before: before ?? null, groupId: target, pos: dir })
    patchSessionTile(storedSessionId, { anchor: dock, before: before ?? undefined, dir })
    syncTileStripOrder()
  }
}


/** ⌘W on the MAIN tab: the next session tab stacked WITH the workspace, to
 *  shift into main. Walks the workspace group's strip from the workspace tab
 *  outward (the tab after it first, then wrapping to the ones before), and
 *  returns the first session tile's stored id. Null when the workspace has no
 *  session tab stacked beside it (⌘W then stays the no-op it was). */
export function nextSessionTileForWorkspace(): null | string {
  const tree = $layoutTree.get()
  const group = tree ? findGroupOfPane(tree, 'workspace') : null

  if (!group) {
    return null
  }

  const tiles = $sessionTiles.get()
  const idx = group.panes.indexOf('workspace')
  // After the workspace tab first, then the ones before it (nearest-out).
  const ordered = [...group.panes.slice(idx + 1), ...group.panes.slice(0, idx).reverse()]

  for (const paneId of ordered) {
    if (paneId.startsWith(TILE_PANE_PREFIX)) {
      const storedSessionId = paneId.slice(TILE_PANE_PREFIX.length)

      if (tiles.some(t => t.storedSessionId === storedSessionId)) {
        return storedSessionId
      }
    }
  }

  // Nothing stacked WITH main — but a session tile in another zone can still
  // shift in. Without this, closing main in a side-by-side layout skipped
  // promotion entirely and dropped to a fresh "New session" draft, which read
  // as "closing a pane gave me a new session" (#88924). Promoting the tile
  // also collapses its zone, so Close is how a multi-pane layout shrinks.
  for (const tile of tiles) {
    if (tree && findGroupOfPane(tree, `${TILE_PANE_PREFIX}${tile.storedSessionId}`)) {
      return tile.storedSessionId
    }
  }

  return null
}


/** If a session is already ON SCREEN — an open tile OR the one loaded in main —
 *  front its tab (and focus its zone) and report WHICH. A sidebar click on an
 *  already-open chat JUMPS to its tab instead of reloading it; `null` means the
 *  caller must load it into main. Covers the two dead clicks: an open tile, and
 *  the main session while focus sits on a tile (route unchanged → no reload).
 *  Callers that own the router need the `'main'` vs `'tile'` distinction: a
 *  `'main'` hit only reaches the screen if the workspace pane is actually
 *  showing the chat, whereas a tile renders in its own pane regardless. */
export function focusOpenSession(
  storedSessionId: string,
  workspaceScope: SessionTileWorkspaceScope = { workspaceMode: 'sessions' }
): 'main' | 'tile' | null {
  // Compression rotates a conversation's tip id while tiles stay keyed by
  // whichever segment id they were opened with. An exact-id test right after
  // a rotation said "not open" for a conversation that IS on screen, and
  // callers opened the same chat in a second tab. Match any id of the
  // lineage instead, and front the tile under ITS key.
  const aliases = lineageAliases(storedSessionId, $sessions.get())
  const tile = $sessionTiles.get().find(t => aliases.includes(t.storedSessionId))

  if (tile) {
    const paneId = `${TILE_PANE_PREFIX}${tile.storedSessionId}`
    revealTreePane(paneId) // un-dismiss + adopt + front in its group
    const tree = $layoutTree.get()
    const group = tree ? findGroupOfPane(tree, paneId) : null

    if (!group || !isPaneVisible(paneId)) {
      return null
    }

    noteActiveTreeGroup(group.id)

    return 'tile'
  }

  // Already the main session: front the workspace tab and drop tile focus so
  // the readouts + sidebar highlight come home (a no-op when main is focused).
  if (workspaceScope.workspaceMode === 'sessions' && aliases.includes($selectedStoredSessionId.get() ?? '')) {
    revealTreePane('workspace')
    noteActiveTreeGroup(null)

    return 'main'
  }

  return null
}


/** Front the tab a Bot Mode owner already has open and report its stored id:
 *  the tile the zone last had active for `workspaceOwnerKey` (the same
 *  window-local memory the strip restores on a scope switch), else the most
 *  recently opened one. `null` when that owner has no open tile — the caller
 *  decides what to open then. A roster click consults this FIRST so a bot
 *  with open tabs comes back to the one the user left, instead of re-opening
 *  its canonical Bot Chat beside them: nothing records a tab close except the
 *  tile bucket forgetting it, so any open path that ignores the open set
 *  resurrects closed chats on every bot switch.
 *
 *  `isStaleTile`: the caller's reconciliation probe against backend truth
 *  (hermes-agent#90102). The tile bucket is a Local Storage cache, and a
 *  persisted bot tile can outlive the session it names — a superseded
 *  "Bot Chat" from the retired pointer design, a re-minted canonical row, a
 *  finished session that stopped being the bot's chat. Fronting such a tile
 *  made the row's click target a stale (often hidden) session forever while
 *  the preview described the live one. A tile the probe rejects is DISCARDED
 *  (resurrecting it would just front the stale session again — same
 *  no-undo rationale as discardSessionTile) and never fronted, so the caller
 *  falls through to its authoritative open. No probe = the old behavior. */
export function focusWorkspaceOwnerSessionTile(
  workspaceOwnerKey: string,
  isStaleTile?: (tile: SessionTile) => boolean,
  onlyStoredIds?: readonly string[]
): null | string {
  const allOwned = $sessionTiles
    .get()
    .filter(tile => tile.workspaceMode === 'bots' && tile.workspaceOwnerKey === workspaceOwnerKey)

  let owned = allOwned

  if (typeof isStaleTile === 'function') {
    const stale = allOwned.filter(tile => {
      try {
        return isStaleTile(tile)
      } catch {
        // A throwing probe must not break the click path — keep the tile.
        return false
      }
    })

    for (const tile of stale) {
      discardSessionTile(tile.storedSessionId)
    }

    owned = allOwned.filter(tile => !stale.includes(tile))
  }

  // `onlyStoredIds`: the sessions this call may front (Bot Mode passes the
  // canonical chat's registry id + lineage tip). Other tabs in the owner's
  // zone stay open; they are simply not what the caller asked for.
  if (onlyStoredIds) {
    owned = owned.filter(tile => onlyStoredIds.includes(tile.storedSessionId))
  }

  if (owned.length === 0) {
    return null
  }

  // Most recent first, so the fallback (no remembered pane) is the newest tab.
  const paneIds = owned.map(tile => `${TILE_PANE_PREFIX}${tile.storedSessionId}`).reverse()
  const paneId = resolveRememberedActivePane(workspaceScopeKey('bots', workspaceOwnerKey), paneIds) ?? paneIds[0]
  const storedSessionId = paneId.slice(TILE_PANE_PREFIX.length)

  return focusOpenSession(storedSessionId, { workspaceMode: 'bots', workspaceOwnerKey }) === 'tile'
    ? storedSessionId
    : null
}


/** Does a sidebar click still need to navigate after `focusOpenSession`? A miss
 *  always does. A `'main'` hit does too while the workspace pane is showing a
 *  full page (artifacts, skills, …): fronting the workspace tab doesn't put the
 *  chat back on screen — only a route change back to the session does. A tile
 *  hit never does; its pane renders the chat regardless of the route. */
export function focusedSessionNeedsRoute(focused: 'main' | 'tile' | null, workspaceIsPage: boolean): boolean {
  return !focused || (focused === 'main' && workspaceIsPage)
}


/** Presentation scope of the session tab the user is currently acting from.
 * Picker actions must preserve this scope: a `/resume` opened from Bot Mode is
 * still a Bot tab with its exact owner route, not a Sessions-main navigation. */
export function focusedSessionWorkspaceScope(): SessionTileWorkspaceScope {
  const paneId = focusedSessionTabAnchor()

  if (paneId?.startsWith(TILE_PANE_PREFIX)) {
    const storedSessionId = paneId.slice(TILE_PANE_PREFIX.length)
    const tile = $sessionTiles.get().find(candidate => candidate.storedSessionId === storedSessionId)

    if (tile?.workspaceMode === 'bots') {
      return {
        ...(tile.ownerRoute ? { ownerRoute: tile.ownerRoute } : {}),
        workspaceMode: 'bots',
        ...(tile.workspaceOwnerKey ? { workspaceOwnerKey: tile.workspaceOwnerKey } : {}),
        ...(tile.workspaceTabTitle ? { workspaceTabTitle: tile.workspaceTabTitle } : {})
      }
    }
  }

  return { workspaceMode: 'sessions' }
}


/** The open tab that's still an empty "New session" draft, if there is one.
 *  That tab is the one the user would have typed into, so an open-from-nowhere
 *  spends it instead of stacking a second blank tab beside it. Most recent
 *  wins; a tile whose runtime hasn't bound (or whose state hasn't published) is
 *  unknown rather than empty, so it's left alone. */
export function blankDraftTile(
  tiles: readonly SessionTile[],
  states: Record<string, ClientSessionState>
): null | SessionTile {
  return (
    tiles.findLast(({ runtimeId }) => {
      const state = runtimeId ? states[runtimeId] : undefined

      return Boolean(state && !state.busy && state.messages.length === 0)
    }) ?? null
  )
}


/** Hand an open blank draft tab over to `storedSessionId`, keeping its slot.
 *  False when there's no such tab, so the caller can fall back. The spent draft
 *  is DISCARDED rather than closed: it never held a conversation, so ⌘⇧T
 *  resurrecting it would just restore an empty tab. */
export function reuseBlankDraftTile(
  storedSessionId: string,
  workspaceScope: SessionTileWorkspaceScope = { workspaceMode: 'sessions' }
): boolean {
  const tile = blankDraftTile($sessionTiles.get(), $sessionStates.get())

  if (!tile || tile.storedSessionId === storedSessionId) {
    return false
  }

  discardSessionTile(tile.storedSessionId)
  openSessionTile(storedSessionId, tile.dir, tile.anchor, tile.before, workspaceScope)
  revealTreePane(`${TILE_PANE_PREFIX}${storedSessionId}`)

  return true
}


export function closeSessionTile(storedSessionId: string) {
  const tile = $sessionTiles.get().find(t => t.storedSessionId === storedSessionId)

  if (tile) {
    const tree = $layoutTree.get()
    const paneId = `${TILE_PANE_PREFIX}${storedSessionId}`
    const group = tree ? findGroupOfPane(tree, paneId) : null
    const siblings = group?.panes.filter(id => id !== paneId) ?? []
    closedStack().push({
      ...toStored(tile),
      ...(group && siblings.length
        ? {
            anchor: siblings[0],
            before: group.panes[group.panes.indexOf(paneId) + 1] ?? null,
            dir: 'center'
          }
        : {})
    })
  }

  saveTiles($sessionTiles.get().filter(t => t.storedSessionId !== storedSessionId))

  // A settled session may never publish again, so the publish-time eviction
  // in publishSessionState can't reach it — drop its cached state here. A
  // BUSY one stays: its turn keeps streaming in the background, the sidebar
  // dot reads it, and settle evicts it. ⌘⇧T reopen re-publishes from the
  // wiring cache (resumeTile's warm path), so nothing is lost.
  const runtimeId = tile?.runtimeId
  const state = runtimeId ? $sessionStates.get()[runtimeId] : undefined

  if (runtimeId && state && evictable(runtimeId, state)) {
    dropSessionState(runtimeId)
  }
}


/** Persist-close every session tile whose pane lives in `paneId`'s group.
 *
 * Close All used to only dismiss layout-tree panes. Bot Mode tiles are
 * stored in the shared `__bots_workspace__` bucket, so a later roster
 * click or profile swap rehydrated `$sessionTiles` and the closed tabs
 * came back (#94137). Routing through {@link closeSessionTile} writes that
 * bucket, so the closed set survives those rehydrations and a restart.
 */
export function closeAllOpenSessionTiles(paneId: string): void {
  const tree = $layoutTree.get()
  // Copy the live group list. closeSessionTile can rewrite the layout
  // tree; iterating the original array would skip every other pane.
  const panes = [...((tree ? findGroupOfPane(tree, paneId) : null)?.panes ?? [])]

  for (const id of panes) {
    if (id.startsWith(TILE_PANE_PREFIX)) {
      closeSessionTile(id.slice(TILE_PANE_PREFIX.length))
    }
  }
}


/** Drop a DEAD tile — a persisted tile whose session no longer exists on the
 *  backend (resume 404s). Unlike close, it leaves no ⌘⇧T undo (resurrecting it
 *  would just 404 again) and evicts any cached state. This is what clears the
 *  "Session not found" resume spam from stale/cross-profile persisted tiles. */
export function discardSessionTile(storedSessionId: string) {
  const runtimeId = $sessionTiles.get().find(t => t.storedSessionId === storedSessionId)?.runtimeId

  if (runtimeId) {
    dropSessionState(runtimeId)
  }

  saveTiles($sessionTiles.get().filter(t => t.storedSessionId !== storedSessionId))
}


/** ⌘⇧T — reopen the most recently closed tab where it was, then focus it.
 *  Adoption alone is silent (won't steal the active tab), so restore has to
 *  front the pane explicitly. Skips ids that are live again (reopened / now
 *  the primary). */
export function reopenLastClosedTile(): void {
  const stack = closedStack()

  for (let tile = stack.pop(); tile; tile = stack.pop()) {
    const { storedSessionId } = tile

    if (storedSessionId === $selectedStoredSessionId.get()) {
      continue
    }

    if (!$sessionTiles.get().some(t => t.storedSessionId === storedSessionId)) {
      openSessionTile(storedSessionId, tile.dir, tile.anchor, tile.before, {
        workspaceMode: tile.workspaceMode ?? 'sessions',
        workspaceOwnerKey: tile.workspaceOwnerKey,
        workspaceTabTitle: tile.workspaceTabTitle,
        ownerRoute: tile.ownerRoute
      })
      focusOpenSession(storedSessionId)

      return
    }
  }
}


// Statusbar timer: stamp "focused since" for non-primary tiles so they share
// the primary's contract instead of the row's durable started_at (#103123).
// Primary focus leaves the stamp alone; the next tile focus re-stamps.
function stampTileSessionFocus(focused: null | string) {
  const stamp = tileFocusStampOnFocusChange(focused, $selectedStoredSessionId.get(), Date.now())

  if (stamp) {
    setTileSessionFocusStartedAt(stamp)
  }
}


// Bringing a finished session to the front clears its green dot. Keyed on the
// FOCUSED session, not the selected one: a tile is never $selectedStoredSessionId,
// and a tile tab click goes through activateTreePane rather than focusOpenSession,
// so this is the one hook that catches every way a tile reaches the front.
// Clears the whole conversation family (markSessionRead) AND acks the
// persisted watermark/marker (ackStoredSessionId) so the next list refresh
// doesn't repaint the dot the user just cleared by looking at it.
$focusedStoredSessionId.listen(focused => {
  if (focused) {
    markSessionRead(focused)
    ackStoredSessionId(focused)
  }

  stampTileSessionFocus(focused)
})


stampTileSessionFocus($focusedStoredSessionId.get())


// Cold-start restore is the one selection change that is NOT a navigation: the
// route already pointed at the primary session before the window loaded, and
// homing on it would front the workspace tab over the PERSISTED active tab —
// then persist that clobber, so the tab you reloaded on never comes back
// (⌘R always landing on main). use-route-resume arms this one-shot right
// before dispatching the boot resume; the very next selection change skips
// homing and the restored layout tree keeps its say.
let selectionRestoreInFlight = false


export function markSelectionRestore() {
  selectionRestoreInFlight = true
}


// Homing also FRONTS the workspace tab: the resumed chat loads in the workspace
// pane, so a zone parked on a tile tab must switch back or the click looks dead.
$selectedStoredSessionId.listen(selected => {
  const restoring = selectionRestoreInFlight
  selectionRestoreInFlight = false

  if (restoring || !selectionHomesToWorkspace(selected, $sessionTiles.get())) {
    return
  }

  noteActiveTreeGroup(null)
  revealTreePane('workspace')
})

// Dev hook for automation (mirrors __HERMES_LAYOUT_TREE__).
if ((import.meta.env.DEV || import.meta.env.VITE_PERF_PROBE === '1') && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__HERMES_SESSION_TILES__ = {
    close: closeSessionTile,
    drop: dropSessionState,
    open: openSessionTile,
    patch: patchSessionTile,
    publish: publishSessionState,
    /** Seed the recents list — models a populated sessions DB in perf runs. */
    seedSessions: (rows: SessionInfo[]) => setSessions(rows),
    sessions: () => $sessions.get(),
    states: () => $sessionStates.get(),
    tiles: () => $sessionTiles.get(),
    /** THE real gateway write path (wiring cache + journal + publish + view
     *  sync), unlike `publish` which only touches the store. Perf scenarios
     *  must drive this or they under-model streaming cost. */
    update: (runtimeId: string, updater: (state: ClientSessionState) => ClientSessionState) =>
      sessionTileDelegate()?.updateSession(runtimeId, updater)
  }
}
