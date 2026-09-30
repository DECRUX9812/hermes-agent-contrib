/**
 * Team-room orchestration: when a group room's local members are exactly one Bot Team's seats
 * (`tools/bot_team.py` org tree), the room listens through the LEAD only — one RPC answers who
 * that is, and every teammate stays asleep until addressed (@mention or the lead's delegation).
 * Unresolved — no covering team, ambiguity between teams, a paused lead, or an older gateway
 * that predates `bots_team.room_lead` — means the room keeps fan-out listening, unchanged.
 * A TRANSIENT failure (the socket reconnecting after a profile switch) is not "no team": it
 * retries, then keeps the lead this member set last resolved to, so a blip never wakes the
 * whole team for one turn.
 */

import { host } from '@hermes/plugin-sdk'

import { groupMemberKey } from './group-membership'
import type { GroupMember } from './types'

/** What `bots_team.room_lead` resolved for a room. `lead` is the lead member's
 *  profile name — for a local member that IS its member key (groupMemberKey). */
export interface TeamRoomLead {
  lead: string
  leadTitle: string
  /** Set when the room's own `listener` picked the lead: its durable member
   *  key, which may name a remote member (team leads are always local). */
  memberKey?: string
  teamId: string
  teamName: string
}

/** `GroupChat.listener` value that forces fan-out even in a team room. */
export const ROOM_LISTENER_EVERYONE = 'everyone'

/** Who hears a plain user turn in this room. The room's own pick wins:
 *  'everyone' keeps fan-out, a member key makes that member the sole listener.
 *  Unset — or a pick whose member has since left — defers to the bot team's
 *  org-tree lead, and null (no team) keeps fan-out. */
export async function resolveRoomListener(
  listener: null | string | undefined,
  members: GroupMember[]
): Promise<null | TeamRoomLead> {
  if (listener === ROOM_LISTENER_EVERYONE) {
    return null
  }

  const picked = listener ? (members || []).find(member => groupMemberKey(member) === listener) : undefined

  if (picked) {
    return { lead: String(picked.name || ''), leadTitle: '', memberKey: listener!, teamId: '', teamName: '' }
  }

  return resolveTeamRoomLead(members)
}

/** The room's LOCAL member profiles — the only seats a team can hold. Remote members
 *  are guests of whatever machine hosts them and never enter team matching. */
export function localMemberProfiles(members: GroupMember[]): string[] {
  return [
    ...new Set(
      (members || [])
        .filter(member => !member?.remoteSource)
        .map(member => String(member?.name || '').trim())
        .filter(Boolean)
    )
  ]
}

/** Waits between `bots_team.room_lead` attempts after a transient failure. */
const ROOM_LEAD_RETRY_MS = [400, 1200]

/** The last answer per member set (sorted local profiles). The team store is
 *  install-wide, so one answer holds for every room seating the same bots. */
const lastRoomLead = new Map<string, null | TeamRoomLead>()

/** An older gateway that predates the RPC: fan-out, never a retry. */
function isMethodNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  const message = String((error as { message?: unknown } | null)?.message || '').toLowerCase()

  return code === -32601 || message.includes('method not found')
}

/** `bots_team.room_lead` on the active gateway (the team store is install-wide).
 *  A gateway without the method is `null` (fan-out). A transient failure retries,
 *  then falls back to the member set's last answer — never to a silent fan-out
 *  that wakes every teammate because the socket was reconnecting. */
export async function resolveTeamRoomLead(members: GroupMember[]): Promise<null | TeamRoomLead> {
  const profiles = localMemberProfiles(members)

  if (!profiles.length) {
    return null
  }

  const memberSet = [...profiles].sort().join('\n')

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await host.request<{
        lead?: null | string
        lead_title?: string
        team_id?: null | string
        team_name?: string
      }>('bots_team.room_lead', { members: profiles })

      const lead = String(res?.lead || '').trim()

      const resolved = lead
        ? {
            lead,
            leadTitle: String(res?.lead_title || ''),
            teamId: String(res?.team_id || ''),
            teamName: String(res?.team_name || '')
          }
        : null

      lastRoomLead.set(memberSet, resolved)

      return resolved
    } catch (error) {
      if (isMethodNotFound(error)) {
        return null
      }

      if (attempt >= ROOM_LEAD_RETRY_MS.length) {
        return lastRoomLead.get(memberSet) ?? null
      }

      await new Promise(resolve => setTimeout(resolve, ROOM_LEAD_RETRY_MS[attempt]))
    }
  }
}

/** The room member the resolved lead occupies. Only a LOCAL member can lead
 *  (team seats are profiles); a stored lead that no local seat matches is no lead. */
export function teamLeadMember(lead: null | TeamRoomLead | string, members: GroupMember[]): GroupMember | null {
  if (typeof lead === 'object' && lead?.memberKey) {
    return (members || []).find(member => groupMemberKey(member) === lead.memberKey) || null
  }

  const profile = typeof lead === 'string' ? lead : lead?.lead

  if (!profile) {
    return null
  }

  return (
    (members || []).find(member => !member?.remoteSource && String(member?.name || '') === profile) || null
  )
}

/** The gate key `resolveGroupResponders` compares against `groupMemberKey`. */
export function teamLeadKey(lead: null | TeamRoomLead | string, members: GroupMember[]): null | string {
  const member = teamLeadMember(lead, members)

  return member ? groupMemberKey(member) : null
}
