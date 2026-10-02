import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ColorSwatches } from '@/components/ui/color-swatches'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Tip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { DesktopRegistryConnection } from '@/global'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Loader2 } from '@/lib/icons'
import { PROFILE_SWATCHES, profileColorSoft, resolveProfileColor } from '@/lib/profile-color'
import { profileShortLabel } from '@/lib/profile-short-label'
import { cn } from '@/lib/utils'
import { runExportProfileFlow } from '@/store/profile-share'

import { ConnectionGlyph } from './connection-glyph'
import { type FleetAgent, type FleetGroup, fleetRouteKey } from './fleet-rail'
import { ProfileLaunchContextMenu, ProfileLaunchMenuSection } from './profile-launch-menu'
import {
  DRAG_TRANSITION,
  ProfileStatusDot,
  profileStatusLabel,
  RAIL_TRANSITION,
  useProfileStatus
} from './profile-switcher-status'
import { useProfilePrewarm } from './use-profile-prewarm'

interface ProfilePillProps {
  active: boolean
  // home / All / Manage are glyph action buttons (navigation, not identity).
  glyph: string
  label: string
  onSelect: () => void
  // Fleet at-rest: dimmed until hovered, like the at-rest squares beside it.
  muted?: boolean
  pending?: boolean
  slot?: string
  connectionId?: string
  profile?: string
}

export function ProfilePill({
  active,
  connectionId,
  glyph,
  label,
  muted = false,
  onSelect,
  pending = false,
  profile,
  slot
}: ProfilePillProps) {
  const { t } = useI18n()
  const p = t.profiles
  // The default profile's home face carries the same rollup as a named square
  // (its sessions can finish while another profile is selected too), again
  // suppressed while it is the active home (#91710).
  const summary = useProfileStatus(profile ?? null, connectionId)
  const statusText = !active && summary ? profileStatusLabel(p, summary) : null
  const accessibleLabel = statusText ? `${label}, ${statusText}` : label

  const button = (
    <Tip label={accessibleLabel}>
      <Button
        aria-busy={pending || undefined}
        aria-label={accessibleLabel}
        aria-pressed={active}
        className={cn(
          'bg-transparent text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground',
          active && 'bg-(--ui-control-active-background) text-foreground',
          muted && 'opacity-40 hover:opacity-100',
          summary && !active && 'relative'
        )}
        data-connection-id={connectionId}
        data-slot={slot}
        onClick={onSelect}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        ) : (
          <Codicon name={glyph} size="0.875rem" />
        )}
        {summary && !active && (
          <span className="absolute -right-0.5 -top-0.5">
            <ProfileStatusDot summary={summary} />
          </span>
        )}
      </Button>
    </Tip>
  )

  return profile ? (
    <ProfileLaunchContextMenu connectionId={connectionId ?? null} label={profile} profile={profile}>
      {button}
    </ProfileLaunchContextMenu>
  ) : (
    button
  )
}

// The gateway marker that heads every group on the fleet rail: its kind glyph
// (device / network / terminal / cloud — the same glyph the statusbar readout
// uses), an amber dot when the roster last found it unreachable, and a hairline
// separating it from the previous group. The first group gets no hairline.
export function FleetDivider({
  connection,
  first,
  label,
  reachable
}: {
  connection: null | Pick<FleetGroup, 'connectionId' | 'kind'> | Pick<DesktopRegistryConnection, 'id' | 'kind'>
  first: boolean
  label: null | string
  reachable: boolean
}) {
  if (!connection) {
    return null
  }

  const connectionId = 'connectionId' in connection ? connection.connectionId : connection.id

  const marker = (
    <span
      aria-hidden="true"
      className={cn('flex h-5 shrink-0 items-center gap-0.5', first ? 'mr-0.5' : 'mx-0.5')}
      data-connection-id={connectionId}
      data-reachable={reachable}
      data-slot="profile-rail-divider"
    >
      {!first && <span className="h-3 w-px bg-(--ui-stroke-tertiary)" />}
      <ConnectionGlyph connection={connection} />
      {!reachable && <span className="size-1.5 rounded-full bg-amber-500" data-slot="profile-rail-unreachable" />}
    </span>
  )

  return label ? <Tip label={label}>{marker}</Tip> : marker
}

