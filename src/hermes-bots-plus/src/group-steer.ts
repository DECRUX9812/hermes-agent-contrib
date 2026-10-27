/**
 * Steer for group rooms: hand a few words to the member on turn mid-turn,
 * through Hermes' own session.steer (no new turn, nothing interrupted).
 *
 * Plain Send already queues behind the room drive; Steer is the other verb
 * the Bot Chat composer has. Returns null when nobody is mid-turn or the
 * session refused, so the caller can fall back to a queued send.
 */

import { currentGroupActivity, recordGroupActivity } from './group-activity'
import { $groupChats } from './group-chat'
import type { GroupChatRoom } from './group-chat'
import { groupMemberKey, groupSessionKey, hasThreadScopedGroupSession } from './group-membership'
import { requestForBot } from './routing'
import type { GroupMember } from './types'

export interface GroupSteerTarget {
  member: GroupMember
  sessionId: string
  thread: null | string
}

/** The member on turn and the session it is running in, or null. */
export function groupSteerTarget(group: string): GroupSteerTarget | null {
  const room = $groupChats.get()[group] as GroupChatRoom | undefined
  const member = room?.running ? room.turn : null

  if (!member) {
    return null
  }

  const working = currentGroupActivity(group).filter(event => event.kind === 'working').at(-1)
  const thread = working?.thread || null
  const sessions = room?.sessions || {}
  const key = groupMemberKey(member)

  const sessionId =
    sessions[groupSessionKey(thread || 'legacy', member)] ||
    (hasThreadScopedGroupSession(sessions, key) ? null : sessions[key])

  return typeof sessionId === 'string' && sessionId ? { member, sessionId, thread } : null
}

/** Steer the member on turn with `text`. Resolves the target on success. */
export async function steerGroupTurn(group: string, text: string): Promise<GroupSteerTarget | null> {
  const trimmed = text.trim()
  const target = trimmed ? groupSteerTarget(group) : null

  if (!target) {
    return null
  }

  let status = ''

  try {
    const result = await requestForBot<{ status?: string }>(target.member, 'session.steer', {
      session_id: target.sessionId,
      text: trimmed
    })

    status = String(result?.status || '')
  } catch {
    return null
  }

  // 'queued' = accepted (spliced into the running turn, or held for the
  // session's next turn while it compresses); 'rejected' = not mid-turn.
  if (status !== 'queued') {
    return null
  }

  recordGroupActivity(group, {
    kind: 'steered',
    member: 'You',
    preview: trimmed,
    thread: target.thread
  })

  return target
}
