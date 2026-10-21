/**
 * The `::botplan` approval card (bot-mode B1) — a transcript directive
 * contribution rendered where the model ended its reply with a bare
 * `::botplan` paragraph after a numbered plan.
 *
 * Three outcomes, all renderer-side:
 *   Approve  → submits the execute prompt (`Execute this plan: …`) through the
 *              session's own composer surface — the transcript gains a visible
 *              approval turn, which is ALSO the marker the checklist derives
 *              its "approved" state from.
 *   Edit     → paints the parsed plan into the composer for the user to amend;
 *              whatever they send counts as a reply and settles the card.
 *   Dismiss  → the card folds to a muted note; the numbered list above stays
 *              as ordinary chat text.
 *
 * Scoped to canonical Bot Chats only (the `/plan` composer middleware only
 * fires there, so the marker should never appear elsewhere — if it does, the
 * card stays inert rather than rendering plan chrome in a random chat). The
 * card's settled identity is its own message text: a `::botplan` reply IS its
 * plan, so the text is a stable key across virtualization remounts.
 */

import {
  answeredAfter,
  chatMessageText,
  cn,
  Codicon,
  host,
  type TranscriptDirectiveProps,
  useSessionView,
  useValue
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import { buildPlanExecutePrompt, parseBotPlanReply } from './bot-plan'
import { isCanonicalChatOnScreen } from './canonical-chat'
import { $lastRoster, cachedUnionRoster } from './data'
import { useBots } from './i18n'

/** Whether `storedId` is some roster bot's canonical Bot Chat. The live
 *  `$lastRoster` covers the common path; `cachedUnionRoster` backstops a card
 *  rendered before the roster's first fetch landed. */
export function canonicalBotChatOnScreen(storedId: string | null): boolean {
  if (!storedId) {
    return false
  }

  const union = cachedUnionRoster()

  for (const row of [...(union?.profiles ?? []), ...$lastRoster.get()]) {
    if (isCanonicalChatOnScreen(row, storedId)) {
      return true
    }
  }

  return false
}

/** Handled proposals, module-scoped like `::ask`'s settled set — transcript
 *  virtualization remounts directives with fresh state, which would resurrect
 *  a card the user already dismissed. Keyed by (session, plan text). */
const settled = new Set<string>()

export function BotPlanCard({ messageText, streaming }: TranscriptDirectiveProps) {
  const view = useSessionView()
  const storedId = useValue(view.$storedId)
  const runtimeId = useValue(view.$runtimeId)
  const messages = useValue(view.$messages)
  // Subscribing the roster atom keeps the canonical gate honest across a
  // late roster fetch; the card never re-renders for a non-canonical chat.
  useValue($lastRoster)
  const t = useBots()

  const parsed = parseBotPlanReply(messageText)
  const identity = `${storedId}:${parsed.planText}`
  const sessionId = storedId ?? runtimeId
  const canonical = canonicalBotChatOnScreen(storedId)
  const ownMessage = messages.find(m => m.role === 'assistant' && chatMessageText(m) === messageText)

  const [dismissed, setDismissed] = useState(() => settled.has(identity))

  if (!canonical || !sessionId || !messageText) {
    return null
  }

  // Any visible user reply after this plan — typed, edited-and-sent, or the
  // approve turn itself — settles the card, same as `::ask`.
  const answeredInComposer = ownMessage ? answeredAfter(messages, ownMessage.id) : false
  const closed = dismissed || answeredInComposer

  const settle = () => {
    settled.add(identity)
    setDismissed(true)
  }

  const approve = () => {
    if (closed || streaming) {
      return
    }

    if (host.composer.submit(sessionId, buildPlanExecutePrompt(parsed.planText))) {
      settle()
    }
  }

  const edit = () => {
    if (closed || streaming) {
      return
    }

    void host.composer.setDraft(sessionId, parsed.planText).then(ok => {
      if (ok) {
        settle()
      }
    })
  }

  const buttonClass = (primary: boolean) =>
    cn(
      'shrink-0 rounded-full border px-3 py-1 text-left text-[12px] transition-colors',
      primary
        ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
        : 'border-border bg-card hover:border-primary/50 hover:bg-primary/10',
      (closed || streaming) && 'opacity-50'
    )

  return (
    <div className="my-2 flex min-w-0 max-w-full flex-col gap-2" data-bot-plan-card>
      <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
        <Codicon className="shrink-0 text-[0.8rem] text-(--ui-text-tertiary)" name="list-ordered" />
        <span className="truncate">{t.plan.proposedTitle}</span>
        {parsed.steps.length > 0 && (
          <span className="shrink-0 text-[11px] font-normal text-(--ui-text-quaternary)">
            {t.plan.stepsCount(parsed.steps.length)}
          </span>
        )}
      </div>
      {closed ? (
        <div className="text-[12px] text-(--ui-text-quaternary)">{t.plan.settledNote}</div>
      ) : (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <button className={buttonClass(true)} disabled={streaming} onClick={approve} type="button">
            {t.plan.approve}
          </button>
          <button className={buttonClass(false)} disabled={streaming} onClick={edit} type="button">
            {t.plan.edit}
          </button>
          <button className={buttonClass(false)} disabled={streaming} onClick={settle} type="button">
            {t.plan.dismiss}
          </button>
        </div>
      )}
    </div>
  )
}
