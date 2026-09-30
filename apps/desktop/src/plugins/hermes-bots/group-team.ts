/**
 * Team-room orchestration: when a group room's local members are exactly one Bot Team's seats
 * (`tools/bot_team.py` org tree), the room listens through the LEAD only — one RPC answers who
 * that is, and every teammate stays asleep until addressed (@mention or the lead's delegation).
 * Unresolved — no covering team, ambiguity between teams, a paused lead, or an older gateway
 * that predates `bots_team.room_lead` — means the room keeps fan-out listening, unchanged.
 */

import { host } from '@hermes/plugin-sdk'

import { groupMemberKey } from './group-membership'
import type { GroupMember } from './types'

/** What `bots_team.room_lead` resolved for a room. `lead` is the lead member's
 *  profile name — for a local member that IS its member key (groupMemberKey). */
export interface TeamRoomLead {
  lead: string
  leadTitle: string
  teamId: string
  teamName: string
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

/** `bots_team.room_lead` on the active gateway (the team store is install-wide).
 *  Every failure — older gateway without the method, transport errors — is `null`,
 *  never a change in listening behavior. */
export async function resolveTeamRoomLead(members: GroupMember[]): Promise<null | TeamRoomLead> {
  const profiles = localMemberProfiles(members)

  if (!profiles.length) {
    return null
  }

  try {
    const res = await host.request<{
      lead?: null | string
      lead_title?: string
      team_id?: null | string
      team_name?: string
    }>('bots_team.room_lead', { members: profiles })

    const lead = String(res?.lead || '').trim()

    return lead
      ? {
          lead,
          leadTitle: String(res?.lead_title || ''),
          teamId: String(res?.team_id || ''),
          teamName: String(res?.team_name || '')
        }
      : null
  } catch {
    return null
  }
}

/** The room member the resolved lead occupies. Only a LOCAL member can lead
 *  (team seats are profiles); a stored lead that no local seat matches is no lead. */
export function teamLeadMember(lead: null | TeamRoomLead | string, members: GroupMember[]): GroupMember | null {
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
