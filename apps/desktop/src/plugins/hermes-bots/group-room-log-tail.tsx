/**
 * The room log's tail: the settled round's one-line-per-member summary and the
 * typing row while a member is mid-turn. Lifted out of the room view so the
 * view stays one file of layout, not every widget.
 */

import { Codicon } from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import type { GroupChatRoom } from './group-chat'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember } from './types'

export interface GroupLogTailProps {
  allMeta: Record<string, BotMeta>
  /** A focused thread hides the room-wide round summary. */
  focused: boolean
  members: GroupMember[]
  room: GroupChatRoom
  roomClarifies: readonly unknown[]
  roundContributions: readonly { line: string; name: string }[]
  /** The on-turn member already paints a working row in the thread tail. */
  turnCovered: boolean
}

export function GroupLogTail({
  allMeta,
  focused,
  members,
  room,
  roomClarifies,
  roundContributions,
  turnCovered
}: GroupLogTailProps) {
  const b = useBots()

  return (
    <>
      {/* D2 — after a round settles, one card per member's first line
      (pure derivation over the log; no LLM call). */}
      {!focused && !room.running && roundContributions.length ? (
        <div
          className="mt-1.5 rounded-card border border-line bg-surface-raised px-4 py-3"
          data-testid="group-round-summary"
          key={'round-summary'}
        >
          <div className="mb-1 ui-section-label">{b.group.roundSummaryTitle}</div>
          <ul className="flex flex-col gap-0.5">
            {roundContributions.map(entry => {
              const summaryMember = members.find(member => member.name === entry.name)

              const summaryAppearance = summaryMember
                ? botAppearance(summaryMember.name, botRosterMeta(summaryMember, allMeta))
                : null

              return (
                <li className="flex items-baseline gap-1.5 text-ui-xs" key={`summary:${entry.name}`}>
                  <span
                    className="shrink-0 font-medium"
                    style={{
                      color: summaryAppearance
                        ? `color-mix(in oklab, ${avatarColor(summaryAppearance.color, entry.name)} 62%, var(--color-foreground))`
                        : undefined
                    }}
                  >
                    {summaryMember ? displayName(summaryMember, botRosterMeta(summaryMember, allMeta)) : entry.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-fg-muted">{entry.line}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
      {room.running && (!turnCovered || roomClarifies.length) ? (
        <div className="flex items-center gap-2 px-2 pt-1 text-ui-2xs text-fg-muted" key={'working'}>
          {(() => {
            // Typing indicator: the thinking member's mini face, or the
            // classic three-dot pulse when the turn isn't attributable.
            const turnAppearance = room.turn ? botAppearance(room.turn.name, botRosterMeta(room.turn, allMeta)) : null

            const turnImage = turnAppearance?.image

            return turnAppearance ? (
              <span className="shrink-0 overflow-hidden rounded-[22%]">
                <BotFace
                  color={avatarColor(turnAppearance.color, room.turn ? room.turn.name : 'agent')}
                  image={turnImage && !isBackfilledFacePng(turnImage) ? turnImage : null}
                  name={room.turn ? room.turn.name : 'agent'}
                  shape={turnAppearance.shape}
                  size={16}
                />
              </span>
            ) : (
              <span aria-hidden className="flex items-center gap-0.5 px-1 py-1">
                {[0, 1, 2].map(dot => (
                  <span
                    className="size-1 animate-pulse rounded-full bg-fg-muted"
                    key={dot}
                    style={{ animationDelay: `${dot * 200}ms` }}
                  />
                ))}
              </span>
            )
          })()}
          <span>
            {roomClarifies.length
              ? b.group.waitingForAnswer
              : room.turn
                ? b.group.memberThinking(displayName(room.turn, botRosterMeta(room.turn, allMeta)))
                : b.group.roomWorking}
          </span>
        </div>
      ) : null}
    </>
  )
}

/** An empty room: its picture, its faces, and who will answer the first ask. */
export function GroupRoomEmpty({
  allMeta,
  image,
  leadName,
  members
}: {
  allMeta: Record<string, BotMeta>
  image: null | string
  leadName: string
  members: GroupMember[]
}) {
  const b = useBots()
  const room = { image }

  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-10 text-center">
      {room.image ? (
        <img alt="" className="size-11 rounded-xl object-cover ring-1 ring-line" src={room.image} />
      ) : (
        <span className="flex size-11 items-center justify-center rounded-xl bg-hover text-lg text-fg-muted">
          <Codicon name="organization" />
        </span>
      )}
      {members.length ? (
        <span aria-hidden className="flex -space-x-1">
          {members.slice(0, 6).map((member, faceIndex) => {
            const faceAppearance = botAppearance(member.name, botRosterMeta(member, allMeta))
            const faceImage = faceAppearance.image

            return (
              <span
                className="shrink-0 overflow-hidden rounded-[22%] bg-surface ring-1 ring-surface"
                key={`empty-face:${member.connectionId || ''}:${member.name}:${faceIndex}`}
              >
                <BotFace
                  color={avatarColor(faceAppearance.color, member.name)}
                  image={faceImage && !isBackfilledFacePng(faceImage) ? faceImage : null}
                  name={member.name}
                  shape={faceAppearance.shape}
                  size={22}
                />
              </span>
            )
          })}
        </span>
      ) : null}
      <div className="max-w-72 text-ui-xs text-fg-muted">
        {leadName ? b.group.composerPlaceholderTeam(leadName) : b.group.composerPlaceholder}
      </div>
    </div>
  )
}
