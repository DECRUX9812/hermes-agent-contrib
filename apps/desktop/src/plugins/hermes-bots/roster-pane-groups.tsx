/**
 * Group rooms inside the roster: the per-row reorder wiring plus the
 * Pinned / Active / Archived bands. Drag state lives in two module atoms
 * (the same shape as the bot section-drag contract in `user-sections.ts`),
 * so a drop line and a band-header drop work whether the row renders flat
 * or filed inside a user section.
 */

import { cn, DisclosureCaret, useValue } from '@hermes/plugin-sdk'
import { atom } from 'nanostores'
import type { ComponentProps, ReactNode } from 'react'
import { Fragment, useRef, useState } from 'react'

import { $botMeta } from './data'
import { $roomArchive, isRoomArchived, setRoomArchived } from './group-archive'
import { $groupChats, groupChatRoomKey, updateGroupChat } from './group-chat'
import type { $groupClarify, $groupNeedsYou } from './group-chat'
import { groupChatNames, groupLastActivity } from './group-membership'
import { moveGroupRow, reorderGroupRows, sortGroupRosterRows } from './group-order'
import type { OrderRow } from './group-order'
import { GroupRow, roomMatchesFilter } from './group-row'
import type { RoomQuickFilter, RoomStatusSnapshot } from './group-row'
import { groupHasPendingClarify } from './group-turns'
import { useFlip } from './motion'
import { useRoomText } from './room-i18n'
import type { RosterGroupRow } from './roster-pane-derivation'
import type { GroupChat, GroupMember } from './types'

/** The room being dragged for a reorder, by room name. */
export const $draggingRoom = atom<null | string>(null)

/** Where the drop line sits: before the named row, or after it. */
export const $roomDropTarget = atom<null | { after: boolean; name: string }>(null)

// Archived starts folded, so its id in the shared collapsed-sections set means
// OPEN: every other fold defaults open, and inverting here keeps one store.
const ARCHIVED_OPEN_ID = 'group-chats:archived-open'

function buildOrderRows(current: Record<string, GroupChat>): OrderRow[] {
  return groupChatNames($botMeta.get(), current).map(name => ({
    kind: 'group' as const,
    name,
    pinned: Boolean(current[name]?.pinned),
    activity: groupLastActivity(current[name])
  }))
}

function writeRoomOrder(current: Record<string, GroupChat>, order: string[] | null): void {
  if (!order) {
    return
  }

  order.forEach((name, rosterOrder) => {
    const room = current[name]

    if (!room || room.tombstone) {
      return
    }

    updateGroupChat(name, room => ({ ...room, rosterOrder }), { sync: false })
  })
}

/** Alt+Arrow on a focused row: one place inside its band. */
export function moveRoomWithinBand(name: string, delta: -1 | 1, rooms: Record<string, GroupChat>, visible?: string[]): void {
  // Read at the gesture, not the last render: a sync or disband may have
  // replaced this room in the meantime. Ordering never writes bot metadata.
  const current = $groupChats.get()

  if (current[name]?.roomId !== rooms[name]?.roomId || current[name]?.tombstone) {
    return
  }

  writeRoomOrder(
    current,
    reorderGroupRows(sortGroupRosterRows(buildOrderRows(current), current), name, delta, visible)
  )
}

/** A row dropped onto another row: reorder inside the target's band. A drop
 *  that crosses bands is ignored — the band headers own pin/archive. */
export function dropRoomAt(from: string, target: string, after: boolean, visible?: string[]): void {
  const current = $groupChats.get()
  const fromRoom = current[from]
  const targetRoom = current[target]

  if (!fromRoom || !targetRoom || from === target || fromRoom.tombstone || targetRoom.tombstone) {
    return
  }

  if (Boolean(fromRoom.pinned) !== Boolean(targetRoom.pinned)) {
    return
  }

  const rows = sortGroupRosterRows(buildOrderRows(current), current)

  const band = rows.filter(
    row => row.kind === 'group' && row.pinned === Boolean(targetRoom.pinned) && (!visible || visible.includes(row.name!))
  )

  const without = band.map(row => row.name!).filter(name => name !== from)
  const at = without.indexOf(target)

  if (at === -1) {
    return
  }

  writeRoomOrder(current, moveGroupRow(rows, from, at + (after ? 1 : 0), visible))
}

/** A room dropped onto a band header: pin, unpin, or archive. Dropping an
 *  archived room on Pinned or Active brings it back. */
