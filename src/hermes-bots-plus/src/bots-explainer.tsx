/**
 * "How bots work" — the mental-model block in the roster's empty state
 * (bot-pane UX). Users conflate bots / profiles / the one forever chat, so
 * the first-run surface teaches the four rules that never change: Bot Chat
 * is the inbox, New topic is a fresh powered chat, @mentions pull in
 * teammates, and a bot is just a profile with an identity.
 *
 * One compact list under the starter chips — copy lives in i18n.roster.how*.
 */

import { Codicon } from '@hermes/plugin-sdk'

import { useBots } from './i18n'

const EXPLAINER_LINES = [
  { icon: 'inbox', key: 'howInbox' },
  { icon: 'comment-add', key: 'howTopic' },
  { icon: 'mention', key: 'howMention' },
  { icon: 'hubot', key: 'howProfiles' }
] as const

export function BotsHowItWorks() {
  const b = useBots()

  return (
    <div className="mt-1.5 flex w-full max-w-64 flex-col gap-1.5 text-left" data-testid="bots-how-it-works">
      <p className="text-[0.625rem] font-medium uppercase tracking-wider text-(--ui-text-quaternary)">
        {b.roster.howTitle}
      </p>
      {EXPLAINER_LINES.map(line => (
        <p className="flex items-start gap-1.5 text-[0.6875rem] leading-snug text-(--ui-text-tertiary)" key={line.key}>
          <Codicon className="mt-px shrink-0 text-(--ui-text-quaternary)" name={line.icon} />
          <span>{b.roster[line.key]}</span>
        </p>
      ))}
    </div>
  )
}
