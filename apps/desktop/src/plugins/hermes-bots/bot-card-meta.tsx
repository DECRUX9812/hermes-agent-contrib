/**
 * The bot card's compact meta line (bot-pane UX): the profile's pinned model,
 * its installed skill count, and its org teammates — one muted row of '·'-
 * separated facts under the card's subtitle. Every fact renders only when it
 * exists, so a bare profile keeps the line empty rather than showing
 * "0 skills · no team" noise.
 *
 * Model + skill count ride the roster row (`profiles.list` already returns
 * `model` / `skill_count` — no extra RPC); teammates come from
 * useBotTeammates, the one query the line adds.
 */

import type { BotTeammates } from './bot-teammates'
import { useBotTeammates } from './bot-teammates'
import { useBots } from './i18n'
import type { RosterRow } from './types'

export interface BotCardMetaItem {
  key: string
  /** Fixed-pitch text (the model slug). */
  mono?: boolean
  text: string
}

const REPORTS_SHOWN = 3

/** 'model-slug · 4 skills · led by Scout · leads A, B +2' — facts only. */
export function botCardMetaItems(
  bot: RosterRow | null | undefined,
  teammates: BotTeammates,
  card: {
    leads: (names: string) => string
    ledBy: (name: string) => string
    skills: (count: number) => string
  }
): BotCardMetaItem[] {
  const items: BotCardMetaItem[] = []
  const model = String(bot?.model || '').trim()

  if (model) {
    items.push({ key: 'model', mono: true, text: model })
  }

  const skills = Number(bot?.skill_count || 0)

  if (skills > 0) {
    items.push({ key: 'skills', text: card.skills(skills) })
  }

  for (const lead of teammates.leads) {
    items.push({ key: `lead:${lead}`, text: card.ledBy(lead) })
  }

  if (teammates.reports.length > 0) {
    const shown = teammates.reports.slice(0, REPORTS_SHOWN)
    const extra = teammates.reports.length - shown.length
    items.push({ key: 'reports', text: card.leads(extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', ')) })
  }

  return items
}

export function BotCardMeta({ bot }: { bot: RosterRow }) {
  const b = useBots()
  const teammates = useBotTeammates(bot)
  const items = botCardMetaItems(bot, teammates, b.card)

  if (items.length === 0) {
    return null
  }

  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.6875rem] text-(--ui-text-tertiary)"
      data-testid="bot-card-meta"
    >
      {items.map((item, index) => (
        <span className="flex min-w-0 items-center gap-1.5" key={item.key}>
          {index > 0 ? <span className="text-(--ui-text-quaternary)">·</span> : null}
          <span className={item.mono ? 'truncate font-mono' : 'truncate'}>{item.text}</span>
        </span>
      ))}
    </div>
  )
}
