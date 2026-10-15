/**
 * The group-chat room surface: the merged room view, its settings dialog, the
 * MAIN-window tab it opens into, and the two room-lifecycle mutations that
 * surface drives — disband and rename.
 *
 * Disband and rename live here rather than beside the pane registry because a
 * rename re-opens the room's main tab, and that tab renders this file's
 * workspace: settings dialog → rename → open → main view → workspace is one
 * cycle, so it is one module. The tab registry and the composer drafts they
 * touch stay below, in `group-panes.ts`.
 */

import * as sdk from '@hermes/plugin-sdk'
import {
  atom,
  Button,
  cn,
  Codicon,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  host,
  Input,
  queryClient,
  Tip,
  ToggleRow,
  useI18n,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import type { ClipboardEvent, DragEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { $botMeta, $lastRoster, botHandle, botSourceStatus, ROSTER_KEY, saveBotMeta } from './data'
import {
  $groupActivity,
  currentGroupActivity
} from './group-activity'
import type { GroupActivityEntry } from './group-activity'
import { filesToGroupAttachments, pickGroupAttachments } from './group-attachments'
import {
  $groupChats,
  $groupChatWorkspace,
  $groupClarify,
  $groupNeedsYou,
  groupChatRoomKey,
  groupRoundContributions,
  groupThreadOf,
  mintGroupThreadId,
  scheduleGroupChatServerSync,
  setGroupChatGoal,
  setGroupChatHoldDetection,
  setGroupChatImage,
  setGroupChatLimits,
  setGroupChatListener,
  updateGroupChat
} from './group-chat'
import type { GroupChatRoom } from './group-chat'
import { GroupClarifyCard, GroupImageControls } from './group-chat-parts'
import type { GroupRoomPrompt } from './group-chat-parts'
import { GroupMemberPicker } from './group-chat-view-members'
import { compressGroupMemberHistory } from './group-compress'
import { roomDayBucket, roomDayLabel } from './group-day-separators'
import { sweepExternalGroupWrites } from './group-external-writes'
import { GroupHoldStatus } from './group-hold-status'
import {
  botGroups,
  groupChatMemberBots,
  groupMemberKey,
  groupWorkspaceOwnerKey,
  liveGroupChatNames
} from './group-membership'
import { groupMentionComponents, groupMentionText } from './group-mention-text'
import { GroupMessageRow } from './group-message-row'
import { indexMembersBySpeaker, memberForSpeaker, startsSpeakerRun } from './group-message-runs'
import {
  clearGroupComposerDraft,
  closeGroupChatMainTab,
  dropGroupMainTab,
  groupChatMainTabs,
  groupComposerDraftKey,
  groupComposerDraftSnapshot,
  migrateGroupComposerDraft,
  recordGroupMainTab,
  restoreGroupComposerDraft,
  updateGroupComposerDraft
} from './group-panes'
import type { GroupComposerDraft, GroupDraftSetter } from './group-panes'
import { GroupRoomActivityBar } from './group-room-activity'
import { asideInline, GroupRoomAside, roomSheetWidth, useRoomLayout } from './group-room-aside'
import { GroupRoomBoard } from './group-room-board'
import { LineCards } from './group-room-cards'
import { CatchUpCard, RecapCard, roomCatchUp } from './group-room-catchup'
import { roomCommands, RoomDecisions, type RoomSend, RoomShortcuts, ThreadTail } from './group-room-command'
import { GroupRoomComposer } from './group-room-composer'
import { useHandoffFlights } from './group-room-flight'
import { GroupComposerContext } from './group-room-focus'
import { deriveRoomHandoffs, roomEscalations, type RoomHandoff } from './group-room-handoffs'
import { GroupRoomHeader } from './group-room-header'
import { KeysHelp, roomKeyHandler, useNeedsYouAlerts, useRoomClock } from './group-room-keys'
import { disbandGroupChat } from './group-room-lifecycle'
import { GroupLogTail, GroupRoomEmpty } from './group-room-log-tail'
import { GroupMembersStrip } from './group-room-members'
import { GroupRoomPanel, type RoomPanelTab } from './group-room-panel'
import { $roomPrefs, setAsideCollapsed } from './group-room-prefs'
import { $roomRoles, roomRole } from './group-room-roles'
import { GroupThreadRail } from './group-room-threads'
import { useRoomUnread } from './group-room-unseen'
import { deriveRoomVotes, roomVotesAt } from './group-room-votes'
import { roomLiveWork, roomWorkItems } from './group-room-work'
import { groupReplyMentionTag, sendToGroupChat, stopGroupMember, stopGroupThread } from './group-rounds'
import { localMemberProfiles, resolveRoomListener, ROOM_LISTENER_EVERYONE, teamLeadMember } from './group-team'
import { GroupThreadPanel, GroupThreadPanelHeader } from './group-thread-panel'
import { renameGroupClarify } from './group-turns'
import { $groupVisitAnchor, markGroupOpened } from './group-unread'
import {
  answerHostedRoomApproval,
  ensureHostedRoom,
  hostedRoomApprovalActions,
  hostedRoomApprovalPrompts,
  hostedRoomOwnerMember,
  hostedRoomRetryActions,
  mergeHostedRoomEntries,
  newHostedRoomEventId,
  recordHostedRoomEvent,
  renameHostedRoom,
  retryHostedRoomTask,
  roomDriveMode,
  sendHostedRoomMessage,
  stopHostedRoom,
  useHostedRoomView,
  watchHostedRoom
} from './hosted-room-log'
import type { HostedRoomAction } from './hosted-room-log'
import { botsText, useBots } from './i18n'
import { displayName, slugifyProfileName } from './labels'
import { useArrivals } from './motion'
import { useRoomText } from './room-i18n'
import { botRosterMeta, groupTranscriptSpeakerMeta, setBotsWorkspaceOwner } from './routing'
import { bumpBotOpenGeneration, ID } from './shared'
import type { Attachment, BotMeta, GroupChat, GroupMember, GroupMessage } from './types'

const Streamdown = typeof sdk === 'undefined' ? undefined : sdk.Streamdown
// The 1:1 chat's message renderer: `MEDIA:` lines become inline players and
// images instead of a raw path (#93728), and a fenced block gets the app's own
// code card — stock Streamdown lays a code block's header and body out as
// inline siblings, so the body sat shifted right and its tail was clipped with
// no scrollbar (#91878). Feature-detected: an older shell without the export
// keeps the raw Streamdown path.
const MessageTextContent = typeof sdk === 'undefined' ? undefined : sdk.MessageTextContent

/** Rename a group chat. The group's NAME is its identity everywhere — the
 *  room-map key, each local member's ui_meta membership list, and derived
 *  state — so a rename re-keys all of them. Member gateway sessions are kept
 *  as-is: stored sids keep resuming, so no history is lost. The room's
 *  immutable roomId (the member-session title) is preserved across the
 *  rename, so even a member whose sid is later lost falls back to the same
 *  "Group: <roomId>" title lookup instead of a fresh "Group: <new name>".
 *  Returns the new name, or null when the target name is taken. */
export async function renameGroupChat(oldName: string, newName: string, members: GroupMember[] | null | undefined) {
  const next = String(newName || '')
    .trim()
    .slice(0, 64)

  if (!next || next === oldName) {
    return oldName
  }

  // Renames are explicit user intent: reject a collision honestly instead of
  // silently suffixing like creation does. Disband tombstones don't hold
  // their name — the room is gone, only its epoch survives briefly.
  const taken = new Set(liveGroupChatNames())

  for (const meta of Object.values($botMeta.get() || {})) {
    for (const existing of botGroups(meta)) {
      taken.add(existing)
    }
  }

  taken.delete(oldName)

  if (taken.has(next)) {
    host.notify({
      kind: 'error',
      message: botsText().group.nameTaken(next)
    })

    return null
  }

  const currentRoom = $groupChats.get()[oldName]

  // The hosted Discussion keeps the immutable room id; rename its display
  // name before the renderer re-keys its local room so a failed write leaves
  // both sides at the old name.
  if (currentRoom?.hostedRoomCreated && currentRoom.roomId) {
    const owner = hostedRoomOwnerMember(currentRoom, members || [])

    if (!owner) {
      host.notify({ kind: 'error', message: botsText().group.hostedRoomFailed('no local room owner') })

      return null
    }

    try {
      await renameHostedRoom(String(currentRoom.roomId), owner, next)
    } catch (error) {
      host.notify({
        kind: 'error',
        message: botsText().group.hostedRoomFailed(error instanceof Error ? error.message : String(error))
      })

      return null
    }
  }

  // Move the room record wholesale — log, watermarks, sessions, members,
  // picture, and runtime flags all belong to the same room under its new name.
  const all: Record<string, GroupChat> = {
    ...$groupChats.get()
  }

  const room = all[oldName]

  if (room) {
    migrateGroupComposerDraft(groupComposerDraftKey(oldName, room), groupComposerDraftKey(next, room))
  }

  delete all[oldName]

  if (room) {
    all[next] = room
  }

  $groupChats.set(all)

  const needs: Record<string, boolean> = {
    ...$groupNeedsYou.get()
  }

  if (oldName in needs) {
    needs[next] = needs[oldName]
    delete needs[oldName]
    $groupNeedsYou.set(needs)
  }

  // Mirrored clarify cards key by group name; a pending prompt's attention
  // must follow the room to its new name, not disappear.
  renameGroupClarify(oldName, next)

  // Local memberships: swap the name inside each member's canonical groups
  // list (syncs cross-machine via ui_meta). Remote members' seating lives in
  // the room record we just moved.
  for (const member of members || []) {
    if (!member?.name) {
      continue
    }

    const meta = botRosterMeta(member, $botMeta.get()) || {}
    const groups = [...new Set(botGroups(meta).map(g => (g === oldName ? next : g)))]
    await saveBotMeta(member, {
      groups,
      group: groups[0] || null
    })
  }

  // Persist the re-keyed map (updateGroupChat writes the whole durable map).
  updateGroupChat(next, (r: GroupChatRoom) => r, {
    sync: false
  })
  // A rename is one revisioned state transition: the new identity is updated
  // and the old identity is tombstoned together, so cold hydration cannot
  // merge the pre-rename room back into the roster.
  scheduleGroupChatServerSync($groupChats.get(), {
    changedRooms: [next],
    deletedRooms: [oldName]
  })

  // Follow the open views to the new identity.
  if ($groupChatWorkspace.get() === oldName) {
    $groupChatWorkspace.set(next)
  }

  if (groupChatMainTabs.has(oldName)) {
    closeGroupChatMainTab(oldName)
    openGroupChat(next)
  }

  // Same convergence as disband: drop the pre-rename roster snapshot so the
  // old name can't linger anywhere the fence doesn't cover.
  if (typeof queryClient !== 'undefined' && queryClient?.invalidateQueries) {
    queryClient.invalidateQueries({
      queryKey: ROSTER_KEY
    })
  }

  return next
}

interface GroupChatSettingsDialogProps {
  group: string
  members?: GroupMember[]
  onClose: () => void
  onDisband?: () => void
  onManageMembers?: () => void
  onRenamed?: (group: string) => void
  open: boolean
}

/** Edit an existing group chat's name and picture. Renames re-key the room
 *  and every local member's membership (renameGroupChat); the picture rides
 *  the room record. Both apply on Save so a cancelled dialog changes nothing. */
function GroupChatSettingsDialog({
  group,
  members,
  open,
  onClose,
  onDisband,
  onManageMembers,
  onRenamed
}: GroupChatSettingsDialogProps) {
  const { t } = useI18n()
  const b = useBots()
  const rooms: Record<string, GroupChatRoom> = useValue($groupChats)
  const current = (rooms[group] || {}).image || null
  const currentHoldDetection = (rooms[group] || {}).holdDetection !== false
  // 'off' on any axis means the room opted out of the inherited drive budget
  // and rides the hard ceilings — one toggle covers all three axes.
  const currentLimitOff = Object.values((rooms[group] || {}).limits || {}).some(value => value === 'off')
  const currentGoal = String((rooms[group] || {}).goal || '')
  const currentListener = String((rooms[group] || {}).listener || '')
  const [name, setName] = useState(group)
  const [image, setImage] = useState(current)
  const [holdDetection, setHoldDetection] = useState(currentHoldDetection)
  const [limitOff, setLimitOff] = useState(currentLimitOff)
  const [goal, setGoal] = useState(currentGoal)
  const [listener, setListener] = useState(currentListener)
  const [compressing, setCompressing] = useState<null | string>(null)
  const allMeta: Record<string, BotMeta> = useValue($botMeta)

  const teamLeadQuery = useQuery({
    queryFn: () => resolveRoomListener('', members || []),
    queryKey: [ID, 'group-team-lead-settings', group, ...localMemberProfiles(members || [])],
    enabled: open,
    staleTime: 15000
  })

  const autoLead = teamLeadQuery.data || null
  const autoTarget = (members || []).find(m => m.name === autoLead?.lead)
  const autoName = autoTarget ? displayName(autoTarget, botRosterMeta(autoTarget, allMeta)) : autoLead?.lead

  const autoRole = (
    autoLead?.leadTitle || (autoTarget ? botRosterMeta(autoTarget, allMeta)?.title || autoTarget.title || '' : '')
  ).trim()

  const autoSuffix = autoName ? ` (${autoRole ? `${autoRole} · ` : ''}${autoName})` : ''
  useEffect(() => {
    if (open) {
      setName(group)
      setImage(current)
      setHoldDetection(currentHoldDetection)
      setLimitOff(currentLimitOff)
      setGoal(currentGoal)
      setListener(currentListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group])

  // Per-member "Compress history" (#102291): the member's hidden plumbing
  // session is reachable from nowhere else, so the room that shows the
  // symptom (empty replies) owns the repair. One member at a time — the
  // gateway refuses a second compress while one holds the lock.
  const compressMember = async (member: GroupMember) => {
    const memberName = displayName(member, botRosterMeta(member, $botMeta.get()))
    setCompressing(groupMemberKey(member))
    host.notify({ kind: 'info', message: b.group.compressing(memberName) })

    try {
      const outcome = await compressGroupMemberHistory(group, member)

      if (outcome.compressed === 0 && outcome.pending === 0) {
        host.notify({ kind: 'info', message: b.group.compressNothing(memberName) })
      } else {
        host.notify({
          kind: 'success',
          message: b.group.compressDone(memberName, outcome.compressed + outcome.pending, outcome.lines.join('; '))
        })
      }
    } catch (error) {
      host.notify({
        kind: 'error',
        message: b.group.compressFailed(memberName, error instanceof Error ? error.message : String(error))
      })
    } finally {
      setCompressing(null)
    }
  }

  const save = async () => {
    const finalName = await renameGroupChat(group, name, members)

    if (finalName === null) {
      return // collision — dialog stays open for a different name
    }

    if (image !== current) {
      setGroupChatImage(finalName, image)
    }

    if (holdDetection !== currentHoldDetection) {
      setGroupChatHoldDetection(finalName, holdDetection)
    }

    if (limitOff !== currentLimitOff) {
      setGroupChatLimits(finalName, limitOff ? { continuations: 'off', messages: 'off', rounds: 'off' } : undefined)
    }

    if (goal.trim() !== currentGoal) {
      setGroupChatGoal(finalName, goal)
    }

    if (listener !== currentListener) {
      setGroupChatListener(finalName, listener || null)
    }

    onClose()

    if (finalName !== group) {
      onRenamed?.(finalName)
    }
  }

  return (
    <Dialog
      onOpenChange={value => {
        if (!value) {
          onClose()
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{b.group.settingsTitle}</DialogTitle>
          <DialogDescription>{b.group.settingsDesc}</DialogDescription>
        </DialogHeader>
        <GroupImageControls
          image={image}
          onImage={setImage}
          seedMembers={(members || []).map(member => member.name)}
          seedName={name.trim() || group}
        />
        <form
          onSubmit={event => {
            event.preventDefault()
            void save()
          }}
        >
          <Input
            aria-label={b.group.nameLabel}
            autoFocus
            maxLength={64}
            onChange={event => setName(event.target.value)}
            value={name}
          />
        </form>
        <ToggleRow
          checked={holdDetection}
          description={b.group.holdDetectionHint}
          label={b.group.holdDetection}
          onChange={setHoldDetection}
        />
        <ToggleRow
          checked={limitOff}
          description={b.group.limitOffHint}
          label={b.group.limitOff}
          onChange={setLimitOff}
        />
        <div className="flex flex-col gap-1" data-testid="group-settings-listener">
          <label className="text-[0.75rem] font-medium text-(--ui-text-secondary)" htmlFor="group-listener-select">
            {b.group.listener}
          </label>
          <select
            className="h-8 w-full rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-control-background) px-2 text-[0.8125rem]"
            id="group-listener-select"
            onChange={event => setListener(event.target.value)}
            value={listener}
          >
            <option value="">
              {b.group.listenerAuto}
              {autoSuffix}
            </option>
            <option value={ROOM_LISTENER_EVERYONE}>{b.group.listenerEveryone}</option>
            {(members || []).map(member => {
              const meta = botRosterMeta(member, allMeta) || {}
              const role = (meta.title || member.title || '').trim()
              const name = displayName(member, meta)

              return (
                <option key={groupMemberKey(member)} value={groupMemberKey(member)}>
                  {role ? `${name} (${role})` : b.group.listenerOnly(name)}
                </option>
              )
            })}
          </select>
          <p className="text-[0.6875rem] text-(--ui-text-tertiary)">{b.group.listenerHint}</p>
        </div>
        <div className="flex flex-col gap-1" data-testid="group-settings-goal">
          <label className="text-[0.75rem] font-medium text-(--ui-text-secondary)" htmlFor="group-goal-input">
            {b.group.goal}
          </label>
          <Input
            aria-label={b.group.goal}
            id="group-goal-input"
            maxLength={200}
            onChange={event => setGoal(event.target.value)}
            placeholder={b.group.goalPlaceholder}
            value={goal}
          />
          <span className="text-[0.6875rem] text-(--ui-text-quaternary)">{b.group.goalHint}</span>
        </div>
        {(members || []).length > 0 ? (
          <ul className="flex flex-col gap-1" data-testid="group-settings-members">
            {(members || []).map(member => {
              const key = groupMemberKey(member)

              return (
                <li className="flex items-center justify-between gap-2 text-sm" key={key}>
                  <span className="truncate">{displayName(member, botRosterMeta(member, $botMeta.get()))}</span>
                  <Tip label={b.group.compressHistoryHint(member.name)}>
                    <Button
                      aria-label={`${b.group.compressHistory}: ${member.name}`}
                      disabled={compressing !== null}
                      onClick={() => void compressMember(member)}
                      size="sm"
                      variant="secondary"
                    >
                      <Codicon name={compressing === key ? 'loading' : 'fold'} spinning={compressing === key} />
                      {b.group.compressHistory}
                    </Button>
                  </Tip>
                </li>
              )
            })}
          </ul>
        ) : null}
        {onManageMembers ? (
          <Button
            className="w-fit"
            onClick={() => {
              onClose()
              onManageMembers()
            }}
            size="sm"
            variant="secondary"
          >
            <Codicon name="organization" />
            {`Manage members (${(members || []).length})…`}
          </Button>
        ) : null}
        <DialogFooter>
          {/* Destructive lives here, not one misclick away in the room header. */}
          {onDisband ? (
            <Button
              aria-label={b.group.disbandLabel(group)}
              className="mr-auto text-destructive hover:text-destructive"
              onClick={() => {
                onClose()
                onDisband()
              }}
              variant="ghost"
            >
              <Codicon name="trash" />
              {b.group.disbandAction}
            </Button>
          ) : null}
          <Button onClick={onClose} variant="secondary">
            {t.common.cancel}
          </Button>
          <Button disabled={!name.trim()} onClick={() => void save()}>
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── threads: the Slack/Discord shape ─────────────────────────────────────────
// Every room entry belongs to a THREAD. Messaging the room composer starts a
// new thread with the whole group; replying inside a thread continues that
// work. Member turns are scoped to the thread that triggered them — deltas,
// watermarks, and responder resolution all key on the thread id.

interface GroupChatWorkspaceProps {
  group: string
  members: GroupMember[]
  onBack?: () => void
  visible?: boolean
}

export function GroupChatWorkspace({ group, members, onBack, visible = true }: GroupChatWorkspaceProps) {
  const { t } = useI18n()
  const b = useBots()
  const rooms: Record<string, GroupChatRoom> = useValue($groupChats)
  const allMeta: Record<string, BotMeta> = useValue($botMeta)

  const storedRoom: GroupChatRoom = rooms[group] || {
    log: [],
    running: false
  }
  const hostedRoomId = String(storedRoom.roomId || '')
  const hostedView = useHostedRoomView(hostedRoomId)
  const roomMode = roomDriveMode(storedRoom, members, hostedView)
  const hostedActiveMember = hostedView.activeMemberId
    ? members.find(member => String(member.targetProfile || member.name) === hostedView.activeMemberId) || null
    : null
  const hostedRunning =
    roomMode === 'hosted' && Boolean(hostedView.driverStatus?.working || hostedView.activeMemberId)
  const room: GroupChatRoom =
    roomMode === 'hosted'
      ? {
          ...storedRoom,
          log: mergeHostedRoomEntries(storedRoom.log, hostedView.entries),
          running: hostedRunning,
          turn: hostedActiveMember
        }
      : storedRoom

  // What the watcher must react to is the membership, not the array's
  // identity: a parent re-render hands down a fresh array, and restarting on
  // that would re-probe (and re-create) the room on every render.
  const memberSignature = members
    .map(member => [member.connectionId, member.name, member.targetProfile || ''].join(':'))
    .join('|')

  useEffect(() => {
    const current = $groupChats.get()[group] || storedRoom

    return watchHostedRoom({ group, members, room: current })
    // The watcher owns room-id minting and hosted capability probing; other
    // room fields are read again when one of these mode inputs changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    group,
    memberSignature,
    storedRoom.goal,
    storedRoom.holdDetection,
    storedRoom.hostedRoomClientOnly,
    storedRoom.hostedRoomCreated,
    storedRoom.listener,
    storedRoom.limits,
    storedRoom.roomId
  ])

  const composerKey = groupComposerDraftKey(group, room)
  const composerKeyRef = useRef(composerKey)
  const [composerDraft, setComposerDraft] = useState(() => groupComposerDraftSnapshot(composerKey))

  if (composerKeyRef.current !== composerKey) {
    migrateGroupComposerDraft(composerKeyRef.current, composerKey)
    composerKeyRef.current = composerKey
  }

  const updateComposerDraft = (mutate: (draft: GroupComposerDraft) => GroupComposerDraft) => {
    const next = updateGroupComposerDraft(composerKeyRef.current, mutate)
    setComposerDraft(next)

    return next
  }

  const draft = composerDraft.main || ''
  const replyDrafts = composerDraft.replies || {}
  const pendingImages = composerDraft.pendingAttachments || {}

  const setDraft = (value: GroupDraftSetter<string>) =>
    updateComposerDraft(current => ({
      ...current,
      main: typeof value === 'function' ? value(current.main || '') : value
    }))

  const setReplyDrafts = (value: GroupDraftSetter<Record<string, string>>) =>
    updateComposerDraft(current => ({
      ...current,
      replies: typeof value === 'function' ? value(current.replies || {}) : value
    }))

  const setReplyThread = (value: GroupDraftSetter<null | string>) =>
    updateComposerDraft(current => ({
      ...current,
      activeReplyThread: typeof value === 'function' ? value(current.activeReplyThread || null) : value
    }))

  const setPendingImages = (value: GroupDraftSetter<Record<string, Attachment[]>>) =>
    updateComposerDraft(current => ({
      ...current,
      pendingAttachments: typeof value === 'function' ? value(current.pendingAttachments || {}) : value
    }))

  const [confirmDisband, setConfirmDisband] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [memberPickerOpen, setMemberPickerOpen] = useState(false)
  // Click-to-disambiguate: which log entry is showing its speaker's full
  // @handle (the roster's name-device form when names collide across
  // connections). Naturally every speaker just shows its display name.
  const [revealedSpeaker, setRevealedSpeaker] = useState<null | string>(null)
  // The right slot: members (or a thread) inline on wide rooms, a strip plus
  // an on-demand sheet below that. Folding it is a per-viewer preference.
  const r = useRoomText()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const layout = useRoomLayout(rootRef)
  const roomPrefs = useValue($roomPrefs)
  const asideFolded = Boolean(roomPrefs.asideCollapsed)
  const roomRoles = useValue($roomRoles)
  const [sheetOpen, setSheetOpen] = useState(false)
  // The thread open beside the conversation; null = none. The log never
  // filters to it, so the reader keeps their place in the room. It rides the
  // composer draft, so a remounted room reopens the thread it had open.
  const [focusThread, setFocusThread] = useState<null | string>(() => composerDraft.activeReplyThread || null)
  const arrived = useArrivals(groupChatRoomKey(group, room))
  // Command Room: the conversation or the CEO Board; the panel's tab; the
  // escalations the user waved off this session.
  const [view, setView] = useState<'board' | 'room'>('room')
  const [panelTab, setPanelTab] = useState<RoomPanelTab>('floor')
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const [catchUpDismissed, setCatchUpDismissed] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [briefOpen, setBriefOpen] = useState(false)
  const visitAnchor = useValue($groupVisitAnchor)[groupChatRoomKey(group, room)] || 0
  useRoomClock()
  // Focus mode (ADHD-friendly): dim everything before the newest exchange so
  // the room reads as ONE thing to look at, not a wall of history. Dimmed
  // rows stay reachable — hover or keyboard focus restores them, so nothing
  // is hidden, only quiet.
  const [focusMode, setFocusMode] = useState(false)
  // Thread replies retain their own draft; the main composer starts a new topic.
  // Pending image attachments per composer: `null` thread key = the main
  // composer, otherwise the reply box of that thread. Data URLs, already
  // downscaled — they ride the send into every responding member's session.

  // Scroll anchoring (#89835): rooms used to open at scroll position 0 and
  // stay there while replies streamed in. Scroll the bottom sentinel into
  // view on mount and whenever the log grows — but only when the user is
  // already near the bottom, so reading history is never yanked away.
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null)
  // The log's own overflow div is the scroller (the design-system rebuild
  // dropped the ScrollArea, so looking one up by data-slot found nothing and
  // every reply yanked a reader back to the bottom).
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  // Both "what you haven't seen" signals — the log's jump pill and the rail's
  // per-thread nudge — come from one place, along with the rule that keeps
  // them honest (only what arrived while you were elsewhere ever counts).
  const { jumpToLatest, markRead, onLogScroll, readingHistory, unseen, unseenByThread } = useRoomUnread({
    bottomSentinel: bottomSentinelRef,
    focusThread,
    group,
    log: room.log,
    logRunning: room.running,
    room,
    scroller: scrollerRef,
    stickToBottom: stickToBottomRef,
    visible
  })

  const imagesFor = (thread: null | string) => pendingImages[thread ?? 'main'] || []

  const addImages = (thread: null | string, picked: Attachment[]) => {
    if (!picked.length) {
      return
    }

    const key = thread ?? 'main'
    setPendingImages(prev => ({
      ...prev,
      [key]: [...(prev[key] || []), ...picked]
    }))
  }

  const removeImage = (thread: null | string, index: number) => {
    const key = thread ?? 'main'
    setPendingImages(prev => ({
      ...prev,
      [key]: (prev[key] || []).filter((_, i) => i !== index)
    }))
  }

  // Ctrl/⌘-V a screenshot (or any file) into any composer in this room.
  const pasteImages = (thread: null | string, event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...(event.clipboardData?.files || [])]

    if (!files.length) {
      return
    }

    event.preventDefault()
    void filesToGroupAttachments(files).then(picked => addImages(thread, picked))
  }

  // Drag & drop anywhere on the room drops into the ACTIVE composer — the
  // open thread's reply box, else the main (new-thread) composer. Matches the
  // 1:1 chat's drop affordance.
  const [dragOver, setDragOver] = useState(false)

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    const files = [...(event.dataTransfer?.files || [])]
    setDragOver(false)

    if (!files.length) {
      return
    }

    event.preventDefault()
    void filesToGroupAttachments(files).then(picked => addImages(focusThread, picked))
  }

  // Subscribe: activity rows re-render as turn events land.
  useValue($groupActivity)
  // Pending member questions for THIS room (#90694), oldest first.
  const clarifyAll: Record<string, GroupRoomPrompt> = useValue($groupClarify)

  const localRoomClarifies = Object.values(clarifyAll || {})
    .filter(entry => entry?.group === group)
    .sort((a, b) => (a.at || 0) - (b.at || 0))
  const hostedClarifies = roomMode === 'hosted' ? hostedRoomApprovalPrompts(group, hostedView) : []
  const roomClarifies = [...localRoomClarifies, ...hostedClarifies]
  const hostedApprovals = new Map(
    hostedRoomApprovalActions(hostedView).map(action => [String(action.request_id || ''), action])
  )
  const hostedRetries = roomMode === 'hosted' ? hostedRoomRetryActions(hostedView) : []
  const hostedOwner = hostedRoomOwnerMember(storedRoom, members)

  // Focus mode's bright set: the FINAL speaker run — the newest thing that
  // happened. Everything before it dims when focus is on. One rule, no knobs:
  // you always see the live exchange, and clarify cards (which live below the
  // log, never dimmed) stay bright because they're waiting on YOU.
  const focusCutoff = (() => {
    const log = room.log

    for (let i = log.length - 1; i > 0; i--) {
      const current = log[i]
      const previous = log[i - 1]

      const sameVoice =
        previous.from?.kind === current.from?.kind &&
        previous.from?.name === current.from?.name &&
        (previous.from?.source || '') === (current.from?.source || '') &&
        groupThreadOf(previous) === groupThreadOf(current)

      if (!sameVoice) {
        return i
      }
    }

    return 0
  })()

  // D2 — the completed round's contribution one-liners (empty while a round
  //  is running or no round has landed yet).
  const roundContributions = room.running ? [] : groupRoundContributions(room)

  const availableMembers = members.filter(member => botSourceStatus(member).available).length
  const availabilityLabel = `${availableMembers} of ${members.length} available`

  // Team-orchestrated room? The backend's org tree resolves a lead whose members
  // alone hear plain user turns; null keeps the room on fan-out (no covering
  // team, ambiguous teams, or an older gateway without bots_team.room_lead).
  const roomListener = room.listener || ''

  const teamLeadQuery = useQuery({
    queryFn: () => resolveRoomListener(roomListener, members),
    queryKey: [ID, 'group-team-lead', group, roomListener, ...localMemberProfiles(members)],
    refetchInterval: 30000,
    staleTime: 15000
  })

  const teamLead = teamLeadQuery.data || null
  const leadMember = teamLeadMember(teamLead, members)

  const leadName = leadMember
    ? displayName(leadMember, botRosterMeta(leadMember, allMeta))
    : teamLead?.leadTitle || (teamLead?.lead ? `@${teamLead.lead}` : '')

  // Who is mid-turn right now: a member whose latest event this run is
  // `working`. Lights their face in the header so "are they even on it?" is
  // answered without opening the activity log.
  const latestKindByMember = new Map<string, string>()

  for (const event of room.running ? currentGroupActivity(group) : []) {
    if (event.member) {
      latestKindByMember.set(event.member, event.kind)
    }
  }

  const workingNow = new Set([...latestKindByMember].filter(([, kind]) => kind === 'working').map(([member]) => member))

  if (room.running && room.turn?.name) {
    workingNow.add(room.turn.name)
  }

  const liveWork = roomLiveWork(room.sessions, useValue(host.state.dotStateBySession), members)

  for (const names of liveWork.values()) {
    names.forEach(name => workingNow.add(name))
  }

  const turnCovered = Boolean(room.turn && [...liveWork.values()].some(names => names.has(room.turn?.name || '')))

  // The handoff protocol: contracts read off the log, and what reaches the user.
  const handoffs = deriveRoomHandoffs(room.log, members, { live: liveWork })
  const escalationKey = (e: { handoff: RoomHandoff; kind: string }) => `${e.kind}:${e.handoff.id}`
  const escalations = roomEscalations(handoffs, room.log).filter(e => !dismissed.has(escalationKey(e)))
  const handoffsAt = new Map<number, RoomHandoff[]>()

  useHandoffFlights(
    rootRef,
    handoffs,
    name => {
      const member = members.find(m => m.name === name)

      return member ? groupMemberKey(member) : null
    },
    groupChatRoomKey(group, room)
  )

  for (const handoff of handoffs) {
    handoffsAt.set(handoff.index, [...(handoffsAt.get(handoff.index) ?? []), handoff])
  }

  // Team decisions: the question, every pick, and the call — read off the
  // log the same way handoffs are, so the card always matches the thread.
  const votesAt = roomVotesAt(deriveRoomVotes(room.log, members))

  const workItems = roomWorkItems(room.log, {
    live: liveWork,
    running: Boolean(room.running),
    waitingThreads: new Set([
      ...roomClarifies.map(entry => entry.thread || 'legacy'),
      ...escalations.map(e => e.handoff.thread)
    ])
  })

  const focusedItem = focusThread ? workItems.find(item => item.thread === focusThread) || null : null

  const memberLabel = (name: string) => {
    const member = members.find(m => m.name === name)

    return member ? displayName(member, botRosterMeta(member, allMeta)) : name
  }

  // Rail / thread link: open one thread beside the conversation (null closes
  // it). Its reply box owns replies; the main composer stays "new thread".
  const openThread = (thread: null | string) => {
    setView('room')
    setFocusThread(thread)
    setReplyThread(thread)
    // Looking at it IS reading it: the badge clears on open, not on a timer,
    // so it can never nag about something already on screen.
    markRead(thread)
  }

  // The board's own lines go through the room's sender, so a backend-driven
  // room never falls back to a renderer round from a board button.
  const sendRoomLine: RoomSend = (text, thread) => void sendRoomMessage(text, thread, [])
  const commands = roomCommands(group, members, () => memberDescriptors(), sendRoomLine)
  const memberKeyName = (key: string) => memberLabel(members.find(m => groupMemberKey(m) === key)?.name || key)
  useNeedsYouAlerts(escalations, roomClarifies, memberKeyName)

  const onRoomKey = roomKeyHandler({
    focusThread: focusedItem ? focusThread : null,
    onBoard: () => setView(current => (current === 'board' ? 'room' : 'board')),
    onHelp: () => setKeysOpen(open => !open),
    onNewThread: () => openThread(null),
    onOpen: thread => (keysOpen && thread === null ? setKeysOpen(false) : openThread(thread)),
    threads: workItems.map(item => item.thread)
  })

  // "While you were away": only with history from before this visit.
  const catchUp = roomCatchUp(room.log, visitAnchor, {
    escalations,
    handoffs,
    items: workItems,
    waiting: new Set(roomClarifies.map(entry => entry.thread || 'legacy'))
  })

  const showCatchUp = !catchUpDismissed && !focusedItem && visitAnchor > 0 && catchUp.lines.length > 0

  const dismissEscalation = (e: { handoff: RoomHandoff; kind: string }) =>
    setDismissed(prev => new Set([...prev, escalationKey(e)]))

  const inlineAside = asideInline(layout)
  const panelShown = inlineAside ? !asideFolded || Boolean(focusedItem) : sheetOpen || Boolean(focusedItem)
  // Medium rooms open the panel as a sheet OVER the conversation's right
  // edge; the reading column reserves the sheet's width while it is up, so
  // bubbles reflow instead of running underneath it.
  const sheetOpenLive = !inlineAside && panelShown
  const sheetPad = sheetOpenLive ? `min(${roomSheetWidth(roomPrefs.asideWidth)}px, calc(100% - 3rem))` : undefined

  const showAside = (open: boolean) => {
    if (inlineAside) {
      setAsideCollapsed(!open)
    } else {
      setSheetOpen(open)
    }

    if (!open) {
      openThread(null)
    }
  }

  const openPanel = (tab: RoomPanelTab) => {
    openThread(null)
    showAside(true)
    setPanelTab(tab)
  }

  const header = (
    <GroupRoomHeader
      allMeta={allMeta}
      availabilityLabel={availabilityLabel}
      availableMembers={availableMembers}
      focusMode={focusMode}
      group={group}
      members={members}
      onBack={onBack}
      panelOpen={panelShown}
      room={room}
      setFocusMode={setFocusMode}
      setPanelOpen={next => showAside(typeof next === 'function' ? next(panelShown) : next)}
      setSettingsOpen={setSettingsOpen}
      setView={setView}
      view={view}
      workingNow={workingNow}
    />
  )

  // Seat from the live sources at send time, not from the painted `members`
  // prop: a roster save that lands between the last paint and Enter was seen
  // (live) to send with the removed Bot still seated. Same derivation the
  // main-tab wrapper paints from; the prop is the fallback when the roster
  // has not been fetched yet.
  const memberDescriptors = () => {
    const seated = groupChatMemberBots(group, $lastRoster.get(), $botMeta.get())

    return (seated.length ? seated : members).map(b => ({
      ...b,
      title: botRosterMeta(b, allMeta)?.title || b.title || ''
    }))
  }

  const sendRoomMessage = async (text: string, thread: null | string, images: Attachment[]) => {
    const currentRoom = $groupChats.get()[group] || storedRoom
    const preflightRoom = currentRoom.roomId ? currentRoom : { ...currentRoom, roomId: 'pending' }
    const currentMembers = memberDescriptors()
    const supportedTextOnly = images.length === 0
    const preflight = roomDriveMode(
      preflightRoom,
      currentMembers,
      { capabilities: { driver: true }, status: 'ready' },
      !supportedTextOnly
    )

    if (preflight !== 'hosted') {
      if ((images.length > 0 || currentRoom.hostedRoomCreated) && !currentRoom.hostedRoomClientOnly) {
        updateGroupChat(group, current => ({ ...current, hostedRoomClientOnly: true }), { sync: false })
      }

      return Boolean(sendToGroupChat(group, currentMembers, text, thread, images))
    }

    const hosted = await ensureHostedRoom(group, currentRoom, currentMembers)

    if (hosted.error) {
      throw new Error(hosted.error)
    }

    const ensuredRoom = $groupChats.get()[group] || currentRoom
    const mode = roomDriveMode(ensuredRoom, currentMembers, hosted, !supportedTextOnly)
    const owner = hostedRoomOwnerMember(ensuredRoom, currentMembers)
    const roomId = String(ensuredRoom.roomId || '')

    if (mode !== 'hosted' || !owner || !roomId) {
      return Boolean(sendToGroupChat(group, currentMembers, text, thread, images))
    }

    const targetThread = thread || mintGroupThreadId()
    const event = await sendHostedRoomMessage(
      roomId,
      owner,
      text,
      targetThread,
      newHostedRoomEventId()
    )
    recordHostedRoomEvent(roomId, event, currentMembers)
    $groupNeedsYou.set({ ...$groupNeedsYou.get(), [group]: false })

    return true
  }

  const answerRoomPrompt = async (entry: GroupRoomPrompt, _member: GroupMember, answer: string) => {
    const action = hostedApprovals.get(entry.requestId)
    const roomId = String(storedRoom.roomId || '')

    if (!action || !hostedOwner || !roomId) {
      throw new Error('The hosted room approval is no longer available.')
    }

    await answerHostedRoomApproval(roomId, hostedOwner, action, answer)
  }

  const retryRoomAction = async (action: HostedRoomAction) => {
    const roomId = String(storedRoom.roomId || '')

    if (!hostedOwner || !roomId) {
      return
    }

    try {
      await retryHostedRoomTask(roomId, hostedOwner, action)
    } catch (error) {
      host.notify({
        kind: 'error',
        message: b.group.hostedRoomFailed(error instanceof Error ? error.message : String(error))
      })
    }
  }

  commands.stopMember = (thread, member) => {
    const hostedRoomId = String(storedRoom.roomId || '')

    // The backend cancels a hosted room's live work as a whole; there is no
    // per-member stop RPC.
    if (roomMode === 'hosted' && hostedOwner && hostedRoomId) {
      void stopHostedRoom(hostedRoomId, hostedOwner)
        .then(() => host.notify({ kind: 'success', message: b.group.stoppedMember(memberLabel(member.name)) }))
        .catch((error: unknown) =>
          host.notify({
            kind: 'error',
            message: b.group.hostedRoomFailed(error instanceof Error ? error.message : String(error))
          })
        )

      return
    }

    void stopGroupMember(group, thread, member, memberDescriptors())
    host.notify({ kind: 'success', message: b.group.stoppedMember(memberLabel(member.name)) })
  }

  // Activity disclosure lives in GroupRoomActivityBar (quiet, collapsed by
  // default). Events are epoch-tagged, so a superseded run's history drops
  // out of view. The view keeps the events, the latest (for stop scope) and
  // the per-member working stamps (for the thread tails).
  const activityEvents: GroupActivityEntry[] = currentGroupActivity(group)
  const latestActivity = activityEvents.length ? activityEvents[activityEvents.length - 1] : null

  const workingSince = new Map<string, number>(
    activityEvents
      .filter(event => event.kind === 'working' && event.member)
      .map(event => [event.member as string, event.at])
  )

  // #94570 shell rewired onto the real primitive (#91868/#94569): the button
  // must stop the ROUND, not just spray per-member interrupts — without the
  // epoch bump + holds the loop marched on to the next member. Thread scope:
  // the run being stopped is the one the latest activity belongs to.
  const stopRoomRun = async () => {
    try {
      if (roomMode === 'hosted') {
        const roomId = String(storedRoom.roomId || '')

        if (!hostedOwner || !roomId) {
          return
        }

        await stopHostedRoom(roomId, hostedOwner)
      } else {
        await stopGroupThread(group, latestActivity?.thread || null, memberDescriptors())
      }

      host.notify({
        kind: 'success',
        message: b.group.stopped(group)
      })
    } catch (error) {
      host.notify({
        kind: 'error',
        message:
          roomMode === 'hosted'
            ? b.group.hostedRoomFailed(error instanceof Error ? error.message : String(error))
            : String(error instanceof Error ? error.message : error)
      })
    }
  }

  const activityPanel = (
    <GroupRoomActivityBar
      events={activityEvents}
      group={group}
      onStopAll={() => void stopRoomRun()}
      running={room.running === true}
    />
  )

  const submit = () => {
    const text = draft.trim()
    const images = imagesFor(null)

    if (!text && !images.length) {
      return
    }

    const before = groupComposerDraftSnapshot(composerKeyRef.current)

    const cleared = updateComposerDraft(current => ({
      ...current,
      main: '',
      pendingAttachments: {
        ...(current.pendingAttachments || {}),
        main: []
      }
    }))

    void (async () => {
      let sent = false

      try {
        // Main composer = START A NEW THREAD with the whole group (Slack shape).
        sent = await sendRoomMessage(text, null, images)
      } catch (error) {
        host.notify({
          kind: 'error',
          message: b.group.hostedRoomFailed(error instanceof Error ? error.message : String(error))
        })
      }

      if (!sent) {
        const restored = restoreGroupComposerDraft(composerKeyRef.current, cleared.revision, before)

        if (restored) {
          setComposerDraft(restored)
        }
      }
    })()
  }

  const submitReply = (thread: string) => {
    const text = (replyDrafts[thread] || '').trim()
    const images = imagesFor(thread)

    if (!text && !images.length) {
      return
    }

    const before = groupComposerDraftSnapshot(composerKeyRef.current)

    const cleared = updateComposerDraft(current => ({
      ...current,
      pendingAttachments: {
        ...(current.pendingAttachments || {}),
        [thread]: []
      },
      replies: {
        ...(current.replies || {}),
        [thread]: ''
      }
    }))

    void (async () => {
      let sent = false

      try {
        // Reply box = CONTINUE this thread; the member turns it triggers are scoped to it.
        sent = await sendRoomMessage(text, thread, images)
      } catch (error) {
        host.notify({
          kind: 'error',
          message: b.group.hostedRoomFailed(error instanceof Error ? error.message : String(error))
        })
      }

      if (!sent) {
        const restored = restoreGroupComposerDraft(composerKeyRef.current, cleared.revision, before)

        if (restored) {
          setComposerDraft(restored)
        }
      }
    })()
  }

  // #91359: recognized @mentions render as inline references; recomputed
  // only when the roster changes since the classifier consults the members.
  const mentionComponents = useMemo(() => groupMentionComponents(members), [members])
  const mentionText = useMemo(() => groupMentionText(members), [members])
  const memberIndex = useMemo(() => indexMembersBySpeaker(members), [members])

  // #89883: answer ONE bot from its message. Opens the entry's thread and
  // seeds `@tag ` into its reply box, so parseGroupChatMentions routes the
  // next turn to that member only. Insert-only: the user still sends. The tag
  // is owner-qualified when a same-named twin shares the friendly form.
  const replyMentionTag = (entry: GroupMessage, member: GroupMember | null) =>
    groupReplyMentionTag(member || { name: entry.from.name }, members)

  const replyToMember = (entry: GroupMessage, member: GroupMember | null) => {
    const tag = replyMentionTag(entry, member)

    if (!tag) {
      return
    }

    const seed = (current: string) =>
      current.includes(`@${tag}`) ? current : `@${tag} ${current}`.replace(/\s+$/, ' ')

    const thread = groupThreadOf(entry)

    openThread(thread)
    setReplyDrafts(prev => ({
      ...prev,
      [thread]: seed(prev[thread] || '')
    }))
  }

  // Squad panel: ask one member — seeds `@them ` into the main composer.
  const mentionMember = (member: GroupMember) => {
    const tag = groupReplyMentionTag(member, members)

    if (tag) {
      setDraft(current => (current.includes(`@${tag}`) ? current : `@${tag} ${current}`.replace(/\s+$/, ' ')))
    }
  }

  // One log entry: the room computes what it knows, the row draws it.
  const renderEntry = (entry: GroupMessage, index: number, inPanel: boolean) => {
    const isUser = entry.from.kind === 'user'
    const meta = groupTranscriptSpeakerMeta(entry, members, allMeta)
    const member = isUser ? null : memberForSpeaker(memberIndex, entry.from)

    const display = isUser
      ? b.group.you
      : displayName(
          member || {
            name: entry.from.name
          },
          meta
        )

    const entryKey = `${entry.at}:${index}`
    const revealed = !isUser && revealedSpeaker === entryKey
    const isLead = Boolean(member && leadMember && groupMemberKey(member) === groupMemberKey(leadMember))
    const roleTitle = isUser ? '' : (meta?.title || member?.title || '').trim()

    // This room's own label for the voice ("Reviewer" here, "Auditor"
    // everywhere else) wins over the global title on its messages.
    const roomRoleLabel =
      !isUser && member ? roomRole(roomRoles, groupChatRoomKey(group, room), groupMemberKey(member)) : ''

    const thread = groupThreadOf(entry)

    // Clicked: append the gateway name so same-named agents on
    // two connections are tellable apart on demand.
    const label = isUser
      ? b.group.you
      : revealed
        ? `${display}${entry.from.source ? `-${entry.from.source}` : ''} (@${botHandle(entry.from.name, member || undefined)})`
        : display

    return (
      <GroupMessageRow
        arrived={arrived(entryKey, Number(entry.at) || 0)}
        dimmed={!inPanel && focusMode && index < focusCutoff}
        display={display}
        entry={entry}
        handoffLine={handoffsAt.get(index)?.[0]?.line}
        index={index}
        key={entryKey}
        label={label}
        lead={isLead}
        member={member}
        mentionComponents={mentionComponents}
        mentionText={mentionText}
        MessageTextContent={MessageTextContent}
        meta={meta}
        onOpenThread={
          // The thread's last entry already ends in the tail's reply link.
          inPanel || threadEnds.get(thread) === index ? null : () => openThread(thread)
        }
        onReply={() => replyToMember(entry, member)}
        onToggleReveal={() => setRevealedSpeaker(revealed ? null : entryKey)}
        replyTag={isUser ? '' : replyMentionTag(entry, member)}
        revealed={revealed}
        roleTitle={roleTitle}
        roomRole={roomRoleLabel}
        runStart={startsSpeakerRun(index > 0 ? room.log[index - 1] : null, entry)}
        Streamdown={Streamdown}
      />
    )
  }

  // The public room is one arrival-ordered conversation. Thread ids scope
  // replies and prompts, not visibility: a newer topic must never hide a
  // member's completed answer or move it ahead of intervening messages.
  const threadEnds = new Map<string, number>()
  const threadCounts = new Map<string, number>()
  room.log.forEach((entry, index) => {
    const thread = groupThreadOf(entry)
    threadEnds.set(thread, index)
    threadCounts.set(thread, (threadCounts.get(thread) || 0) + 1)
  })

  // One pass over the log draws either the whole room or one thread (the
  // panel), with the same rows, cards and live tails in both.
  const buildLog = (only: null | string) => {
    const children: ReactNode[] = []
    // Day separators: the room is one arrival-ordered river, so a reply from
    // yesterday sat flush against one from a minute ago. A hairline row marks
    // each local-day change; the first entry always leads with one.
    let previousDay = -1

    room.log.forEach((entry, index) => {
      const id = groupThreadOf(entry)

      if (only !== null && id !== only) {
        return
      }

      const day = roomDayBucket(Number(entry.at) || 0)

      if (day !== previousDay) {
        previousDay = day
        children.push(
          <div
            className="flex items-center gap-2 px-2 pt-2"
            data-testid="group-day-separator"
            key={`day:${day}:${index}`}
          >
            <span aria-hidden className="h-px flex-1 bg-line" />
            <span className="shrink-0 text-ui-2xs font-medium text-fg-subtle">
              {roomDayLabel(day, { today: b.group.dayToday, yesterday: b.group.dayYesterday })}
            </span>
            <span aria-hidden className="h-px flex-1 bg-line" />
          </div>
        )
      }

      children.push(renderEntry(entry, index, only !== null))

      children.push(
        <LineCards
          allMeta={allMeta}
          handoffsAt={handoffsAt}
          index={index}
          key={`cards:${index}`}
          members={members}
          nameOf={memberLabel}
          onCall={commands.callDecision}
          votesAt={votesAt}
        />
      )

      if (threadEnds.get(id) !== index) {
        return
      }

      children.push(
        <ThreadTail
          allMeta={allMeta}
          clarifies={roomClarifies}
          commands={commands}
          escalations={escalations}
          key={`tail:${id}`}
          live={liveWork}
          members={members}
          nameOf={memberLabel}
          onDismiss={dismissEscalation}
          sessions={room.sessions}
          thread={id}
          workingSince={workingSince}
        />
      )

      if (only !== null) {
        return
      }

      // The thread's tail in the room: how much is in it and the way in.
      children.push(
        <Button
          aria-label={b.group.openThread}
          className="mt-0.5 w-fit items-center gap-1.5 pb-1 pl-11 text-left text-ui-xs text-fg-muted transition-colors hover:text-fg"
          key={`replylink:${id}`}
          onClick={() => openThread(id)}
          size="inline"
          variant="link"
        >
          <Codicon className="text-ui-2xs" name="reply" />
          <span>
            {threadCounts.get(id) && threadCounts.get(id)! > 1
              ? `${b.group.replyCount(threadCounts.get(id)! - 1)} · ${b.group.openThread}`
              : b.group.openThread}
          </span>
        </Button>
      )
    })

    return children
  }

  const logChildren = buildLog(null)

  const threadRail = (embedded: boolean) => (
    <GroupThreadRail
      allMeta={allMeta}
      embedded={embedded}
      focusThread={focusedItem ? focusThread : null}
      items={workItems}
      members={members}
      onBrief={() => {
        openThread(null)
        setBriefOpen(true)
      }}
      onNewThread={() => openThread(null)}
      onSelect={openThread}
      roomKey={groupChatRoomKey(group, room)}
      textOf={thread =>
        room.log
          .filter(entry => groupThreadOf(entry) === thread)
          .map(entry => entry.text)
          .join(' ')
          .toLowerCase()
      }
      totalMessages={room.log.length}
      unseen={unseenByThread}
    />
  )

  const threadPanel = focusedItem ? (
    <GroupThreadPanel
      composer={
        <GroupRoomComposer
          ariaLabel={b.group.replyInThread}
          images={imagesFor(focusedItem.thread)}
          members={members}
          onChange={text => setReplyDrafts(prev => ({ ...prev, [focusedItem.thread]: text }))}
          onEscape={() => openThread(null)}
          onPaste={event => pasteImages(focusedItem.thread, event)}
          onPick={() => void pickGroupAttachments().then(picked => addImages(focusedItem.thread, picked))}
          onRemoveImage={index => removeImage(focusedItem.thread, index)}
          onSubmit={() => submitReply(focusedItem.thread)}
          placeholder={b.group.replyInThreadPlaceholder}
          sendLabel={b.group.reply}
          value={replyDrafts[focusedItem.thread] || ''}
        />
      }
      entryCount={threadCounts.get(focusedItem.thread) || 0}
      header={
        <GroupThreadPanelHeader
          item={focusedItem}
          nameOf={memberLabel}
          onClose={() => openThread(null)}
          onStop={() => void stopGroupThread(group, focusedItem.thread, members)}
          owner={focusedItem.assignees.find(name => members.some(m => m.name === name && !m.remoteSource)) || null}
          teamId={teamLead?.teamId || null}
        />
      }
      onClose={() => openThread(null)}
      thread={focusedItem.thread}
    >
      <RecapCard
        entries={room.log.filter(entry => groupThreadOf(entry) === focusedItem.thread)}
        key={`recap:${focusedItem.thread}`}
        label={b.group.recap.thread}
        nameOf={memberLabel}
      />
      {buildLog(focusedItem.thread)}
    </GroupThreadPanel>
  ) : null

  const isAvailable = (member: GroupMember) => botSourceStatus(member).available

  const stopMember = (member: GroupMember) => {
    const threads = [...liveWork].filter(([, names]) => names.has(member.name)).map(([thread]) => thread)

    for (const thread of threads.length ? threads : ['']) {
      commands.stopMember?.(thread, member)
    }
  }

  const roomKey = groupChatRoomKey(group, room)
  const onListen = (listener: string) => setGroupChatListener(group, listener)

  const membersPanel = (
    <GroupRoomPanel
      allMeta={allMeta}
      available={isAvailable}
      decisionCount={escalations.length + roomClarifies.length}
      decisions={
        <RoomDecisions
          clarifies={roomClarifies}
          commands={commands}
          escalations={escalations}
          memberName={key => memberLabel(members.find(m => groupMemberKey(m) === key)?.name || key)}
          members={members}
          nameOf={memberLabel}
          onDismiss={dismissEscalation}
          onOpen={openThread}
        />
      }
      goal={room.goal || ''}
      group={group}
      leadMember={leadMember}
      liveWork={liveWork}
      members={members}
      onCollapse={inlineAside ? () => showAside(false) : undefined}
      onListen={onListen}
      onManage={() => setMemberPickerOpen(true)}
      onMention={mentionMember}
      onStop={stopMember}
      onTab={setPanelTab}
      onTeamChanged={() => void teamLeadQuery.refetch()}
      prompts={roomClarifies}
      roomKey={roomKey}
      roomWorking={workingNow}
      sessions={room.sessions}
      tab={panelTab}
      teamId={teamLead?.teamId || null}
      threads={layout === 'xwide' ? undefined : threadRail(true)}
      workingSince={workingSince}
    />
  )

  return (
    <div
      className="@container relative flex h-full flex-col"
      onDragLeave={event => {
        // Only clear when leaving the room container itself, not when the
        // cursor moves between its children. React types relatedTarget as a
        // bare EventTarget; on a drag it is always an element or null.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragOver(false)
        }
      }}
      onDragOver={event => {
        if ([...(event.dataTransfer?.types || [])].includes('Files')) {
          event.preventDefault()
          setDragOver(true)
        }
      }}
      onDrop={dropFiles}
      onKeyDown={onRoomKey}
      ref={rootRef}
    >
      {dragOver ? (
        <div
          className="motion-fade-in pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-panel border-2 border-dashed border-brand bg-surface/80 text-brand text-ui-sm font-medium"
          key={'dropzone'}
        >
          {focusedItem ? b.group.dropToThread : b.group.dropToRoom}
        </div>
      ) : null}
      {header}
      {keysOpen ? <KeysHelp onClose={() => setKeysOpen(false)} /> : null}
      <div className="flex min-h-0 flex-1">
        {layout === 'xwide' ? <div className="flex min-h-0">{threadRail(false)}</div> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ paddingInlineEnd: sheetPad }}>
          <GroupHoldStatus
            holds={room.holds}
            memberLabel={member => displayName(member, botRosterMeta(member, allMeta))}
            members={members}
          />
          {view === 'board' ? (
            <GroupRoomBoard
              escalations={escalations}
              handoffs={handoffs}
              items={workItems}
              members={members}
              nameOf={memberLabel}
              onOpen={openThread}
            />
          ) : null}
          {view === 'room' ? activityPanel : null}
          <div
            className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', view === 'board' && 'hidden')}
            data-testid="group-room-log"
            onScroll={onLogScroll}
            ref={scrollerRef}
          >
            {/* minmax(0,1fr): an implicit grid track is min-content sized, so one */}
            {/* unbreakable code line widened every entry to its own width and the */}
            {/* log scrolled sideways as a whole instead of the code block (#91878). */}
            <div className="mx-auto grid w-full max-w-[52rem] grid-cols-[minmax(0,1fr)] gap-1 px-4 pb-4 pt-2">
              {briefOpen ? (
                <RecapCard
                  entries={room.log.filter(entry => Number(entry.at) > Date.now() - 86_400_000)}
                  label={b.group.prefs.briefTitle}
                  nameOf={memberLabel}
                />
              ) : null}
              {showCatchUp ? (
                <CatchUpCard
                  catchUp={catchUp}
                  missed={room.log.filter(entry => Number(entry.at) > visitAnchor)}
                  nameOf={memberLabel}
                  onDismiss={() => setCatchUpDismissed(true)}
                  onOpen={openThread}
                />
              ) : null}
              {room.log.length
                ? logChildren
                : [
                    <GroupRoomEmpty
                      allMeta={allMeta}
                      image={room.image || null}
                      key={'empty'}
                      leadName={teamLead && leadName ? leadName : ''}
                      members={members}
                    />
                  ]}
              {roomClarifies.map(entry => (
                <div className="pt-1" key={`clarify:${entry.thread || 'legacy'}:${entry.memberKey}:${entry.requestId}`}>
                  <GroupClarifyCard
                    entry={entry}
                    members={members}
                    onAnswer={hostedApprovals.has(entry.requestId) ? answerRoomPrompt : undefined}
                  />
                </div>
              ))}
              {hostedRetries.map(action => {
                const taskId = String(action.task_id || '')
                const member = String(action.member || action.member_id || '')

                return (
                  <div
                    className="flex max-w-full items-start gap-3 rounded-card border border-warning/35 bg-warning/8 px-3 py-2"
                    key={`retry:${taskId}:${String(action.execution_generation || '')}`}
                  >
                    <Codicon className="mt-0.5 shrink-0 text-warning" name="warning" />
                    <div className="min-w-0 flex-1 truncate text-ui-sm font-medium text-fg">
                      {b.group.retryTitle(member ? memberLabel(member) : '')}
                    </div>
                    <Button
                      className="shrink-0"
                      onClick={() => void retryRoomAction(action)}
                      size="xs"
                      variant="outline"
                    >
                      {b.group.retry}
                    </Button>
                  </div>
                )
              })}
              <GroupLogTail
                allMeta={allMeta}
                focused={false}
                members={members}
                room={room}
                roomClarifies={roomClarifies}
                roundContributions={roundContributions}
                turnCovered={turnCovered}
              />
              {/* Scroll anchor (#89835): rooms opened at scroll position 0, mid- */
              /* history. The effect below scrolls this sentinel into view on */
              /* mount and on log growth — unless the user has scrolled up. */}
              <div aria-hidden key={'bottom-sentinel'} ref={bottomSentinelRef} />
            </div>
            {/* Reading history: new replies land quietly and this pill offers the
            way back, instead of the log jumping out from under the reader. */}
            {readingHistory ? (
              <div className="pointer-events-none sticky bottom-2 flex justify-center">
                <Button
                  className={cn(
                    'motion-fade-in pointer-events-auto h-7 gap-1 rounded-pill px-3 text-ui-xs shadow-e2',
                    unseen ? 'bg-brand text-white hover:bg-brand/90' : ''
                  )}
                  data-testid="group-jump-latest"
                  onClick={jumpToLatest}
                  size="sm"
                  variant={unseen ? 'default' : 'secondary'}
                >
                  <Codicon name="arrow-down" />
                  {b.group.jumpToLatest(unseen)}
                </Button>
              </div>
            ) : null}
          </div>
          <div className={cn('bg-surface px-4 pb-3 pt-2', view === 'board' && 'hidden')}>
            {/* The main composer always starts a new thread; replies go
                through the open thread's own box. */}
            <div className="mx-auto w-full max-w-[52rem]">
              <GroupComposerContext leadName={teamLead && leadName ? leadName : ''} />
              <GroupRoomComposer
                ariaLabel={b.group.messageRoom(group)}
                images={imagesFor(null)}
                members={members}
                onChange={setDraft}
                onPaste={event => pasteImages(null, event)}
                onPick={() => void pickGroupAttachments().then(picked => addImages(null, picked))}
                onRemoveImage={index => removeImage(null, index)}
                onSubmit={submit}
                placeholder={b.group.newThreadPlaceholder(group)}
                sendLabel={b.group.newThread}
                value={draft}
              />
              <RoomShortcuts
                commands={commands}
                firstTag={groupReplyMentionTag(leadMember || members[0] || { name: 'everyone' }, members) || 'everyone'}
                onHelp={() => setKeysOpen(open => !open)}
                onInsert={setDraft}
                thread={null}
              />
            </div>
          </div>
        </div>
        <GroupRoomAside
          collapsed={asideFolded && !focusedItem}
          label={focusedItem ? focusedItem.title : r.asideLabel}
          layout={layout}
          onExpand={() => showAside(true)}
          onSheetClose={() => showAside(false)}
          panel={threadPanel || membersPanel}
          panelKey={focusedItem ? `thread:${focusedItem.thread}` : 'members'}
          sheetOpen={sheetOpen || Boolean(focusedItem)}
          strip={
            <GroupMembersStrip
              allMeta={allMeta}
              available={isAvailable}
              leadMember={leadMember}
              liveWork={liveWork}
              members={members}
              onListen={onListen}
              onMention={mentionMember}
              onStop={stopMember}
              prompts={roomClarifies}
              roomKey={roomKey}
              roomWorking={workingNow}
              sessions={room.sessions}
              workingSince={workingSince}
            />
          }
        />
      </div>
      <GroupChatSettingsDialog
        group={group}
        members={members}
        onClose={() => setSettingsOpen(false)}
        onDisband={() => setConfirmDisband(true)}
        onManageMembers={() => setMemberPickerOpen(true)}
        open={settingsOpen}
      />
      <GroupMemberPicker
        group={group}
        members={members}
        onClose={() => setMemberPickerOpen(false)}
        open={memberPickerOpen}
      />
      <ConfirmDialog
        busyLabel={b.group.disbanding}
        confirmLabel={b.group.disbandAction}
        description={
          /* New rooms title member sessions by roomId, legacy rooms by name — */
          /* so the copy names the concept, not a literal session title. The */
          /* name is bolded mid-sentence, so the copy splits around it and the */
          /* prefix goes empty where the name leads (core's deleteDesc* shape). */
          <span>
            {b.group.disbandDescPrefix}
            <span className="font-medium text-foreground">{group}</span>
            {b.group.disbandDescSuffix(members.length)}
          </span>
        }
        destructive
        doneLabel={b.group.disbandDone}
        onClose={() => setConfirmDisband(false)}
        onConfirm={async () => {
          clearGroupComposerDraft(composerKeyRef.current)
          await disbandGroupChat(group, members)
          host.notify({
            kind: 'success',
            message: b.group.disbanded(group)
          })
        }}
        open={confirmDisband}
        title={b.group.disbandTitle}
      />
    </div>
  )
}

/** Main-window wrapper: seats the member roster reactively (live roster +
 *  bot meta + the room's stored cross-connection descriptors) so the room
 *  keeps working as members change while the tab is open. Also subscribes to
 *  this pane's visibility (feature-detected host.paneVisibility): retained
 *  panes stay mounted while hidden, so the workspace needs the hidden →
 *  visible edge to re-anchor its log to the bottom (#89835 follow-up). */
interface GroupChatMainViewProps {
  group: string
}

function GroupChatMainView({ group }: GroupChatMainViewProps) {
  const allMeta = useValue($botMeta)
  // Subscribe: membership changes ride bot meta AND the room record.
  useValue($groupChats)
  const roster = useValue($lastRoster)
  const members = useMemo(() => groupChatMemberBots(group, roster, allMeta), [group, roster, allMeta])

  // Older SDKs have no paneVisibility: fall back to an always-visible atom so
  // the hook order stays stable and behavior matches the previous build.
  const $visible = useMemo(
    () =>
      typeof host.paneVisibility === 'function'
        ? host.paneVisibility(`plugin-workspace:${ID}:group:${slugifyProfileName(group)}`)
        : atom(true),
    [group]
  )

  const visible = useValue($visible)

  return (
    <GroupChatWorkspace group={group} members={members} onBack={() => closeGroupChatMainTab(group)} visible={visible} />
  )
}

/** Open a group chat the Discord way: a tab taking over the MAIN chat window
 *  (host.openWorkspace, newer desktops), falling back to the in-panel room
 *  view on desktops whose SDK predates the main-area door.
 *
 *  Ordering matters (#89788 follow-up): the main tab must be RECORDED before
 *  the selection atom is set. Setting the atom first opened a window where
 *  BotsPane rendered with a selected group and an empty tab map — the
 *  in-pane fallback painted alongside the main tab, and because the map
 *  write itself repaints nothing, the duplicate stuck until an unrelated
 *  re-render. */
export function openGroupChat(group: string): void {
  // A room selection supersedes any bot-open transition still hydrating.
  // The in-flight host navigation may complete underneath this workspace,
  // but it may not later close or visually steal the room the user chose.
  bumpBotOpenGeneration()
  $groupNeedsYou.set({
    ...$groupNeedsYou.get(),
    [group]: false
  })
  markGroupOpened(group)
  const ownerKey = groupWorkspaceOwnerKey(group)
  setBotsWorkspaceOwner(ownerKey, null, 'New group conversations start in the group composer.')
  // #93813: what reached the members' room sessions while nobody drove them
  // (a Bot posting reports into its own session, a CLI resume) is posted as
  // the room opens, not only once the room next drives that member.
  void sweepExternalGroupWrites(group, groupChatMemberBots(group, $lastRoster.get(), $botMeta.get()))

  if (typeof host.openWorkspace === 'function') {
    try {
      const close = host.openWorkspace(`${ID}:group:${slugifyProfileName(group)}`, {
        title: group,
        minWidth: '24rem',
        render: () => <GroupChatMainView group={group} />,
        onClose: () => {
          dropGroupMainTab(group)

          if ($groupChatWorkspace.get() === group) {
            $groupChatWorkspace.set(null)
          }
        }
      })

      recordGroupMainTab(group, close)
      // Tab ownership is on record — the atom now only drives the roster
      // highlight; shouldRenderGroupChatInPane stays false throughout.
      $groupChatWorkspace.set(group)

      return
    } catch {
      // Fall through to the in-panel room below.
    }
  }

  // No main-window door (older desktop) or it threw: select the group so
  // the in-panel room renders as the fallback surface.
  $groupChatWorkspace.set(group)
}