export function dropRoomOnBand(name: string, band: 'active' | 'archived' | 'pinned'): void {
  const current = $groupChats.get()
  const room = current[name]

  if (!room || room.tombstone) {
    return
  }

  const key = groupChatRoomKey(name, room)

  if (band === 'archived') {
    setRoomArchived(key, true)

    return
  }

  if (isRoomArchived($roomArchive.get(), key)) {
    setRoomArchived(key, false)
  }

  const pinned = band === 'pinned'

  if (Boolean(room.pinned) === pinned) {
    return
  }

  updateGroupChat(name, room => ({ ...room, pinned }), { sync: false })
}

interface RosterGroupRowViewProps extends Omit<ComponentProps<typeof GroupRow>, 'needsYou' | 'onMoveKey'> {
  /** Names the row may move among (its band, filter-matching); defaults to all rows. */
  bandNames?: string[]
  groupClarify: ReturnType<typeof $groupClarify.get>
  groupNeedsYou: ReturnType<typeof $groupNeedsYou.get>
  groupRooms: ReturnType<typeof $groupChats.get>
  sortedGroupRows: RosterGroupRow[]
}

export function RosterGroupRowView({
  bandNames,
  groupClarify,
  groupNeedsYou,
  groupRooms,
  sortedGroupRows,
  ...rowProps
}: RosterGroupRowViewProps) {
  const dropTarget = useValue($roomDropTarget)
  const dragRoom = useValue($draggingRoom)
  const visible = bandNames ?? sortedGroupRows.map(row => row.name)
  const targeted = dropTarget?.name === rowProps.group ? dropTarget : null
  const line = <div aria-hidden="true" className="h-0.5 rounded-full bg-brand" />

  return (
    <div
      data-flip-key={`group:${rowProps.group}`}
      onDragEnd={() => {
        $draggingRoom.set(null)
        $roomDropTarget.set(null)
      }}
      onDragLeave={() => {
        if ($roomDropTarget.get()?.name === rowProps.group) {
          $roomDropTarget.set(null)
        }
      }}
      onDragOver={event => {
        if (!dragRoom || dragRoom === rowProps.group) {
          return
        }

        event.preventDefault()

        const rect = event.currentTarget.getBoundingClientRect()
        const after = event.clientY > rect.top + rect.height / 2
        const current = $roomDropTarget.get()

        if (current?.name !== rowProps.group || current.after !== after) {
          $roomDropTarget.set({ after, name: rowProps.group })
        }
      }}
      onDragStart={() => $draggingRoom.set(rowProps.group)}
      onDrop={event => {
        event.preventDefault()

        const from = $draggingRoom.get()

        $draggingRoom.set(null)
        $roomDropTarget.set(null)

        if (from && from !== rowProps.group) {
          dropRoomAt(from, rowProps.group, targeted?.after ?? true, visible)
        }
      }}
    >
      {targeted && !targeted.after ? line : null}
      <GroupRow
        {...rowProps}
        needsYou={Boolean(groupNeedsYou[rowProps.group]) || groupHasPendingClarify(groupClarify, rowProps.group)}
        onMoveKey={delta => moveRoomWithinBand(rowProps.group, delta, groupRooms, visible)}
      />
      {targeted?.after ? line : null}
    </div>
  )
}

interface BandHeaderProps {
  band: 'active' | 'archived' | 'pinned'
  collapsed: boolean
  count: number
  label: string
  onDropRoom: (band: 'active' | 'archived' | 'pinned') => void
  onToggle: () => void
}

function BandHeader({ band, collapsed, count, label, onDropRoom, onToggle }: BandHeaderProps) {
  const dragging = useValue($draggingRoom)
  const [over, setOver] = useState(false)

  return (
    <div
      onDragLeave={dragging ? () => setOver(false) : undefined}
      onDragOver={
        dragging
          ? event => {
              event.preventDefault()
              setOver(true)
            }
          : undefined
      }
      onDrop={
        dragging
          ? event => {
              event.preventDefault()
              setOver(false)
              onDropRoom(band)
            }
          : undefined
      }
    >
      <button
        aria-expanded={!collapsed}
        aria-label={`${label} ${count}`}
        className={cn(
          'flex h-6 w-full items-center gap-1.5 rounded-md px-2 text-left text-ui-2xs font-medium text-fg-subtle transition-colors duration-150',
          dragging && 'ring-1 ring-inset ring-(--ui-stroke-tertiary)',
          over && 'bg-hover text-fg ring-brand'
        )}
        onClick={onToggle}
        type="button"
      >
        <DisclosureCaret open={!collapsed} />
        <span>{label}</span>
        <span className="tabular-nums">{count}</span>
      </button>
    </div>
  )
}

const QUICK_FILTERS: RoomQuickFilter[] = ['all', 'working', 'needsYou', 'unread']

