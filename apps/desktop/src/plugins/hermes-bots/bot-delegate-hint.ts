/**
 * The delegation hint's detection (bot-pane UX): a session ON A BOT PROFILE
 * that is neither the canonical Bot Chat nor a bots-workspace topic is the
 * one shape Bot Mode's powers don't reach — a plain working session can't
 * hand work to teammates. The answer uses the session's PROVEN owner
 * (host.sessionOwner's title-stamp/hint/tile/runtime ladder) and the
 * workspace bucket it was last opened under (host.state.sessionWorkspaceScopes)
 * — title and scope identity, never a stored-id pointer.
 *
 * Every path out is a "don't hint" so the card can never fire on a session
 * the bots workspace already owns: missing/ambiguous owner, an unlisted
 * profile, a session already scoped 'bots', or the canonical Bot Chat itself
 * (resolved by title on the screen — the same identity rule as everywhere).
 */

import type { PluginSessionOwner, PluginSessionWorkspaceScope } from '@hermes/plugin-sdk'

import { isCanonicalChatOnScreen } from './canonical-chat'
import type { RosterRow } from './types'

/** The dismissed-tip id, shared with the G9 tips store — one dismissal list
 *  per bot covers every teaching card. */
export const DELEGATE_HINT_TIP_ID = 'topic-delegate'

/** The bot a "open this as a topic" hint should name, or null when the hint
 *  must not show. */
export function delegateHintBot(
  roster: readonly RosterRow[] | null | undefined,
  owner: PluginSessionOwner | null | undefined,
  storedSessionId: string | null | undefined,
  scopes: Readonly<Record<string, PluginSessionWorkspaceScope | undefined>> | null | undefined
): RosterRow | null {
  const profile = String(owner?.profile || '').trim()

  if (!profile || !storedSessionId) {
    return null
  }

  // A bots-workspace session IS a topic (or the canonical chat) — nothing to
  // suggest. Any other bucket ('sessions', a tile with no mode) is a plain
  // working chat and may hint.
  if (scopes?.[storedSessionId]?.workspaceMode === 'bots') {
    return null
  }

  const connectionId = String(owner?.connectionId || '').trim()

  const rows = Array.isArray(roster) ? roster : []

  const row = rows.find(
    candidate =>
      candidate?.name === profile &&
      (!connectionId || !candidate?.connectionId || candidate.connectionId === connectionId)
  )

  // Delegation needs someone to hand work to: a lone bot (a new install's
  // first chat with its main bot) has no teammates, so the chip would point
  // at a power that can't do anything yet.
  if (!row || !rows.some(candidate => candidate !== row)) {
    return null
  }

  return isCanonicalChatOnScreen(row, storedSessionId) ? null : row
}
