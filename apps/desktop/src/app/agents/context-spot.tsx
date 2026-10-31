import { useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { spotState, type ContextSpotView } from '@/orchestrator/panel'

/**
 * Homie Spot — the persistent context half of the workspace.
 *
 * It is always mountable and always says something: `error`, `empty` and
 * `ready` are three explicit states, so the pane can never show an unexplained
 * blank. Transient "what is it doing now" activity lives in the session list
 * below, never here (see `derivePanelRows`).
 */

export interface ContextSpotProps {
  error?: string | null
  onNewChat: () => void
  onSetObjective: (objective: string) => void
  spot: ContextSpotView | null
}

export function ContextSpot({ error, onNewChat, onSetObjective, spot }: ContextSpotProps) {
  const state = spotState(spot, error)
  const [draft, setDraft] = useState('')

  return (
    <section
      aria-label="Homie Spot context"
      className="shrink-0 border-b border-(--ui-stroke-quaternary) px-2 py-2"
      data-slot="homie-spot"
      data-state={state}
    >
      <header className="flex items-center gap-1.5 pb-1.5">
        <Codicon className="text-muted-foreground/70" name="sparkle" size="0.8125rem" />
        <span className="text-[0.6875rem] font-medium tracking-wide text-(--ui-text-secondary) uppercase">Homie Spot</span>
        {spot?.stale ? (
          <span
            className="rounded-full bg-amber-500/15 px-1.5 py-px text-[0.625rem] font-medium text-amber-600 dark:text-amber-400"
            title="The durable context is older than its TTL"
          >
            stale
          </span>
        ) : null}
        <span className="flex-1" />
        <Button
          aria-label="New chat"
          className="h-6 gap-1 px-1.5 text-[0.6875rem]"
          onClick={onNewChat}
          size="sm"
          variant="ghost"
        >
          <Codicon name="add" size="0.75rem" />
          New chat
        </Button>
      </header>

      {state === 'error' ? (
        <p className="px-1 py-2 text-xs leading-relaxed text-destructive/90" role="alert">
          Context unavailable — {error}. The workspace keeps working; promotion is paused until it reloads.
        </p>
      ) : null}

      {state === 'empty' ? (
        <div className="grid gap-1.5 px-1 py-1">
          <p className="text-xs leading-relaxed text-muted-foreground/80">
            No objective yet. Set one and this spot keeps it across visits instead of scrolling away with the transcript.
          </p>
          <form
            className="flex items-center gap-1"
            onSubmit={event => {
              event.preventDefault()
              if (draft.trim()) {
                onSetObjective(draft)
                setDraft('')
              }
            }}
          >
            <input
              aria-label="Orchestrator objective"
              className="h-6 min-w-0 flex-1 rounded border border-(--ui-stroke-tertiary) bg-transparent px-1.5 text-xs outline-none focus-visible:border-(--dt-ring)"
              onChange={event => setDraft(event.target.value)}
              placeholder="What should the orchestrator keep in mind?"
              value={draft}
            />
            <Button className="h-6 px-1.5 text-[0.6875rem]" size="sm" type="submit" variant="secondary">
              Set
            </Button>
          </form>
        </div>
      ) : null}

      {state === 'ready' && spot ? (
        <div className="grid gap-1.5 px-1">
          <p className="text-xs leading-relaxed text-(--ui-text-primary)" data-slot="spot-objective">
            {spot.objective || '—'}
          </p>

          {spot.constraints.length ? (
            <ul className="flex flex-wrap gap-1" aria-label="Constraints">
              {spot.constraints.map(c => (
                <li
                  className="rounded bg-(--ui-control-active-background) px-1.5 py-px text-[0.625rem] text-(--ui-text-secondary)"
                  key={c}
                >
                  {c}
                </li>
              ))}
              {spot.moreConstraints > 0 ? (
                <li className="px-1 py-px text-[0.625rem] text-muted-foreground/70">+{spot.moreConstraints}</li>
              ) : null}
            </ul>
          ) : null}

          <div className="flex items-center gap-3 text-[0.625rem] text-muted-foreground/80">
            <span className="inline-flex items-center gap-1">
              <Codicon name="hubot" size="0.6875rem" />
              {spot.activeCount} active
            </span>
            <span className={cn('inline-flex items-center gap-1', spot.moreDecisions > 0 && 'text-amber-600 dark:text-amber-400')}>
              <Codicon name="question" size="0.6875rem" />
              {spot.pendingDecisions.length + spot.moreDecisions} decisions
            </span>
            <span className="inline-flex items-center gap-1">
              <Codicon name="check" size="0.6875rem" />
              {spot.recentPromoted.length} promoted
            </span>
          </div>

          {spot.pendingDecisions.length ? (
            <ul className="grid gap-1" aria-label="Pending decisions">
              {spot.pendingDecisions.map(d => (
                <li className="rounded border border-(--ui-stroke-quaternary) px-1.5 py-1 text-[0.6875rem]" key={d.id}>
                  {d.question}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
