/**
 * Teaching moments (bot-mode G9): dismissible capability tip cards under a
 * bot's first-run canonical chat — "I can use websites, not just search them",
 * "I can run on a schedule". Each card's button does the thing rather than
 * describe it: the computer pane opens, the routines pane opens. Dismissed
 * cards stay dismissed per bot on this device (bot-tips.ts), so a returning
 * user never re-reads a tip they already cleared.
 *
 * Rendered as a second `chat.empty` contribution beside BotChatEmpty's hero —
 * the slot mounts every registration and lets each answer for itself, so the
 * tips claim only the sessions the hero does: a canonical Bot Chat with an
 * empty transcript, which for a forever-chat means its first run. This list
 * is also the seam Ideas/Feed-style prompt suggestions hang off later.
 */

import { Codicon, host, useValue } from '@hermes/plugin-sdk'

import { $dismissedBotTips, dismissBotTip } from './bot-tips'
import { botForChat } from './chat-empty'
import { $botMeta, $lastRoster, botSelectionKey } from './data'
import { useBots } from './i18n'
import { botRosterMeta } from './routing'
import { openBotScreen } from './screen-open'
import { ID } from './shared'
import type { BotMeta, RosterRow } from './types'

interface BotTip {
  icon: string
  id: 'computer' | 'delegate' | 'schedule'
  run: () => void
}

/** The standing capability list. Small on purpose — tips teach the doors a
 *  first-run chat does not make obvious, they are not a feature tour. */
export function botTips(bot: RosterRow, meta: BotMeta | null | undefined): BotTip[] {
  return [
    {
      icon: 'globe',
      id: 'computer',
      run: () => openBotScreen(bot, meta)
    },
    {
      icon: 'history',
      id: 'schedule',
      run: () => void host.revealPane(`${ID}:routines`)
    },
    {
      icon: 'organization',
      id: 'delegate',
      run: () => void host.revealPane(`${ID}:pane`)
    }
  ]
}

export function BotChatTips({ sessionId }: { sessionId: string }) {
  const t = useBots()
  const roster = useValue($lastRoster)
  const allMeta = useValue($botMeta)
  const dismissed = useValue($dismissedBotTips)
  // Focus moves the slot's runtime id to a stored one — the same subscription
  // BotChatEmpty takes.
  useValue(host.state.focusedStoredSessionId)
  const bot = botForChat(roster, sessionId)

  if (!bot) {
    return null
  }

  const key = botSelectionKey(bot)
  const cleared = new Set(dismissed[key] ?? [])
  const tips = botTips(bot, botRosterMeta(bot, allMeta)).filter(tip => !cleared.has(tip.id))

  if (!tips.length) {
    return null
  }

  const copy: Record<BotTip['id'], { action: string; text: string }> = {
    computer: { action: t.tips.openComputer, text: t.tips.computer },
    delegate: { action: t.tips.openBots, text: t.tips.delegate },
    schedule: { action: t.tips.openRoutines, text: t.tips.schedule }
  }

  return (
    <div
      className="pointer-events-auto flex w-full max-w-lg flex-col gap-1.5 px-6 pt-2"
      data-slot="bot_chat_tips"
    >
      {tips.map(tip => (
        <div
          className="flex items-center gap-2.5 rounded-lg border border-(--dt-composer-ring)/25 bg-accent/12 px-3 py-2 text-left"
          data-bot-tip={tip.id}
          key={tip.id}
        >
          <Codicon className="shrink-0 text-[0.8rem] text-(--ui-text-tertiary)" name={tip.icon} />
          <p className="m-0 min-w-0 flex-1 text-[0.72rem] leading-snug text-muted-foreground/90">
            {copy[tip.id].text}
          </p>
          <button
            className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[0.7rem] font-medium text-(--ui-accent-primary, var(--primary)) transition-colors hover:bg-accent/40"
            onClick={tip.run}
            type="button"
          >
            {copy[tip.id].action}
          </button>
          <button
            aria-label={t.tips.dismiss}
            className="flex shrink-0 cursor-pointer items-center text-[0.7rem] text-(--ui-text-quaternary) transition-colors hover:text-(--ui-text-secondary)"
            onClick={() => dismissBotTip(key, tip.id)}
            type="button"
          >
            <Codicon name="close" />
          </button>
        </div>
      ))}
    </div>
  )
}
