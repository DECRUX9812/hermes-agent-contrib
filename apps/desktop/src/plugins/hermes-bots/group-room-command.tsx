/**
 * The Command Room's CEO controls: what the user can do about the room's work
 * without typing it out — nudge or reassign a stalled handoff, run a status
 * check, start a handoff or a decision — and the Decisions queue that gathers
 * everything waiting on them (escalations and the bots' questions; the team's
 * approvals join it in the panel).
 *
 * Every action is an ordinary room message in the protocol's own words
 * (group-room-handoffs.ts), so the bots read it like any other turn and the
 * conversation stays the single record of what happened.
 */

import { Button, Codicon } from '@hermes/plugin-sdk'

import type { GroupRoomPrompt } from './group-chat-parts'
import { EscalationCard } from './group-room-cards'
import { handoffLine, nudgeLine, type RoomEscalation, type RoomHandoff, STATUS_CHECK_LINE } from './group-room-handoffs'
import { groupReplyMentionTag, sendToGroupChat } from './group-rounds'
import { useBots } from './i18n'
import type { GroupMember } from './types'

export interface RoomCommands {
  nudge: (handoff: RoomHandoff) => void
  reassign: (handoff: RoomHandoff, member: GroupMember) => void
  statusCheck: (thread: null | string) => void
}

/** The room's actions, bound to its live seating (`seat` re-reads the roster
 *  at send time, like the composer's own sends). */
export function roomCommands(group: string, members: GroupMember[], seat: () => GroupMember[]): RoomCommands {
  const tag = (name: string) => groupReplyMentionTag(members.find(m => m.name === name) || { name }, members) || name

  return {
    nudge: handoff => void sendToGroupChat(group, seat(), nudgeLine(tag(handoff.to), handoff.task), handoff.thread, []),
    reassign: (handoff, member) =>
      void sendToGroupChat(
        group,
        seat(),
        handoffLine(tag(member.name), handoff.task, handoff.doneWhen, handoff.dueMinutes || 30),
        handoff.thread,
        []
      ),
    statusCheck: thread => void sendToGroupChat(group, seat(), STATUS_CHECK_LINE, thread, [])
  }
}

export interface RoomDecisionsProps {
  clarifies: readonly GroupRoomPrompt[]
  commands: RoomCommands
  escalations: readonly RoomEscalation[]
  memberName: (memberKey: string) => string
  members: GroupMember[]
  nameOf: (name: string) => string
  onDismiss: (escalation: RoomEscalation) => void
  onOpen: (thread: string) => void
}

/** Escalations first (they stall the team), then the bots' open questions. */
export function RoomDecisions({
  clarifies,
  commands,
  escalations,
  memberName,
  members,
  nameOf,
  onDismiss,
  onOpen
}: RoomDecisionsProps) {
  const b = useBots()

  return (
    <>
      {escalations.map(escalation => (
        <EscalationCard
          compact
          escalation={escalation}
          key={`${escalation.kind}:${escalation.handoff.id}`}
          members={members}
          nameOf={nameOf}
          onDismiss={() => onDismiss(escalation)}
          onNudge={() => commands.nudge(escalation.handoff)}
          onOpen={() => onOpen(escalation.handoff.thread)}
          onReassign={member => commands.reassign(escalation.handoff, member)}
        />
      ))}
      {clarifies.map(entry => (
        <button
          className="flex cursor-pointer flex-col gap-0.5 rounded-xl border border-violet-500/30 bg-violet-500/6 px-3 py-2 text-left"
          data-testid="group-decision-question"
          key={`${entry.thread || 'legacy'}:${entry.memberKey}:${entry.requestId}`}
          onClick={() => onOpen(entry.thread || 'legacy')}
          type="button"
        >
          <span className="text-[0.6875rem] font-semibold text-violet-700 dark:text-violet-300">
            {b.group.decisionQuestion(memberName(entry.memberKey))}
          </span>
          <span className="text-[0.75rem] text-(--ui-text-secondary)">{b.group.openThread}</span>
        </button>
      ))}
    </>
  )
}

export interface RoomShortcutsProps {
  commands: RoomCommands
  /** Fill the composer (the current thread's draft or the new-thread one). */
  onInsert: (text: string) => void
  /** Tag the handoff template starts with: the lead, else the first member. */
  firstTag: string
  thread: null | string
}

/** The CEO's shortcuts under the composer: hand off, status check, decide. */
export function RoomShortcuts({ commands, firstTag, onInsert, thread }: RoomShortcutsProps) {
  const b = useBots()
  const s = b.group.shortcuts

  const chip = (label: string, icon: string, onClick: () => void) => (
    <Button
      className="h-7 rounded-full px-2.5 text-[0.6875rem]"
      key={label}
      onClick={onClick}
      size="sm"
      type="button"
      variant="outline"
    >
      <Codicon name={icon} />
      {label}
    </Button>
  )

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="group-room-shortcuts">
      {chip(s.handoff, 'arrow-swap', () => onInsert(handoffLine(firstTag, '<task>', '<check>', 30)))}
      {chip(s.status, 'pulse', () => commands.statusCheck(thread))}
      {chip(s.decide, 'question', () => onInsert(b.group.decideTemplate))}
    </div>
  )
}
