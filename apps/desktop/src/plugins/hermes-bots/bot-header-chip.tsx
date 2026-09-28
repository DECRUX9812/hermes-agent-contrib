/**
 * Chat-header persona decoration (bot-mode revamp G3/G7): on a bot's
 * canonical Bot Chat header, the role one-liner next to the title and the
 * model chip whose click opens the quick-swap dropdown (C3's catalog).
 *
 * The gate is the canonical identity itself — the session's (profile, title
 * === 'Bot Chat') pair — never a stored session-id pointer: any other chat
 * (side-chats, routine runs, ordinary Sessions-mode chats on the same
 * profile) renders nothing.
 */

import type { ChatHeaderSlotProps } from '@hermes/plugin-sdk'
import { useValue } from '@hermes/plugin-sdk'

import { botHeaderRow } from './bot-header'
import { $botMeta, $lastRoster } from './data'
import { botRole } from './labels'
import { BotModelChip } from './model-menu'
import { botRosterMeta } from './routing'

export function BotHeaderIdentity({ profile, title }: ChatHeaderSlotProps) {
  const roster = useValue($lastRoster)
  const meta = useValue($botMeta)
  const bot = botHeaderRow(roster, profile, title)

  if (!bot) {
    return null
  }

  const role = botRole(bot, botRosterMeta(bot, meta))

  return (
    <span className="pointer-events-auto ml-2 inline-flex min-w-0 items-center gap-1.5 self-center">
      {role ? (
        <span className="min-w-0 truncate text-[0.75rem] font-normal text-(--ui-text-quaternary)" title={role}>
          {role}
        </span>
      ) : null}
      <BotModelChip bot={bot} />
    </span>
  )
}