interface GroupRoomsBandsProps {
  cardMode: boolean
  filter: RoomQuickFilter
  onFilter: (filter: RoomQuickFilter) => void
  /** Pinned/active bodies keep their user-section filing; archived renders flat. */
  renderBandRows: (rows: RosterGroupRow[], band: 'active' | 'pinned') => ReactNode
  renderRow: (row: { members: GroupMember[]; name: string }) => ReactNode
  rooms: Record<string, GroupChat>
  rosterSectionCollapsed: (id: string) => boolean
  rows: RosterGroupRow[]
  statuses: Record<string, RoomStatusSnapshot>
  toggleRosterSection: (id: string) => void
}

export function GroupRoomsBands({
  cardMode,
  filter,
  onFilter,
  renderBandRows,
  renderRow,
  rooms,
  rosterSectionCollapsed,
  rows,
  statuses,
  toggleRosterSection
}: GroupRoomsBandsProps) {
  const r = useRoomText().list
  const archived = useValue($roomArchive)
  const dragRoom = useValue($draggingRoom)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const roomKey = (name: string): string => {
    const room = rooms[name]

    return room ? groupChatRoomKey(name, room) : ''
  }

  const visible = rows.filter(row => roomMatchesFilter(statuses[row.name], filter))
  const archivedRows = visible.filter(row => isRoomArchived(archived, roomKey(row.name)))
  const open = visible.filter(row => !isRoomArchived(archived, roomKey(row.name)))
  const pinned = open.filter(row => row.pinned)
  const active = open.filter(row => !row.pinned)

  useFlip(
    containerRef,
    [...pinned, ...active, ...archivedRows].map(row => `${row.pinned ? 'pinned' : 'open'}:${row.name}`).join('|')
  )

  const counts: Record<RoomQuickFilter, number> = {
    all: rows.length,
    working: rows.filter(row => statuses[row.name]?.working).length,
    needsYou: rows.filter(row => statuses[row.name]?.needsYou).length,
    unread: rows.filter(row => (statuses[row.name]?.unread ?? 0) > 0).length
  }

  const labels: Record<RoomQuickFilter, string> = {
    all: r.filterAll,
    working: r.filterWorking,
    needsYou: r.filterNeedsYou,
    unread: r.filterUnread
  }

  const onDropRoom = (band: 'active' | 'archived' | 'pinned'): void => {
    const name = $draggingRoom.get()

    $draggingRoom.set(null)
    $roomDropTarget.set(null)

    if (name) {
      dropRoomOnBand(name, band)
    }
  }

  const archivedCollapsed = !rosterSectionCollapsed(ARCHIVED_OPEN_ID)

  const bandFold = (id: string) => ({
    collapsed: rosterSectionCollapsed(id),
    onDropRoom,
    onToggle: () => toggleRosterSection(id)
  })

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto px-2 py-1 [scrollbar-width:none] scroll-fade-x">
        {QUICK_FILTERS.map(id => (
          <button
            aria-label={counts[id] > 0 ? `${labels[id]} ${counts[id]}` : labels[id]}
            aria-pressed={filter === id}
            className={cn(
              'h-6 shrink-0 whitespace-nowrap rounded-pill px-2 text-ui-2xs',
              filter === id ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-hover'
            )}
            key={id}
            onClick={() => onFilter(id)}
            type="button"
          >
            {labels[id]}
            {counts[id] > 0 ? <span className="ml-1 tabular-nums">{counts[id]}</span> : null}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="px-2 py-1 text-ui-xs text-fg-muted">{r.noRoomsMatch}</div>
      ) : (
        <div ref={containerRef}>
          {pinned.length > 0 || dragRoom ? (
            <div>
              <BandHeader band="pinned" count={pinned.length} label={r.pinnedBand} {...bandFold('group-chats:pinned')} />
              {rosterSectionCollapsed('group-chats:pinned') ? null : renderBandRows(pinned, 'pinned')}
            </div>
          ) : null}
          {active.length > 0 || pinned.length === 0 ? (
            <div>
              <BandHeader band="active" count={active.length} label={r.activeBand} {...bandFold('group-chats:active')} />
              {rosterSectionCollapsed('group-chats:active') ? null : renderBandRows(active, 'active')}
            </div>
          ) : null}
          {archivedRows.length > 0 || dragRoom ? (
            <div>
              <BandHeader
                band="archived"
                collapsed={archivedCollapsed}
                count={archivedRows.length}
                label={r.archivedBand}
                onDropRoom={onDropRoom}
                onToggle={() => toggleRosterSection(ARCHIVED_OPEN_ID)}
              />
              {archivedCollapsed ? null : (
                <div className={cardMode ? 'grid gap-2 px-2 pb-2' : undefined}>
                  {archivedRows.map(row =>
                    cardMode ? (
                      <div className="col-span-full" key={row.name}>
                        {renderRow(row)}
                      </div>
                    ) : (
                      <Fragment key={row.name}>{renderRow(row)}</Fragment>
                    )
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
