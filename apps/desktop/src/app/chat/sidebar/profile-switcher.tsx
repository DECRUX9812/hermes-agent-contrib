import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates
} from '@dnd-kit/sortable'
import { LOCAL_CONNECTION_ID } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import type { ProfileScope } from '@/api/client'
import { edgeMask, scrollEdges } from '@/components/ui/fade-scroll'
import { useResizeObserver } from '@/hooks/use-resize-observer'
import { useI18n } from '@/i18n'
import { sortConnectionsForDisplay } from '@/lib/connection-display'
import { triggerHaptic } from '@/lib/haptics'
import { isBrowserHostedDesktop } from '@/lib/platform'
import { resolveProfileColor } from '@/lib/profile-color'
import {
  reorderCommitHaptic,
  reorderStepHaptic
} from '@/lib/reorder'
import {
  $activeConnectionId,
  $connectionsRegistry,
  $hasMultipleConnections,
  selectConnection
} from '@/store/connections'
import { $fleetRoster, refreshFleetRoster } from '@/store/fleet-roster'
import { $fleetRuns } from '@/store/fleet-runs'
import { notifyError } from '@/store/notifications'
import {
  $activeGatewayProfile,
  $profileColors,
  $profileCreateRequest,
  $profileOrder,
  $profiles,
  $profileScope,
  ALL_PROFILES,
  normalizeProfileKey,
  profileLabel,
  refreshActiveProfile,
  selectProfile,
  setProfileColor,
  setProfileOrder,
  setShowAllProfiles,
  sortByProfileOrder
} from '@/store/profile'
import {
  $profileRemoteOverrides,
  openRemoteOverrideDialog,
  refreshProfileRemoteOverrides
} from '@/store/profile-remote-override'
import { runImportProfileFlow } from '@/store/profile-share'
import type { ProfileInfo } from '@/types/hermes'

import { CreateProfileDialog } from '../../profiles/create-profile-dialog'
import { DeleteProfileDialog } from '../../profiles/delete-profile-dialog'
import { RenameProfileDialog } from '../../profiles/rename-profile-dialog'
import { PROFILES_ROUTE, ROSTER_ROUTE, SETTINGS_ROUTE } from '../../routes'

import { buildRestGroups, countRestAgents, type FleetAgent, type FleetGroup, fleetRouteKey } from './fleet-rail'
import { useLocalDeviceSwitch } from './local-device-switch'
import { ProfileRemoteOverrideDialog } from './profile-remote-override-dialog'
import { AddProfileButton, EditSoulDialog, ImportProfileButton, ProfileDropdown } from './profile-switcher-dropdown'
import { FleetDivider, FleetRestGroup, ProfilePill, ProfileSquare } from './profile-switcher-squares'
import { useFleetRoster } from './use-fleet-roster'
import { useProfileRailRefreshOnActive } from './use-profile-rail-refresh-on-active'

const RAIL_GAP = 4 // px — matches gap-1 between squares.

// Past this many profiles the strip of colored squares stops scaling (tiny
// drag targets, endless horizontal scroll), so the rail collapses to a compact
// menu. Drag-reorder and long-press-recolor live only on the squares path.
const PROFILE_DROPDOWN_THRESHOLD = 13

// The Webapp always takes the dropdown: squares are a native-window gesture
// surface (drag, hold-to-recolor), and in a browser tab they read as chrome.
const ALWAYS_CONDENSED = isBrowserHostedDesktop()

// The rail is a single horizontal strip of fixed cells. Pin drags to the x-axis
// (no cross-axis scrollbar), snap to whole cells so a square steps slot-to-slot
// instead of gliding, and clamp to the occupied strip so it can't float past the
// last profile onto the "+".
const stepThroughCells: Modifier = ({ containerNodeRect, draggingNodeRect, transform }) => {
  if (!draggingNodeRect || !containerNodeRect) {
    return { ...transform, y: 0 }
  }

  const pitch = draggingNodeRect.width + RAIL_GAP
  const minX = containerNodeRect.left - draggingNodeRect.left
  const maxX = containerNodeRect.right - draggingNodeRect.right
  const snapped = Math.round(transform.x / pitch) * pitch

  return { ...transform, x: Math.min(maxX, Math.max(minX, snapped)), y: 0 }
}

