/**
 * One group chat as one quiet roster row, plus the room-status helpers the
 * roster's quick filters share with it. Rooms only — bot rows stay in
 * `bot-row.tsx`. The room owns one visual identity (a mosaic of its members'
 * faces); member details stay in its tooltip and workspace instead of
 * competing with bot avatars in the narrow sidebar.
 */

import {
  Badge,
  cn,
  Codicon,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  haptic,
  host,
  RowButton,
  Tip,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { $botMeta, botHandle, botSourceStatus } from './data'
import { $roomArchive, isRoomArchived, setRoomArchived } from './group-archive'
import { type GroupChatRoom, groupChatRoomKey } from './group-chat'
import { groupLastActivity, groupMemberKey } from './group-membership'
import { toggleGroupChatPinned } from './group-pin'
import { useGroupChatRoom } from './group-room-store'
import { $groupReadAt, groupLastRoundSummary, groupUnreadCount } from './group-unread'
import { useBots } from './i18n'
import { cleanPreviewLine } from './labels'
import { useRoomText } from './room-i18n'
import { botRosterMeta } from './routing'
import { rosterRowAge } from './row-helpers'
import type { BotMeta, GroupChat, GroupMember, GroupMessage } from './types'
import { $botSections, $draggingBot, BOT_DRAG_MIME, groupChatRoomSectionId, groupDragKey, moveGroupChatsToSection } from './user-sections'

// ── shared room status ───────────────────────────────────────────────────────

export type RoomQuickFilter = 'all' | 'needsYou' | 'unread' | 'working'

export interface RoomStatusSnapshot {
  needsYou: boolean
  unread: number
  working: boolean
}

/** A room reads as working while its own turn runs: `running` is set for the
 *  whole round, whichever member holds the turn. Pure, so the row and the
 *  quick filters agree. */
export function roomIsWorking(room: GroupChat | null | undefined): boolean {
  return Boolean(room?.running && !room.tombstone)
}

export function roomStatusFor(
  room: GroupChat | null | undefined,
  input: { needsYou: boolean; readAt: number }
): RoomStatusSnapshot {
  const log: GroupMessage[] = Array.isArray(room?.log) ? room.log : []

  return {
    needsYou: input.needsYou,
    unread: groupUnreadCount(log, input.readAt || 0),
    working: roomIsWorking(room)
  }
}

export function roomMatchesFilter(status: RoomStatusSnapshot | undefined, filter: RoomQuickFilter): boolean {
  if (filter === 'all' || !status) {
    return filter === 'all'
  }

  switch (filter) {
    case 'working':
      return status.working

    case 'needsYou':
      return status.needsYou

    case 'unread':
      return status.unread > 0
  }
}

// ── face mosaic ──────────────────────────────────────────────────────────────

function mosaicFace(member: GroupMember, allMeta: Record<string, BotMeta>, size: number) {
  const meta = botRosterMeta(member, allMeta)
  const appearance = botAppearance(member.name, meta)

  return (
    <BotFace
      color={avatarColor(appearance.color, member.name)}
      image={appearance.image && !isBackfilledFacePng(appearance.image) ? appearance.image : null}
      name={member.name}
      shape={appearance.shape}
      size={size}
    />
  )
}

/** Up to four member faces in a 28 px square; one member is just its face. */
function RoomMosaic({ allMeta, members }: { allMeta: Record<string, BotMeta>; members: GroupMember[] }) {
  const faces = members.slice(0, 4)

  if (!faces.length) {
    return (
      <span className="flex size-7 items-center justify-center rounded-control bg-hover text-fg-muted">
        <Codicon name="organization" />
      </span>
    )
  }

  if (faces.length === 1) {
    return mosaicFace(faces[0], allMeta, 28)
  }

  return (
    <div className="grid size-7 grid-cols-2 gap-px overflow-hidden rounded-control bg-surface">
      {faces.map(member => (
        <span className="block min-h-0 min-w-0 overflow-hidden" key={groupMemberKey(member)}>
          {mosaicFace(member, allMeta, 14)}
        </span>
      ))}
    </div>
  )
}

// ── the row ──────────────────────────────────────────────────────────────────

interface GroupRowProps {
  active: boolean
  group: string
  members: GroupMember[]
  needsYou: boolean
  onDisband: (room: { members: GroupMember[]; name: string }) => void
  /** Opens the New section dialog; the group is filed into it on create. */
  onNewSection: (group: string) => void
  onOpen: (group: string) => void
  /** Alt+ArrowUp/Down on the focused row moves it inside its band. */
  onMoveKey?: (delta: -1 | 1) => void
}

export function GroupRow({ active, group, members, needsYou, onOpen, onDisband, onNewSection, onMoveKey }: GroupRowProps) {
  const { t } = useI18n()
  const b = useBots()
  const r = useRoomText().list
  const maybeRoom = useGroupChatRoom(group)
  const allMeta = useValue($botMeta)
  const archived = useValue($roomArchive)
  const sections = useValue($botSections)
  const readAtByKey = useValue($groupReadAt)
  const currentSectionId = groupChatRoomSectionId(maybeRoom)

  const room = (maybeRoom ?? { log: [] }) as GroupChatRoom

  const log = Array.isArray(room.log) ? room.log : []
  const last = log.length ? log[log.length - 1] : null
  const lastAt = groupLastActivity(room)
  const roomKey = maybeRoom ? groupChatRoomKey(group, maybeRoom) : ''
  const readAt = (roomKey && readAtByKey[roomKey]) || 0
  const unread = groupUnreadCount(log, readAt)
  const { text: roundText } = groupLastRoundSummary(room)
  // Room previews speak the same handle vocabulary as the roster, mentions
  // and the group prompt: the primary profile is @hermes, not @default.
  const lastFrom = last?.from?.name || ''

  const lastHandle = botHandle(
    lastFrom || 'bot',
    members.find(member => member?.name === lastFrom)
  )

  // The line shows CONTENT only — the speaker ("You", "@handle") moves to the
  // hover title, so group rows read as plain prose like every other row.
  const speaker = last?.from?.kind === 'user' ? b.group.you : `@${lastHandle}`
  const preview = last ? cleanPreviewLine(roundText) || '…' : b.group.memberCount(members.length)
  const previewTitle = last ? `${speaker}: ${String(roundText || '').replace(/\s+/g, ' ').trim()}` : ''

  const working = roomIsWorking(maybeRoom)
  const isArchived = roomKey ? isRoomArchived(archived, roomKey) : false

  const availableMembers = members.filter(member => botSourceStatus(member).available).length
  const availabilityLabel = b.group.availableCount(availableMembers, members.length)

  // Same drag contract as a bot row, under the group's own key shape so a
  // drop zone can tell which kind landed without decoding roster keys.
  const dragKey = groupDragKey(group)
  const dragging = useValue($draggingBot) === dragKey

  const row = (
    <RowButton
      aria-label={`${group}, ${b.group.memberCount(members.length)}, ${availabilityLabel}`}
      className={cn(
        'group flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md px-2 py-2 text-left transition-colors',
        'hover:bg-(--chrome-action-hover)',
        active && 'bg-(--ui-row-active-background)',
        dragging && 'opacity-40'
      )}
      draggable
      onClick={() => {
        haptic('tap')
        onOpen(group)
      }}
      onDragEnd={() => $draggingBot.set(null)}
      onDragStart={event => {
        event.dataTransfer.setData(BOT_DRAG_MIME, dragKey)
        event.dataTransfer.effectAllowed = 'move'
        $draggingBot.set(dragKey)
      }}
      onKeyDown={
        onMoveKey
          ? event => {
              if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                event.preventDefault()
                onMoveKey(event.key === 'ArrowUp' ? -1 : 1)
              }
            }
          : undefined
      }
    >
      <Codicon
        aria-label={r.reorderGrip}
        className="shrink-0 text-fg-subtle opacity-0 transition group-hover:opacity-100"
        name="gripper"
      />
      <div className={cn('relative shrink-0 rounded-control', working && 'motion-ring text-brand')} data-testid="group-room-mosaic">
        <span className={cn('block', availableMembers === 0 && 'opacity-60')}>
          <RoomMosaic allMeta={allMeta} members={members} />
        </span>
        {members.length > 0 && availableMembers < members.length ? (
          <Tip label={availabilityLabel}>
            <span
              aria-label={availabilityLabel}
              className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-(--ui-bg-primary) text-[0.625rem] text-warning ring-1 ring-(--ui-stroke-tertiary)"
            >
              <Codicon name="debug-disconnect" />
            </span>
          </Tip>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-ui-sm font-medium" title={group}>{group}</span>
          {room.pinned ? (
            <Tip label={b.roster.pinned}>
              <Codicon className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)" name="pinned" />
            </Tip>
          ) : null}
          {needsYou ? (
            <Tip label={b.group.needsYourInput}>
              <span aria-label={b.roster.needsInput} className="size-1.5 shrink-0 rounded-full bg-warning" />
            </Tip>
          ) : null}
          {unread > 0 ? (
            <Badge aria-label={b.group.unreadCount(unread)} className="shrink-0" size="xs" variant="solid">
              {unread > 99 ? '99+' : unread}
            </Badge>
          ) : null}
          {lastAt ? (
            <span className="shrink-0 text-ui-2xs tabular-nums text-fg-subtle">
              {rosterRowAge(lastAt, t.sidebar.row)}
            </span>
          ) : null}
        </div>
        <div
          className={cn('mt-1 min-w-0 truncate text-ui-xs text-fg-muted', working && 'motion-shimmer')}
          title={previewTitle || undefined}
        >
          {preview}
        </div>
      </div>
    </RowButton>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onOpen(group)}>Open Group Chat</ContextMenuItem>
        <ContextMenuSeparator />
        {/* Same affordance as a bot row's pin; pinned rooms lead the roster
            band, and the flag lives on the room record. */}
        <ContextMenuItem
          onSelect={() => {
            const pinned = toggleGroupChatPinned(group)

            if (pinned !== null) {
              host.notify({ kind: 'info', message: `${group} ${pinned ? 'pinned to top' : 'unpinned'}` })
            }
          }}
        >
          {room.pinned ? 'Unpin' : 'Pin to top'}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            if (roomKey) {
              setRoomArchived(roomKey, !isArchived)
            }
          }}
        >
          {isArchived ? r.unarchive : r.archive}
        </ContextMenuItem>
        {/* Filing — the same submenu a bot row gets, driving the room-record
            assignment instead of profile meta. */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>{b.sections.moveTo}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {sections.map(section => (
              <ContextMenuItem
                disabled={section.id === currentSectionId}
                key={section.id}
                onSelect={() => moveGroupChatsToSection([group], section.id)}
              >
                <Codicon className="mr-1.5" name="folder" />
                {section.name}
              </ContextMenuItem>
            ))}
            {sections.length ? <ContextMenuSeparator /> : null}
            <ContextMenuItem onSelect={() => onNewSection(group)}>
              <Codicon className="mr-1.5" name="new-folder" />
              {b.sections.newSectionEllipsis}
            </ContextMenuItem>
            {currentSectionId ? (
              <ContextMenuItem onSelect={() => moveGroupChatsToSection([group], null)}>
                <Codicon className="mr-1.5" name="inbox" />
                {b.sections.removeFromSection}
              </ContextMenuItem>
            ) : null}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() =>
            onDisband({
              name: group,
              members
            })
          }
        >
          {b.group.deleteAction}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