// One at-rest gateway on the fleet rail: hairline + kind glyph (amber dot when
// the roster last found it unreachable — never hidden, a sleeping box is still
// yours), then its home square and named squares, dimmed. Clicking any of
// them re-homes onto that exact (gateway, profile).
export function FleetRestGroup({
  colors,
  first,
  group,
  onDelete,
  onEditSoul,
  onRecolor,
  onRename,
  onSelect,
  pendingRoute
}: {
  colors: Record<string, string>
  first: boolean
  group: FleetGroup
  onDelete: (agent: FleetAgent) => void
  onEditSoul: (agent: FleetAgent) => void
  onRecolor: (agent: FleetAgent, color: null | string) => void
  onRename: (agent: FleetAgent) => void
  onSelect: (agent: FleetAgent) => void
  pendingRoute: null | string
}) {
  const { t } = useI18n()
  const p = t.profiles

  const dividerLabel = group.reachable
    ? p.fleet.gateway(group.label)
    : `${group.needsSignIn ? `${p.fleet.gateway(group.label)} · ${t.settings.toolsets.needsSignIn}` : p.fleet.gatewayUnreachable(group.label)}${group.error ? `\n${group.error}` : ''}`

  const defaultKey = fleetRouteKey(group.connectionId, group.defaultAgent.profile)
  // At rest, This device is a backend switch, not Home. The house glyph stays
  // on the active gateway's default profile.
  const localDefault = group.kind === 'local'

  return (
    <>
      <FleetDivider connection={group} first={first} label={dividerLabel} reachable={group.reachable} />
      <span
        aria-label={p.fleet.gateway(group.label)}
        className="flex shrink-0 items-center gap-1"
        data-active="false"
        data-connection-id={group.connectionId}
        data-reachable={group.reachable}
        data-slot="profile-rail-gateway"
        role="group"
      >
        <ProfilePill
          active={false}
          connectionId={group.connectionId}
          glyph={localDefault ? 'device-desktop' : 'home'}
          label={localDefault ? p.fleet.localDevice : p.fleet.onGateway(group.defaultAgent.profile, group.label)}
          muted
          onSelect={() => onSelect(group.defaultAgent)}
          pending={pendingRoute === defaultKey}
          profile={group.defaultAgent.profile}
          slot={localDefault ? 'profile-rail-local-device' : 'profile-rail-rest-home'}
        />
        {group.named.map(agent => (
          <RestSquare
            agent={agent}
            color={resolveProfileColor(agent.profile, colors)}
            key={agent.profile}
            onDelete={() => onDelete(agent)}
            onEditSoul={() => onEditSoul(agent)}
            onRecolor={color => onRecolor(agent, color)}
            onRename={() => onRename(agent)}
            onSelect={() => onSelect(agent)}
            pending={pendingRoute === fleetRouteKey(agent.connectionId, agent.profile)}
          />
        ))}
      </span>
    </>
  )
}