// Arc-Spaces-style profile rail at the sidebar foot: a default↔all toggle pinned
// left, the colored named profiles scrolling between, and Manage pinned right.
// The active profile pops in its own color — the "where am I" cue.
//
// With one registered gateway this is the whole story. With several, the rail
// becomes the FLEET rail: the active gateway's profiles stay exactly as they
// are, and every other registered gateway follows on the same strip as an
// at-rest group — a hairline, that gateway's kind glyph, its default home
// square and its named squares, dimmed. Clicking an at-rest square performs
// the same re-home the statusbar switcher does, landing on that exact
// (gateway, profile); the workspace still lives on one gateway at a time, only
// the picker spans the fleet. Groups keep registry order regardless of which
// one is active, so a square never moves under the pointer that clicked it.
export function ProfileRail() {
  const { t, locale } = useI18n()
  const p = t.profiles
  const profiles = useStore($profiles)
  const scope = useStore($profileScope)
  const gatewayProfile = useStore($activeGatewayProfile)
  const order = useStore($profileOrder)
  const colors = useStore($profileColors)
  const remoteOverrides = useStore($profileRemoteOverrides)
  const multipleConnections = useStore($hasMultipleConnections)
  const registry = useStore($connectionsRegistry)
  const activeConnectionId = useStore($activeConnectionId)
  const roster = useStore($fleetRoster)
  const fleetRunCount = useStore($fleetRuns).length
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingRename, setPendingRename] = useState<null | ProfileInfo>(null)
  const [pendingDelete, setPendingDelete] = useState<null | ProfileInfo>(null)
  const [pendingSoul, setPendingSoul] = useState<null | string>(null)
  // Fleet-side counterparts: the at-rest square being acted on. Its route is
  // the dialog's scope, so the edit executes on the owning gateway.
  const [pendingRestRename, setPendingRestRename] = useState<null | FleetAgent>(null)
  const [pendingRestDelete, setPendingRestDelete] = useState<null | FleetAgent>(null)
  const [pendingRestSoul, setPendingRestSoul] = useState<null | FleetAgent>(null)
  // Route key of the at-rest square whose switch is dialing (spinner on that
  // square, not in the statusbar — the previous source stays painted).
  const [pendingRoute, setPendingRoute] = useState<null | string>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const [scrollMask, setScrollMask] = useState<string | undefined>()
  const [dragging, setDragging] = useState(false)
  const { dialog: localDeviceDialog, request: requestLocalDevice } = useLocalDeviceSwitch()

  useFleetRoster(multipleConnections)

  const connections = registry?.connections

  const restGroups = useMemo(
    () =>
      multipleConnections ? buildRestGroups({ activeConnectionId, connections: connections ?? [], order, roster }) : [],
    [activeConnectionId, connections, multipleConnections, order, roster]
  )

  // Fleet mode needs something to show beside the active gateway. Two
  // registrations of one backend collapse to a single roster source, which
  // keeps the rail on its single-gateway path.
  const fleet = restGroups.length > 0

  // Registry order for the whole strip, active group included — the active
  // gateway keeps its slot instead of jumping to the front on a switch.
  const activeConnection = connections?.find(connection => connection.id === activeConnectionId) ?? null
  // Named picks on This device retain the legacy profile door, which resolves
  // per-profile remote overrides. At-rest fleet actions keep their exact source.
  const namedProfileConnectionId = activeConnectionId === LOCAL_CONNECTION_ID ? null : activeConnectionId

  const fleetSequence = useMemo(() => {
    const byId = new Map(restGroups.map(group => [group.connectionId, group]))
    const ordered = sortConnectionsForDisplay(connections ?? [])
    const sequence: Array<{ kind: 'active' } | { group: FleetGroup; kind: 'rest' }> = []
    let activePlaced = false

    for (const connection of ordered) {
      if (connection.id === activeConnectionId) {
        sequence.push({ kind: 'active' })
        activePlaced = true
      } else {
        const group = byId.get(connection.id)

        if (group) {
          sequence.push({ group, kind: 'rest' })
        }
      }
    }

    // Legacy primary path publishes no connection id: the active gateway is
    // unknown to the registry, so it leads the strip.
    if (!activePlaced) {
      sequence.unshift({ kind: 'active' })
    }

    return sequence
  }, [activeConnectionId, connections, restGroups])

  // Too many profiles for the square strip → collapse to the select. Declared
  // ahead of the wheel effect, which re-binds when the strip mounts/unmounts.
  // The threshold counts the whole fleet: fourteen squares are fourteen
  // squares wherever they live.
  const condensed = ALWAYS_CONDENSED || profiles.length + countRestAgents(restGroups) > PROFILE_DROPDOWN_THRESHOLD

  const measureScroll = useCallback(() => {
    const el = scrollRef.current

    if (condensed || !el) {
      setScrollMask(undefined)

      return
    }

    setScrollMask(
      edgeMask(
        scrollEdges({
          clientHeight: el.clientWidth,
          scrollHeight: el.scrollWidth,
          scrollTop:
            getComputedStyle(el).direction === 'rtl' ? el.scrollWidth - el.clientWidth + el.scrollLeft : el.scrollLeft
        }),
        'x'
      )
    )
  }, [condensed])

  // Observe both widths: adding/removing a profile need not resize the viewport.
  useResizeObserver(measureScroll, scrollRef, scrollContentRef)

  // The provider applies document direction in its effect; measure next frame.
  useEffect(() => {
    const frame = requestAnimationFrame(measureScroll)

    return () => cancelAnimationFrame(frame)
  }, [locale, measureScroll])

  const switchToRest = (agent: FleetAgent) => {
    const commitRestSwitch = (target: FleetAgent) => {
      const key = fleetRouteKey(target.connectionId, target.profile)
      triggerHaptic('selection')
      setPendingRoute(key)

      void selectConnection(target.connectionId, { profile: target.profile })
        .catch((error: unknown) => notifyError(error, p.switchConnectionFailed(target.connectionLabel)))
        .finally(() => setPendingRoute(current => (current === key ? null : current)))
    }

    if (agent.connectionKind !== 'local') {
      commitRestSwitch(agent)

      return
    }

    // Probe spinner only. The dialog — install confirm or fresh-session cue —
    // must be on screen before selectConnection replaces the center.
    const key = fleetRouteKey(agent.connectionId, agent.profile)
    setPendingRoute(key)

    void requestLocalDevice({
      connectionId: agent.connectionId,
      label: agent.connectionLabel,
      profile: agent.profile,
      replaceCenter: agent.profile === 'default'
    }).then(accepted => {
      setPendingRoute(current => (current === key ? null : current))

      if (accepted) {
        commitRestSwitch(agent)
      }
    })
  }

  const restScope = (agent: FleetAgent): ProfileScope => ({ connectionId: agent.connectionId, profile: agent.profile })

  // A plain mouse wheel only emits deltaY; map it to horizontal scroll so the
  // rail is navigable without a trackpad. Trackpad x-scroll (deltaX) passes
  // through. Native + non-passive so we can preventDefault and not bleed the
  // gesture into the sessions list above.
  useEffect(() => {
    const el = scrollRef.current

    if (!el) {
      return
    }

    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return
      }

      el.scrollLeft += event.deltaY * (getComputedStyle(el).direction === 'rtl' ? -1 : 1)
      event.preventDefault()
    }

    el.addEventListener('wheel', onWheel, { passive: false })

    return () => el.removeEventListener('wheel', onWheel)
    // `condensed` swaps the strip out for the dropdown (ref goes null/back).
  }, [condensed])

  const isAll = scope === ALL_PROFILES
  const activeKey = normalizeProfileKey(gatewayProfile)
  const defaultProfile = profiles.find(profile => profile.is_default)
  const onDefault = !isAll && activeKey === 'default'

  const named = sortByProfileOrder(
    profiles.filter(profile => !profile.is_default),
    order
  )

  const multiProfile = profiles.length > 1

  // distance constraint: a small drag reorders, a tap still selects the profile.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Tick a haptic each time the drag crosses into a new cell, and a satisfying
  // confirm on a committed reorder.
  const lastOverRef = useRef<string | null>(null)

  const handleDragStart = ({ active }: DragStartEvent) => {
    setDragging(true)
    lastOverRef.current = String(active.id)
  }

  const handleDragOver = ({ over }: DragOverEvent) => {
    const id = over ? String(over.id) : null

    if (id && id !== lastOverRef.current) {
      lastOverRef.current = id
      reorderStepHaptic()
    }
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(false)
    lastOverRef.current = null

    if (!over || active.id === over.id) {
      return
    }

    const ids = named.map(profile => profile.name)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))

    if (from >= 0 && to >= 0) {
      setProfileOrder(arrayMove(ids, from, to))
      reorderCommitHaptic()
    }
  }

  // Re-pull the running profile + list on mount, and again whenever the window
  // regains focus/visibility -- a profile created, deleted, or renamed by
  // another surface (Manage Profiles, another window, the CLI) leaves this
  // rail's cached $profiles stale until something re-fetches it. See
  // use-profile-rail-refresh-on-active.ts for the extracted (and tested)
  // wiring.
  useProfileRailRefreshOnActive()

  // Which profiles carry a per-profile remote override (connection.json
  // profiles.<name>) — refreshed whenever the profile list changes so the
  // rail's "remote" badge tracks create/rename/override edits.
  const profileNames = profiles.map(profile => profile.name)
  const profileNamesKey = profileNames.join('\u0000')

  useEffect(() => {
    void refreshProfileRemoteOverrides(profileNamesKey ? profileNamesKey.split('\u0000') : [])
  }, [profileNamesKey])

  // Open the create dialog when the `profile.create` hotkey fires (the dialog
  // state lives here, so the global keybind bumps a request atom we watch).
  const createRequest = useStore($profileCreateRequest)
  const lastCreateRef = useRef(createRequest)

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    if (createRequest === lastCreateRef.current) {
      return
    }

    lastCreateRef.current = createRequest
    setCreateOpen(true)
  }, [createRequest])

  // The sortable strip of the active gateway's named profiles (unchanged
  // from the single-gateway rail; fleet mode only decides where it sits).
  const activeStrip = (
    <>
      {multiProfile && (
        <DndContext
          collisionDetection={closestCenter}
          modifiers={[stepThroughCells]}
          onDragCancel={() => setDragging(false)}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragStart={handleDragStart}
          sensors={sensors}
        >
          <SortableContext items={named.map(profile => profile.name)} strategy={horizontalListSortingStrategy}>
            {/* relative → the strip is the dragged square's offsetParent, so the
              clamp modifier bounds drags to the occupied cells (not the +). */}
            <div className="relative flex items-center gap-1">
              {named.map(profile => (
                <ProfileSquare
                  active={!isAll && normalizeProfileKey(profile.name) === activeKey}
                  color={resolveProfileColor(profile.name, colors)}
                  connectionId={namedProfileConnectionId}
                  key={profile.name}
                  label={profileLabel(profile)}
                  name={profile.name}
                  // The legacy per-profile remote override predates the
                  // gateway registry; once the rail shows machines directly
                  // it only confuses, so it is offered on single-gateway
                  // setups only.
                  onConnectRemote={multipleConnections ? undefined : () => openRemoteOverrideDialog(profile.name)}
                  onDelete={() => setPendingDelete(profile)}
                  onEditSoul={() => setPendingSoul(profile.name)}
                  onRecolor={color => setProfileColor(profile.name, color)}
                  onRename={() => setPendingRename(profile)}
                  onSelect={() => selectProfile(profile.name)}
                  remoteHost={remoteOverrides[normalizeProfileKey(profile.name)]?.host ?? null}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </>
  )

  return (
    // `data-tour` as well as `data-slot`: only the former is identity to the
    // tour collector and the tip catalog, and the rail's one other durable
    // handle is a TRANSLATED aria-label, which stops matching the moment the
    // app isn't in English.
    <div
      aria-label={p.title}
      className="flex min-w-0 items-center gap-0.5"
      data-slot="profile-rail"
      data-tip-region=""
      data-tour="profile-rail"
      role="group"
    >
      {/* Fleet: every gateway carries its own home square inside its group, so
          the pinned pill is purely the "all profiles on this gateway" toggle. */}
      {fleet && (
        <ProfilePill
          active={isAll}
          glyph="layers"
          label={p.fleet.allOnGateway}
          onSelect={() => setShowAllProfiles(true)}
        />
      )}

      {/* One button toggles default ↔ all: home face when scoped to a profile,
          layers face when showing everything. Pinned left like Manage is right.
          Hidden until a second profile exists. */}
      {!fleet &&
        multiProfile &&
        (defaultProfile ? (
          // On default → toggle to all. Anywhere else (all view or a named
          // profile) → return to default. So leaving a profile never lands on all.
          <ProfilePill
            active={isAll || onDefault}
            connectionId={activeConnectionId ?? undefined}
            glyph={isAll ? 'layers' : 'home'}
            label={onDefault ? p.showAllProfiles : p.switchToProfile(profileLabel(defaultProfile))}
            onSelect={() => (onDefault ? setShowAllProfiles(true) : selectProfile(defaultProfile.name))}
            profile={defaultProfile.name}
          />
        ) : (
          <ProfilePill active={isAll} glyph="layers" label={p.allProfiles} onSelect={() => setShowAllProfiles(true)} />
        ))}

      {/* Single-profile: the active default's home icon next to the create +. */}
      {!fleet && !multiProfile && defaultProfile && (
        <ProfilePill
          active
          connectionId={activeConnectionId ?? undefined}
          glyph="home"
          label={profileLabel(defaultProfile)}
          onSelect={() => selectProfile(defaultProfile.name)}
          profile={defaultProfile.name}
        />
      )}

      {condensed ? (
        // Condensed path: one compact dropdown instead of N squares. No drag
        // reorder or long-press recolor; right-click rows keeps launch actions
        // available, while Manage covers rename/delete at this scale.
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <ProfileDropdown
            activeKey={isAll ? null : activeKey}
            colors={colors}
            connectionId={namedProfileConnectionId}
            homeConnectionId={activeConnectionId}
            onCreate={() => setCreateOpen(true)}
            onImport={() => void runImportProfileFlow()}
            onSelect={selectProfile}
            onSelectRest={switchToRest}
            // Fleet drops the home pill, so the menu is the active default's
            // only door; every at-rest group already lists its own (#106017, #131632).
            profiles={fleet && defaultProfile ? [defaultProfile, ...named] : named}
            restGroups={restGroups}
          />
        </div>
      ) : (
        <>
          <div
            className="scroll-edge-fade-x flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={measureScroll}
            ref={scrollRef}
            style={{ maskImage: dragging ? undefined : scrollMask }}
          >
            <div className="flex shrink-0 items-center gap-1" ref={scrollContentRef}>
              {/* The active gateway's squares. In fleet mode they sit in the
              gateway's registry slot with a home square at their head, so the
              strip keeps one shape whichever gateway is active. */}
              {fleet
                ? fleetSequence.map((entry, index) =>
                    entry.kind === 'active' ? (
                      <Fragment key="active">
                        <FleetDivider
                          connection={activeConnection}
                          first={index === 0}
                          label={activeConnection ? p.fleet.gateway(activeConnection.label) : null}
                          reachable
                        />
                        <span
                          aria-label={activeConnection ? p.fleet.gateway(activeConnection.label) : undefined}
                          className="flex shrink-0 items-center gap-1"
                          data-active="true"
                          data-connection-id={activeConnection?.id}
                          data-slot="profile-rail-gateway"
                          role="group"
                        >
                          {defaultProfile && (
                            <ProfilePill
                              active={onDefault}
                              connectionId={activeConnectionId ?? undefined}
                              glyph="home"
                              label={profileLabel(defaultProfile)}
                              onSelect={() => selectProfile(defaultProfile.name)}
                              profile={defaultProfile.name}
                            />
                          )}
                          {activeStrip}
                        </span>
                      </Fragment>
                    ) : (
                      <FleetRestGroup
                        colors={colors}
                        first={index === 0}
                        group={entry.group}
                        key={entry.group.connectionId}
                        onDelete={setPendingRestDelete}
                        onEditSoul={setPendingRestSoul}
                        onRecolor={(agent, color) => setProfileColor(agent.profile, color)}
                        onRename={setPendingRestRename}
                        onSelect={switchToRest}
                        pendingRoute={pendingRoute}
                      />
                    )
                  )
                : activeStrip}
            </div>
          </div>
          <AddProfileButton label={p.newProfile} onClick={() => setCreateOpen(true)} />
          <ImportProfileButton label={p.importProfile} />
        </>
      )}

      {/* Always reachable, even with only the default profile: the manage
          overlay is the only place to edit a profile's SOUL.md, and a
          single-profile user must be able to edit the default's persona
          without first creating a throwaway second profile. */}
      <ProfilePill active={false} glyph="ellipsis" label={p.manageProfiles} onSelect={() => navigate(PROFILES_ROUTE)} />

      {/* Roster — self-limiting affordance: the pill exists only while a run
          is actually in flight somewhere across the fleet, and opens the
          roster overlay (click-through cards, no actions). */}
      {fleetRunCount > 0 && (
        <ProfilePill
          active={false}
          glyph="pulse"
          label={t.roster.railPill(fleetRunCount)}
          onSelect={() => navigate(ROSTER_ROUTE)}
          slot="profile-rail-roster"
        />
      )}

      {localDeviceDialog}

      {/* Multi-gateway discoverability: before a second source exists, a plug
          pinned beside Manage deep-links to the unified Gateways page. Once
          there are several sources, the same action lives in their selector. */}
      {!multipleConnections && (
        <ProfilePill
          active={false}
          glyph="plug"
          label={p.connectGateway}
          onSelect={() => navigate(`${SETTINGS_ROUTE}?tab=gateway`)}
        />
      )}

      {/* Land in the new profile on a fresh chat (selectProfile triggers the
          new-session reset), not stuck on the session you were just in. */}
      <CreateProfileDialog
        onClose={() => setCreateOpen(false)}
        onCreated={async name => {
          await refreshActiveProfile()
          selectProfile(name)
        }}
        open={createOpen}
        profiles={profiles}
      />

      <RenameProfileDialog
        currentName={pendingRename?.name ?? ''}
        isDefault={pendingRename?.is_default ?? false}
        onClose={() => setPendingRename(null)}
        onRenamed={refreshActiveProfile}
        open={pendingRename !== null}
      />

      <DeleteProfileDialog
        onClose={() => setPendingDelete(null)}
        onDeleted={refreshActiveProfile}
        open={pendingDelete !== null}
        profile={pendingDelete}
      />

      <EditSoulDialog onClose={() => setPendingSoul(null)} profileName={pendingSoul} />

      {/* Fleet-side dialogs: scoped to the at-rest square's owning gateway, and
          they refresh the roster (not the active profile list) on success. */}
      <RenameProfileDialog
        currentName={pendingRestRename?.profile ?? ''}
        onClose={() => setPendingRestRename(null)}
        onRenamed={() => refreshFleetRoster({ force: true })}
        open={pendingRestRename !== null}
        scope={pendingRestRename ? restScope(pendingRestRename) : undefined}
      />

      <DeleteProfileDialog
        gatewayLabel={pendingRestDelete?.connectionLabel}
        onClose={() => setPendingRestDelete(null)}
        onDeleted={() => refreshFleetRoster({ force: true })}
        open={pendingRestDelete !== null}
        profile={pendingRestDelete ? { name: pendingRestDelete.profile, path: pendingRestDelete.handle } : null}
        scope={pendingRestDelete ? restScope(pendingRestDelete) : undefined}
      />

      <EditSoulDialog
        gatewayLabel={pendingRestSoul?.connectionLabel}
        onClose={() => setPendingRestSoul(null)}
        profileName={pendingRestSoul?.profile ?? null}
        scope={pendingRestSoul ? restScope(pendingRestSoul) : undefined}
      />

      <ProfileRemoteOverrideDialog profileNames={profileNames} />
    </div>
  )
}
