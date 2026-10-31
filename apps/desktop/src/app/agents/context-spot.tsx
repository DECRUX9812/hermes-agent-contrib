import { useEffect, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { spotState, type ContextSpotView } from '@/orchestrator/panel'

/**
 * Homie Spot — the persistent context half of the workspace.
 *
 * Five explicit states — `loading`, `error`, `empty`, `ready` and a stale
 * marker on top of any of them — so the pane can never show an unexplained
 * blank or a frozen spinner. Transient "what is it doing now" activity lives
 * in the session list below, never here (see `derivePanelRows`).
 */

export interface ContextSpotProps {
  error?: string | null
  /** True while the context store is still loading — a real state, not a
   *  guessed "spot === null means loading" (null is also the empty state). */
  loading?: boolean
  onNewChat: () => void
  onSetObjective: (objective: string) => void
  /** Optional: retry after an error / refresh a stale context. */
  onRefresh?: () => void
  /** Optional: open the bot that is waiting on a decision. */
  onOpenDecision?: (decisionId: string) => void
  spot: ContextSpotView | null
}

export function ContextSpot({ error, loading = false, onNewChat, onSetObjective, onRefresh, onOpenDecision, spot }: ContextSpotProps) {
  const state = spotState(spot, error)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Entering edit focuses the field — one ambiguous step fewer.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const submit = () => {
    if (!draft.trim()) return
    onSetObjective(draft.trim())
    setDraft('')
    setEditing(false)
  }

  const showForm = state === 'empty' || editing
  const busy = Boolean(loading)

  return (
    <section
      aria-label="Homie Spot context"
      aria-busy={busy}
      className="shrink-0 border-b border-(--ui-stroke-quaternary) px-2 py-2"
      data-slot="homie-spot"
      data-state={state}
    >
      <header className="flex items-center gap-1.5 pb-1.5">
        <Codicon className="text-muted-foreground/70" name="sparkle" size="0.8125rem" />
        <span className="text-[0.6875rem] font-medium tracking-wide text-(--ui-text-secondary) uppercase">Homie Spot</span>
        {spot?.stale ? (
          <span
            aria-label="Stale context"
            className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-px text-[0.625rem] font-medium text-amber-600 dark:text-amber-400"
          >
            <Codicon name="warning" size="0.625rem" />
            stale
          </span>
        ) : null}
        <span className="flex-1" />
        {onRefresh ? (
          <Button
            aria-label="Refresh context"
            className="h-7 w-7 p-0"
            disabled={busy}
            onClick={onRefresh}
            size="sm"
            variant="ghost"
          >
            <Codicon name={busy ? 'loading' : 'refresh'} size="0.75rem" />
          </Button>
        ) : null}
        <Button
          aria-label="New chat"
          className="h-7 gap-1 px-2 text-[0.6875rem] font-medium"
          onClick={onNewChat}
          size="sm"
          variant="secondary"
        >
          <Codicon name="add" size="0.75rem" />
          New chat
        </Button>
      </header>

      {state === 'error' ? (
        <div className="mx-1 my-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-2" role="alert">
          <p className="text-xs leading-relaxed text-destructive/90">
            Context unavailable — {error}. The workspace keeps working; promotion is paused until it reloads.
          </p>
          {onRefresh ? (
            <Button className="mt-1.5 h-7 px-2 text-[0.6875rem]" onClick={onRefresh} size="sm" variant="secondary">
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}

      {busy && state !== 'error' ? (
        <div className="grid gap-1.5 px-1 py-1" data-slot="spot-loading">
          <div aria-hidden className="h-3 w-3/4 animate-pulse rounded bg-(--ui-control-active-background)" />
          <div aria-hidden className="h-3 w-1/2 animate-pulse rounded bg-(--ui-control-active-background)" />
        </div>
      ) : null}

      {!busy && state === 'empty' && !editing ? (
        <div className="grid gap-1.5 px-1 py-1">
          <p className="text-xs leading-relaxed text-muted-foreground/80">
            No objective yet. Set one and this spot keeps it across visits instead of scrolling away with the transcript.
          </p>
        </div>
      ) : null}

      {!busy && showForm ? (
        <form
          className="flex items-center gap-1.5 px-1 pb-1"
          onSubmit={event => {
            event.preventDefault()
            submit()
          }}
        >
          <input
            aria-label="Orchestrator objective"
            aria-invalid={false}
            className="h-7 min-w-0 flex-1 rounded-md border border-(--ui-stroke-tertiary) bg-transparent px-2 text-xs outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-(--dt-ring) focus-visible:ring-1 focus-visible:ring-(--dt-ring)"
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && editing) {
                setEditing(false)
                setDraft('')
              }
            }}
            placeholder={state === 'empty' ? 'What should the orchestrator keep in mind?' : spot?.objective || 'Objective'}
            ref={inputRef}
            value={draft}
          />
          <Button className="h-7 px-2 text-[0.6875rem]" disabled={!draft.trim()} size="sm" type="submit" variant="secondary">
            Set
          </Button>
          {editing ? (
            <Button
              aria-label="Cancel editing"
              className="h-7 px-2 text-[0.6875rem]"
              onClick={() => {
                setEditing(false)
                setDraft('')
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          ) : null}
        </form>
      ) : null}

      {!busy && state === 'ready' && spot && !editing ? (
        <div className="grid gap-1.5 px-1">
          <div className="group flex items-start gap-1">
            <p className="max-h-16 min-w-0 flex-1 overflow-hidden text-xs leading-relaxed text-(--ui-text-primary)" data-slot="spot-objective">
              {spot.objective || '—'}
            </p>
            <Button
              aria-label="Edit objective"
              className="h-6 w-6 shrink-0 p-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              onClick={() => {
                setDraft(spot.objective || '')
                setEditing(true)
              }}
              size="sm"
              variant="ghost"
            >
              <Codicon name="edit" size="0.6875rem" />
            </Button>
          </div>

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
            <span className={cn('inline-flex items-center gap-1', spot.pendingDecisions.length + spot.moreDecisions > 0 && 'text-amber-600 dark:text-amber-400')}>
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
                <li key={d.id}>
                  <button
                    className="flex w-full items-center gap-1.5 rounded-md border border-(--ui-icon-attention)/30 bg-(--ui-icon-attention)/5 px-1.5 py-1.5 text-left text-[0.6875rem] leading-snug transition-colors hover:bg-(--ui-icon-attention)/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--dt-ring)"
                    onClick={() => onOpenDecision?.(d.id)}
                    type="button"
                  >
                    <Codicon className="shrink-0 text-(--ui-icon-attention)" name="question" size="0.6875rem" />
                    <span className="min-w-0 flex-1">{d.question}</span>
                    {onOpenDecision ? <Codicon className="shrink-0 text-muted-foreground/60" name="arrow-right" size="0.6875rem" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
