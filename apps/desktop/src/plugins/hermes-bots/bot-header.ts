/**
 * Chat-header gate (bot-mode revamp G7): which roster row a session header
 * may decorate, as a pure lookup so the invariant is testable without React.
 *
 * A header chip exists for the bot's canonical Bot Chat ONLY — identity is
 * the (profile, title === 'Bot Chat') pair, never a stored session id and
 * never recency: a side-chat, a routine run, or an ordinary Sessions chat on
 * the same profile renders nothing.
 */

import { CANONICAL_CHAT_TITLE } from './canonical-chat'
import type { RosterRow } from './types'

export function botHeaderRow(
  roster: readonly RosterRow[] | null | undefined,
  profile: null | string,
  title: string
): RosterRow | null {
  if (!profile || title !== CANONICAL_CHAT_TITLE) {
    return null
  }

  return (roster || []).find(row => row.name === profile || row.targetProfile === profile) || null
}
