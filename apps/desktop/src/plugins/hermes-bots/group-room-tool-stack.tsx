/**
 * A working teammate's row in the Command Room, with the tool cards for what it
 * is doing now stacked under the row. Each card wears the teammate's face, so
 * two bots on one thread read as two stacks.
 */

import { Button, Codicon, relativeTime, Tip, ToolActivityStack } from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { useMemberToolCards } from './group-room-tool-cards'
import { useBots } from './i18n'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember, GroupPrompt } from './types'

export function groupClarifyKey(entry: GroupPrompt): string {
  return `${entry.thread || 'legacy'}:${entry.memberKey}:${entry.requestId}`
}

function revealGroupClarify(entry: GroupPrompt): void {
  const key = groupClarifyKey(entry)

  const card = Array.from(document.querySelectorAll<HTMLElement>('[data-group-clarify]')).find(
    el => el.dataset.groupClarify === key
  )

  card?.scrollIntoView({ block: 'nearest' })
}

export interface ActivityMemberProps {
  allMeta?: Record<string, BotMeta>
  /** The member's open approval on this thread, when it is waiting on one. */
  approval?: GroupPrompt
  member?: GroupMember
  name: string
  nameOf: (name: string) => string
  onStop?: (member: GroupMember) => void
  since: null | number
  /** The member's runtime session id, which keys its tool parts. */
  runtime: null | string
  /** The live tool from the status items; the cards already say it when present. */
  tool?: string
}

export function ActivityMember({
  allMeta,
  approval,
  member,
  name,
  nameOf,
  onStop,
  runtime,
  since,
  tool
}: ActivityMemberProps) {
  const b = useBots()
  const groups = useMemberToolCards(runtime, Boolean(approval))
  const appearance = botAppearance(name, member && allMeta ? botRosterMeta(member, allMeta) : null)
  const color = avatarColor(appearance.color, name)
  const faceImage = appearance.image && !isBackfilledFacePng(appearance.image) ? appearance.image : null
  const stopLabel = b.group.stopMember(nameOf(name))

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5 text-ui-xs">
        <span className="shrink-0 overflow-hidden rounded-[22%] ring-1 ring-info motion-safe:animate-pulse">
          <BotFace color={color} image={faceImage} name={name} shape={appearance.shape} size={16} />
        </span>
        <span
          className="shrink-0 font-semibold"
          style={{ color: `color-mix(in oklab, ${color} 62%, var(--color-foreground))` }}
        >
          {nameOf(name)}
        </span>
        <span className="min-w-0 flex-1 truncate text-fg-muted">
          {groups.length || !tool ? b.group.activityWorking : b.group.activityTool(tool)}
        </span>
        {since ? <span className="shrink-0 text-fg-subtle">{relativeTime(since)}</span> : null}
        {member && onStop ? (
          <Tip label={stopLabel}>
            <Button aria-label={stopLabel} onClick={() => onStop(member)} size="icon-xs" variant="ghost">
              <Codicon name="debug-stop" />
            </Button>
          </Tip>
        ) : null}
      </div>
      <ToolActivityStack
        actor={<BotFace color={color} image={faceImage} name={name} shape={appearance.shape} size={14} />}
        className="pl-5"
        groups={groups}
        onReviewApproval={approval ? () => revealGroupClarify(approval) : undefined}
      />
    </div>
  )
}