// An at-rest square: the same tile as ProfileSquare, minus drag-reorder and
// hold-to-recolor (the strip it lives in is not sortable across machines).
// Tooltip and accessible name carry the gateway so two same-named profiles on
// different machines never read alike; the right-click actions run against
// the square's owning gateway.
export function RestSquare({
  agent,
  color,
  onDelete,
  onEditSoul,
  onRecolor,
  onRename,
  onSelect,
  pending
}: {
  agent: FleetAgent
  color: null | string
  onDelete: () => void
  onEditSoul: () => void
  onRecolor: (color: null | string) => void
  onRename: () => void
  onSelect: () => void
  pending: boolean
}) {
  const { t } = useI18n()
  const p = t.profiles
  const hue = color ?? 'var(--ui-text-quaternary)'
  const [pickerOpen, setPickerOpen] = useState(false)
  const label = p.fleet.onGateway(agent.profile, agent.connectionLabel)

  // An at-rest gateway's square always carries its profiles' rollup — it is
  // never the active square, and its sessions are not on screen anywhere
  // else (#91710).
  const summary = useProfileStatus(agent.profile, agent.connectionId)
  const statusText = summary ? profileStatusLabel(p, summary) : null

  const pickColor = (next: null | string) => {
    onRecolor(next)
    setPickerOpen(false)
    triggerHaptic('selection')
  }

  return (
    <Popover onOpenChange={setPickerOpen} open={pickerOpen}>
      <ContextMenu>
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <PopoverAnchor asChild>
              <ContextMenuTrigger asChild>
                <TooltipTrigger asChild>
                  <button
                    aria-busy={pending || undefined}
                    aria-label={statusText ? `${label}, ${statusText}` : label}
                    className="relative grid size-5 shrink-0 select-none place-items-center rounded-(--control-icon-radius) text-[0.5625rem] font-semibold uppercase leading-none opacity-35 transition-opacity hover:opacity-100 aria-busy:opacity-100"
                    data-connection-id={agent.connectionId}
                    data-profile={agent.profile}
                    data-slot="profile-rail-rest-square"
                    onClick={onSelect}
                    style={{ backgroundColor: profileColorSoft(hue, 22), color: color ?? undefined }}
                    type="button"
                  >
                    {pending ? (
                      <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                    ) : (
                      profileShortLabel(agent.profile)
                    )}
                    {summary && (
                      <span className="absolute -bottom-0.5 -right-0.5">
                        <ProfileStatusDot summary={summary} />
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
              </ContextMenuTrigger>
            </PopoverAnchor>
            <TooltipContent>{statusText ? `${label} · ${statusText}` : label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <ContextMenuContent
          aria-label={p.actions}
          className="min-w-52"
          collisionPadding={{ bottom: 44, left: 8, right: 8, top: 8 }}
          onCloseAutoFocus={event => event.preventDefault()}
        >
          <ProfileLaunchMenuSection connectionId={agent.connectionId} label={label} profile={agent.profile} />
          <ContextMenuItem onSelect={onSelect}>
            <Codicon name="arrow-right" size="0.875rem" />
            <span className="truncate">{p.fleet.switchTo(agent.profile, agent.connectionLabel)}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setPickerOpen(true)}>
            <Codicon name="symbol-color" size="0.875rem" />
            <span>{p.color}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={onRename}>
            <Codicon name="text-size" size="0.875rem" />
            <span>{p.renameMenu}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={onEditSoul}>
            <Codicon name="edit" size="0.875rem" />
            <span>{p.editSoul}</span>
          </ContextMenuItem>
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={onDelete}
            variant="destructive"
          >
            <Codicon name="trash" size="0.875rem" />
            <span>{t.common.delete}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <PopoverContent
        aria-label={p.colorFor}
        className="w-auto p-2"
        collisionPadding={{ bottom: 44, left: 8, right: 8, top: 8 }}
        side="top"
      >
        <ColorSwatches
          clearIcon="sync"
          clearLabel={p.autoColor}
          onChange={pickColor}
          swatches={PROFILE_SWATCHES}
          swatchLabel={p.setColor}
          value={color}
        />
      </PopoverContent>
    </Popover>
  )
}

interface ProfileSquareProps {
  active: boolean
  color: null | string
  connectionId: null | string
  label: string
  name: string
  onSelect: () => void
  onRecolor: (color: null | string) => void
  onRename: () => void
  onEditSoul: () => void
  // Absent on multi-gateway setups: the legacy per-profile remote override
  // is superseded by the fleet rail there.
  onConnectRemote?: () => void
  onDelete: () => void
  // hostname[:port] of this profile's remote override, or null when the
  // profile runs locally. Drives the "remote" badge on the square.
  remoteHost: null | string
}

// Hold this long without moving (a drag would have started first) to open the
// color picker — the "hard press" gesture, distinct from tap-to-select.
const LONG_PRESS_MS = 450

// A profile *is* its colored square — no icon-button chrome. Soft profile-tint
// fill + the initial in the full color; the active one pops to full opacity with
// a color ring. These pack tightly so the rail reads as a strip of profiles,
// drag-sort to reorder (a tap below the drag threshold still selects), and
// right-click to rename/delete. The button carries both the tooltip and
// context-menu triggers via nested asChild Slots, so a single element keeps the
// dnd listeners, hover tip, and right-click menu.
export function ProfileSquare({
  active,
  color,
  connectionId,
  label,
  name,
  onConnectRemote,
  onDelete,
  onEditSoul,
  onRecolor,
  onRename,
  onSelect,
  remoteHost
}: ProfileSquareProps) {
  const { t } = useI18n()
  const p = t.profiles
  const hue = color ?? 'var(--ui-text-quaternary)'
  const [pickerOpen, setPickerOpen] = useState(false)
  const pressTimer = useRef<null | number>(null)
  const suppressClick = useRef(false)
  // Hovering a square telegraphs the switch — start that profile's backend
  // spawn now so a cold click doesn't pay the full boot.
  const { cancelPrewarm, notePointerMove, startPrewarm } = useProfilePrewarm(name)

  // The square carries its profile's session rollup — but never when active:
  // the workspace is homed there and the sidebar below already shows that
  // profile's own row dots (#91710).
  const summary = useProfileStatus(name, connectionId)
  const statusText = !active && summary ? profileStatusLabel(p, summary) : null

  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: name,
    transition: RAIL_TRANSITION
  })

  const clearPress = () => {
    if (pressTimer.current != null) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  // A real drag (movement past the dnd threshold) cancels the pending hold, so a
  // reorder never doubles as a color pick. Also tidy up on unmount.
  useEffect(() => {
    if (isDragging) {
      clearPress()
    }
  }, [isDragging])
  useEffect(() => clearPress, [])

  const base = CSS.Transform.toString(transform)
  const ring = active ? `inset 0 0 0 1.5px ${hue}` : ''
  const lift = isDragging ? '0 6px 16px -4px rgb(0 0 0 / 0.4)' : ''

  const pickColor = (next: null | string) => {
    onRecolor(next)
    setPickerOpen(false)
    triggerHaptic('selection')
  }

  return (
    <Popover onOpenChange={setPickerOpen} open={pickerOpen}>
      <ContextMenu>
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <PopoverAnchor asChild>
              <ContextMenuTrigger asChild>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'relative grid size-5 shrink-0 cursor-grab touch-none select-none place-items-center rounded-(--control-icon-radius) text-[0.5625rem] font-semibold uppercase leading-none transition-opacity hover:opacity-100',
                      active ? 'opacity-100' : 'opacity-55',
                      isDragging && 'z-10 cursor-grabbing opacity-100'
                    )}
                    ref={setNodeRef}
                    style={{
                      backgroundColor: profileColorSoft(hue, active ? 30 : 22),
                      boxShadow: [ring, lift].filter(Boolean).join(', ') || undefined,
                      color: color ?? undefined,
                      // Glide the dragged square between snapped cells with a little
                      // overshoot (no scale — the overflow-x strip would clip it).
                      transform: base,
                      transition: isDragging ? DRAG_TRANSITION : transition
                    }}
                    type="button"
                    {...attributes}
                    {...listeners}
                    aria-label={
                      [remoteHost ? `${label} — ${p.remoteOverride.badge(remoteHost)}` : label, statusText]
                        .filter(Boolean)
                        .join(', ') || label
                    }
                    aria-pressed={active}
                    // Hold-to-recolor rides alongside the dnd pointer listener (call
                    // it first so drag tracking still arms), then a timer opens the
                    // picker and flags the trailing click so it doesn't also select.
                    onClick={() => {
                      if (suppressClick.current) {
                        suppressClick.current = false

                        return
                      }

                      onSelect()
                    }}
                    onPointerCancel={clearPress}
                    onPointerDown={event => {
                      listeners?.onPointerDown?.(event)

                      if (event.button !== 0) {
                        return
                      }

                      suppressClick.current = false
                      clearPress()
                      pressTimer.current = window.setTimeout(() => {
                        suppressClick.current = true
                        triggerHaptic('success')
                        setPickerOpen(true)
                      }, LONG_PRESS_MS)
                    }}
                    onPointerEnter={startPrewarm}
                    onPointerLeave={() => {
                      clearPress()
                      cancelPrewarm()
                    }}
                    onPointerMove={notePointerMove}
                    onPointerUp={clearPress}
                  >
                    {profileShortLabel(label)}
                    {/* The "remote" badge: a tiny globe pinned to the corner of an
                        overridden profile's square, so which profiles leave this
                        machine is visible at a glance (#91349). */}
                    {remoteHost && (
                      <span
                        aria-hidden="true"
                        className="absolute -right-0.5 -top-0.5 grid size-3 place-items-center rounded-full border border-(--ui-stroke-secondary) bg-(--ui-panel-background) text-(--ui-accent)"
                        data-slot="profile-remote-badge"
                      >
                        <Codicon name="globe" size="0.5rem" />
                      </span>
                    )}
                    {/* The profile's session rollup (#91710): bottom-right so it
                        never fights the remote globe. */}
                    {!active && summary && (
                      <span className="absolute -bottom-0.5 -right-0.5">
                        <ProfileStatusDot summary={summary} />
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
              </ContextMenuTrigger>
            </PopoverAnchor>
            <TooltipContent>
              {[remoteHost ? `${label} · ${p.remoteOverride.badge(remoteHost)}` : label, statusText]
                .filter(Boolean)
                .join(' · ')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* The rail sits at the very bottom, so pad off the chrome (esp. the
            statusbar) — Radix then flips the menu up instead of squishing it. */}
        <ContextMenuContent
          aria-label={p.actions}
          className="min-w-52"
          collisionPadding={{ bottom: 44, left: 8, right: 8, top: 8 }}
          // Menu close refocuses the trigger — which doubles as the popover
          // anchor — so the picker reads it as focus-outside and dies on open.
          // Suppress the refocus and the picker survives.
          onCloseAutoFocus={event => event.preventDefault()}
        >
          <ProfileLaunchMenuSection connectionId={connectionId} label={label} profile={name} />
          <ContextMenuItem onSelect={() => setPickerOpen(true)}>
            <Codicon name="symbol-color" size="0.875rem" />
            <span>{p.color}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={onRename}>
            <Codicon name="text-size" size="0.875rem" />
            <span>{p.renameMenu}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={onEditSoul}>
            <Codicon name="edit" size="0.875rem" />
            <span>{p.editSoul}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void runExportProfileFlow(name)}>
            <Codicon name="package" size="0.875rem" />
            <span>{p.exportMenu}</span>
          </ContextMenuItem>
          {onConnectRemote && (
            <ContextMenuItem onSelect={onConnectRemote}>
              <Codicon name="globe" size="0.875rem" />
              <span>{remoteHost ? p.remoteOverride.badge(remoteHost) : p.remoteOverride.menuItem}</span>
            </ContextMenuItem>
          )}
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={onDelete}
            variant="destructive"
          >
            <Codicon name="trash" size="0.875rem" />
            <span>{t.common.delete}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <PopoverContent
        aria-label={p.colorFor}
        className="w-auto p-2"
        collisionPadding={{ bottom: 44, left: 8, right: 8, top: 8 }}
        side="top"
      >
        <ColorSwatches
          clearIcon="sync"
          clearLabel={p.autoColor}
          onChange={pickColor}
          swatches={PROFILE_SWATCHES}
          swatchLabel={p.setColor}
          value={color}
        />
      </PopoverContent>
    </Popover>
  )
}
