/**
 * A working teammate's row in the Command Room, with the tool cards for what it
 * is doing now stacked under the row. Each card wears the teammate's face, so
 * two bots on one thread read as two stacks.
 */

import { Button, cn, Codicon, Tip, ToolActivityStack } from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { useMemberToolCards } from './group-room-tool-cards'
import { useBots } from './i18n'
import { useRoomText } from './room-i18n'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember, GroupPrompt } from './types'

/** Working-for how long, as m:ss — re-read on every render, which the
 *  room's clock tick drives. */
function elapsedMMSS(since: number): string {
  const total = Math.max(0, Math.floor((Date.now() - since) / 1000))

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

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
  const t = useRoomText().thread
  const groups = useMemberToolCards(runtime, Boolean(approval))
  const appearance = botAppearance(name, member && allMeta ? botRosterMeta(member, allMeta) : null)
  const color = avatarColor(appearance.color, name)
  const faceImage = appearance.image && !isBackfilledFacePng(appearance.image) ? appearance.image : null
  const stopLabel = b.group.stopMember(nameOf(name))

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5 text-ui-xs">
        <span className="motion-ring shrink-0 overflow-hidden rounded-[22%] text-brand">
          <BotFace color={color} image={faceImage} name={name} shape={appearance.shape} size={20} />
        </span>
        <span
          className={cn('shrink-0 font-medium', !tool && !groups.length && 'motion-shimmer')}
          style={{ color: `color-mix(in oklab, ${color} 62%, var(--color-foreground))` }}
        >
          {t.isWorking(nameOf(name))}
        </span>
        <span className="motion-shimmer min-w-0 flex-1 truncate text-fg-muted">
          {tool && !groups.length ? b.group.activityTool(tool) : null}
        </span>
        {since ? <span className="shrink-0 font-mono tabular-nums text-fg-subtle">{elapsedMMSS(since)}</span> : null}
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
