/**
 * The room's members as a column of faces: what the right slot shows when the
 * panel is folded or the room is too narrow for it. Lead first, then whoever
 * is working; the face's ring carries presence and the tooltip names them.
 */

import { Button, cn, Tip } from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { groupMemberKey } from './group-membership'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember } from './types'

export interface GroupMembersStripProps {
  allMeta: Record<string, BotMeta>
  leadMember: GroupMember | null
  members: GroupMember[]
  onSelect: (member: GroupMember) => void
  roomWorking: ReadonlySet<string>
}

export function GroupMembersStrip({ allMeta, leadMember, members, onSelect, roomWorking }: GroupMembersStripProps) {
  const leadKey = leadMember ? groupMemberKey(leadMember) : ''

  const rank = (member: GroupMember) =>
    groupMemberKey(member) === leadKey ? 0 : roomWorking.has(member.name) ? 1 : 2

  const ordered = [...members].sort((x, y) => rank(x) - rank(y))

  return (
    <ul className="m-0 flex list-none flex-col items-center gap-2 p-0" data-testid="group-members-strip">
      {ordered.map(member => {
        const meta = botRosterMeta(member, allMeta)
        const appearance = botAppearance(member.name, meta)
        const image = appearance.image && !isBackfilledFacePng(appearance.image) ? appearance.image : null
        const working = roomWorking.has(member.name)
        const name = displayName(member, meta)

        return (
          <li data-flip-key={groupMemberKey(member)} key={groupMemberKey(member)}>
            <Tip label={name} side="left">
              <Button
                aria-label={name}
                className="size-10 rounded-row p-0"
                data-working={working ? '' : undefined}
                onClick={() => onSelect(member)}
                size="inline"
                variant="ghost"
              >
                <span
                  className={cn('block rounded-[22%] text-brand', working && 'motion-ring')}
                  data-member-face={groupMemberKey(member)}
                >
                  <span className="block overflow-hidden rounded-[22%] ring-1 ring-line">
                    <BotFace
                      color={avatarColor(appearance.color, member.name)}
                      image={image}
                      name={member.name}
                      shape={appearance.shape}
                      size={32}
                    />
                  </span>
                </span>
              </Button>
            </Tip>
          </li>
        )
      })}
    </ul>
  )
}
