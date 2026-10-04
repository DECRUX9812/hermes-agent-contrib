/**
 * The live plan checklist (bot-mode B2) — a `composer.top` render
 * contribution pinned above the input of a canonical Bot Chat while an
 * approved plan is in flight.
 *
 * Read-only, transcript-derived: `deriveBotPlanState` rebuilds the whole state
 * from the messages atom on every render — the approved `::botplan` message,
 * the `Execute this plan` approval turn, and every `DONE: step N` line the
 * agent has emitted since. Nothing is persisted: a reload re-derives the same
 * checklist because the conversation IS the state. Dismiss is per-mount
 * (module set) and expires with the window — clearing is cosmetic, so it is
 * deliberately not durable.
 */

import { cn, Codicon, useSessionView, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { deriveBotPlanState } from './bot-plan'
import { canonicalBotChatOnScreen } from './bot-plan-card'
import { $lastRoster } from './data'
import { useBots } from './i18n'

/** Plans the user cleared from the banner, `${storedId}:${planMessageId}`.
 *  In-memory by design — see the file header. */
const dismissed = new Set<string>()

export function BotPlanChecklist() {
  const view = useSessionView()
  const storedId = useValue(view.$storedId)
  const messages = useValue(view.$messages)
  useValue($lastRoster)
  const t = useBots()
  const [, force] = useState(0)

  const plan = deriveBotPlanState(messages)

  if (!plan || !canonicalBotChatOnScreen(storedId) || dismissed.has(`${storedId}:${plan.planMessageId}`)) {
    return null
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border px-2 py-1.5',
        'border-[color-mix(in_srgb,var(--dt-composer-ring)_32%,transparent)] bg-accent/18'
      )}
      data-bot-plan-checklist
      role="status"
    >
      <div className="flex items-center gap-2">
        <Codicon className="shrink-0 text-[0.75rem] text-(--ui-text-tertiary)" name="checklist" />
        <span className="min-w-0 flex-1 truncate text-[0.7rem] font-medium text-muted-foreground/88">
          {t.plan.checklistTitle}
          {' · '}
          {plan.complete ? t.plan.complete : t.plan.stepsDone(plan.doneSteps.size, plan.steps.length)}
        </span>
        <button
          aria-label={t.plan.clearChecklist}
          className="flex shrink-0 cursor-pointer items-center text-[0.7rem] text-(--ui-text-quaternary) transition-colors hover:text-(--ui-text-secondary)"
          onClick={() => {
            dismissed.add(`${storedId}:${plan.planMessageId}`)
            force(tick => tick + 1)
          }}
          type="button"
        >
          <Codicon name="close" />
        </button>
      </div>
      <div className="max-h-24 overflow-y-auto">
        <ol className="flex flex-col gap-0.5">
          {plan.steps.map((step, index) => {
            const stepNumber = index + 1
            const done = plan.doneSteps.has(stepNumber)

            return (
              <li className="flex min-w-0 items-start gap-1.5 text-[0.7rem]" key={stepNumber}>
                <Codicon
                  className={cn(
                    'mt-px shrink-0 text-[0.65rem]',
                    done ? 'text-(--ui-accent-primary, var(--primary))' : 'text-(--ui-text-quaternary)'
                  )}
                  name={done ? 'check' : 'dash'}
                />
                <span
                  className={cn(
                    'min-w-0 wrap-anywhere',
                    done ? 'text-(--ui-text-quaternary) line-through' : 'text-(--ui-text-secondary)'
                  )}
                >
                  {stepNumber}. {step}
                </span>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
