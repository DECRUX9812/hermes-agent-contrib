/**
 * The rail's context panel, under the bot hero: how full the focused chat's
 * context window is, and a fold-out timeline of what ran in each turn.
 *
 * Both read data the gateway already serves — the streamed usage stats plus
 * `session.context_breakdown` for the gauge, `session.history` for the
 * timeline — so nothing here needs a core change. Only shown while the rail's
 * bot owns the focused chat; another bot's numbers would be misleading.
 */

import { Button, cn, Codicon, GlyphSpinner, host, Tip, useValue } from '@hermes/plugin-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'

import { type ContextPanelText, useContextPanelText } from './context-panel-i18n'
import {
  buildTrace,
  type ContextReading,
  contextReading,
  type ContextSource,
  contextTone,
  shortDuration,
  shortTokens,
  type TraceTurn
} from './context-panel-model'
import { requestForBot } from './routing'
import type { RosterRow } from './types'

const TONE_FILL = { calm: 'bg-(--ui-accent)', full: 'hbp-bg-danger', warm: 'hbp-bg-warn' } as const

export function ContextGauge({ reading, text }: { reading: ContextReading | null; text: ContextPanelText }) {
  const tone = contextTone(reading?.percent ?? 0)

  return (
    <div data-testid="rail-context-gauge" data-tone={reading ? tone : 'none'}>
      <div className="flex min-w-0 items-baseline gap-2 text-xs">
        <span className="truncate ui-section-label">{text.title}</span>
        <span className="ml-auto shrink-0 tabular-nums text-(--ui-text-tertiary)" data-testid="rail-context-reading">
          {reading ? text.reading(reading.percent, shortTokens(reading.used), shortTokens(reading.max)) : text.waiting}
        </span>
      </div>
      <div
        aria-label={text.meterLabel(reading?.percent ?? 0)}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={reading?.percent ?? 0}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-(--ui-bg-tertiary)"
        role="meter"
      >
        <div
          className={cn(
            'hbp-fill h-full rounded-full',
            TONE_FILL[tone]
          )}
          style={{ width: `${reading?.percent ?? 0}%` }}
        />
      </div>
    </div>
  )
}

function GaugeNotes({ reading, text }: { reading: ContextReading | null; text: ContextPanelText }) {
  if (!reading) {
    return null
  }

  return (
    <>
      {contextTone(reading.percent) !== 'calm' ? (
        <Tip label={text.nearlyFullHint}>
          <span className="hbp-enter hbp-fg-warn">{text.nearlyFull}</span>
        </Tip>
      ) : null}
      {reading.compressions > 0 ? (
        <Tip label={text.compactedHint}>
          <span className="hbp-enter">{text.compacted(reading.compressions)}</span>
        </Tip>
      ) : null}
      {reading.estimated ? (
        <Tip label={text.estimatedHint}>
          <span className="hbp-enter">{text.estimated}</span>
        </Tip>
      ) : null}
    </>
  )
}

function TurnRow({ live, open, onToggle, text, turn }: {
  live: boolean
  onToggle: () => void
  open: boolean
  text: ContextPanelText
  turn: TraceTurn
}) {
  return (
    <li data-testid="rail-trace-turn">
      <button
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-(--chrome-action-hover) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--ui-accent)"
        onClick={onToggle}
        type="button"
      >
        <Codicon
          className={cn('shrink-0 text-(--ui-text-quaternary) transition-transform', open && 'rotate-90')}
          name="chevron-right"
          size="0.75rem"
        />
        <span className="shrink-0 font-medium text-(--ui-text-secondary)">{text.turn(turn.index)}</span>
        <span className="min-w-0 flex-1 truncate text-(--ui-text-tertiary)">{turn.prompt}</span>
        <span className="shrink-0 tabular-nums text-(--ui-text-quaternary)">
          {[text.stepCount(turn.steps.length), turn.span === undefined ? '' : shortDuration(turn.span)]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>
      {open ? (
        <div className="hbp-enter mb-1 ml-3 border-l border-(--ui-stroke-secondary) pl-2.5">
          <ol className="flex flex-col">
            {turn.steps.map(step => (
              <li className="flex min-w-0 items-center gap-1.5 py-0.5 text-xs" data-testid="rail-trace-step" key={step.id}>
                <Codicon className="shrink-0 text-(--ui-text-tertiary)" name={step.icon} size="0.8rem" />
                <span className="shrink-0 text-(--ui-text-secondary)">{step.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-(--ui-text-quaternary)">{step.context}</span>
                {step.took === undefined ? null : (
                  <Tip label={text.tookHint}>
                    <span
                      className={cn(
                        'shrink-0 tabular-nums',
                        turn.steps.length > 1 && step === turn.slowest ? 'hbp-fg-warn' : 'text-(--ui-text-quaternary)'
                      )}
                    >
                      {shortDuration(step.took)}
                    </span>
                  </Tip>
                )}
              </li>
            ))}
            <li className="flex items-center gap-1.5 py-0.5 text-xs text-(--ui-text-tertiary)">
              {live ? (
                <GlyphSpinner className="shrink-0 text-(--ui-accent)" spinner="breathe" />
              ) : (
                <Codicon
                  className={turn.answered ? 'hbp-fg-ok' : 'text-(--ui-text-quaternary)'}
                  name={turn.answered ? 'check' : 'circle-slash'}
                  size="0.8rem"
                />
              )}
              <span>{live ? text.working : turn.answered ? text.answered : text.noAnswer}</span>
            </li>
          </ol>
          {turn.steps.length > 1 && turn.slowest?.took !== undefined ? (
            <p className="py-0.5 text-xs text-(--ui-text-quaternary)">
              {text.slowest(turn.slowest.name, shortDuration(turn.slowest.took))}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** Newest turn first and unfolded; the rest fold until asked. */
export function TraceList({ busy, text, turns }: { busy: boolean; text: ContextPanelText; turns: TraceTurn[] }) {
  const newest = turns.at(-1)?.id
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const shown = turns.slice(-30).reverse()
  const steps = turns.reduce((sum, turn) => sum + turn.steps.length, 0)

  if (!turns.length) {
    return <p className="px-1.5 py-1 text-xs text-(--ui-text-tertiary)">{text.none}</p>
  }

  return (
    <div data-testid="rail-trace-list">
      <p className="px-1.5 pb-1 text-xs text-(--ui-text-quaternary)">{text.overview(turns.length, steps)}</p>
      <ol className="flex flex-col">
        {shown.map(turn => {
          const open = folded[turn.id] ?? turn.id === newest

          return (
            <TurnRow
              key={turn.id}
              live={busy && turn.id === newest}
              onToggle={() => setFolded(state => ({ ...state, [turn.id]: !open }))}
              open={open}
              text={text}
              turn={turn}
            />
          )
        })}
      </ol>
    </div>
  )
}

type Load = { kind: 'error' } | { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; turns: TraceTurn[] }

const STEP_EVENTS = ['tool.complete', 'message.complete'] as const

/** `session.history` for the focused chat while the timeline is open: once on
 *  open, again as tools finish (debounced) and when the turn settles. */
function useTrace(bot: RosterRow, sessionId: string, enabled: boolean, busy: boolean) {
  const [load, setLoad] = useState<Load>({ kind: 'idle' })
  const seq = useRef(0)

  const fetchTrace = useCallback(
    async (quiet: boolean) => {
      const mine = ++seq.current

      if (!quiet) {
        setLoad({ kind: 'loading' })
      }

      try {
        const result = await requestForBot<{ messages?: unknown }>(bot, 'session.history', { session_id: sessionId })

        if (mine === seq.current) {
          setLoad({ kind: 'ready', turns: buildTrace(result?.messages) })
        }
      } catch {
        if (mine === seq.current && !quiet) {
          setLoad({ kind: 'error' })
        }
      }
    },
    [bot, sessionId]
  )

  useEffect(() => {
    if (enabled && sessionId) {
      void fetchTrace(false)
    }

    return () => {
      seq.current++
    }
  }, [enabled, fetchTrace, sessionId])

  // The turn settling is the one refresh that always matters.
  const wasBusy = useRef(busy)

  useEffect(() => {
    if (enabled && wasBusy.current && !busy) {
      void fetchTrace(true)
    }

    wasBusy.current = busy
  }, [busy, enabled, fetchTrace])

  useEffect(() => {
    if (!enabled || !sessionId || typeof host.onEvent !== 'function') {
      return
    }

    let timer: ReturnType<typeof setTimeout> | undefined

    const onStep = (event: { session_id?: string }) => {
      if (event?.session_id && event.session_id !== sessionId) {
        return
      }

      clearTimeout(timer)
      timer = setTimeout(() => void fetchTrace(true), 600)
    }

    const offs = STEP_EVENTS.map(type => host.onEvent(type, onStep))

    return () => {
      clearTimeout(timer)
      offs.forEach(off => off?.())
    }
  }, [enabled, fetchTrace, sessionId])

  return { load, retry: () => void fetchTrace(false) }
}

/** The breakdown the core status bar also reads; refetched per chat and each
 *  time a turn settles (a summary or a long reply moves it). */
function useBreakdown(bot: RosterRow, sessionId: string, busy: boolean): ContextSource | null {
  const [breakdown, setBreakdown] = useState<ContextSource | null>(null)

  useEffect(() => setBreakdown(null), [sessionId])

  useEffect(() => {
    let live = true

    if (!sessionId || busy) {
      return
    }

    requestForBot<ContextSource>(bot, 'session.context_breakdown', { session_id: sessionId })
      .then(result => live && setBreakdown(result && typeof result === 'object' ? result : null))
      .catch(() => undefined)

    return () => {
      live = false
    }
  }, [bot, busy, sessionId])

  return breakdown
}

export function ContextPanel({ bot }: { bot: RosterRow }) {
  const text = useContextPanelText()
  const sessionId = useValue(host.state.focusedSessionId) ?? ''
  const usage = useValue(host.state.focusedUsage) as ContextSource | null
  const busy = useValue(host.state.busy) === true
  const breakdown = useBreakdown(bot, sessionId, busy)
  const [open, setOpen] = useState(false)
  const { load, retry } = useTrace(bot, sessionId, open, busy)
  const reading = contextReading(breakdown, usage)

  if (!sessionId) {
    return null
  }

  return (
    <section className="px-4 pb-3" data-testid="rail-context">
      <ContextGauge reading={reading} text={text} />
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-(--ui-text-quaternary)">
        <GaugeNotes reading={reading} text={text} />
        <Tip label={open ? text.hideSteps : text.showSteps}>
          <Button
            aria-controls="rail-trace"
            aria-expanded={open}
            className="-mr-1.5 ml-auto"
            data-testid="rail-trace-toggle"
            onClick={() => setOpen(value => !value)}
            size="xs"
            variant="ghost"
          >
            <Codicon name="list-tree" />
            {text.steps}
            <Codicon
              className={cn('transition-transform', open && 'rotate-180')}
              name="chevron-down"
            />
          </Button>
        </Tip>
      </div>
      <div
        aria-hidden={!open}
        className="hbp-fold"
        data-state={open ? 'open' : 'closed'}
        id="rail-trace"
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-1 max-h-80 overflow-y-auto overscroll-contain rounded-md bg-(--ui-inline-code-background) p-1.5">
            {load.kind === 'ready' ? (
              <TraceList busy={busy} text={text} turns={load.turns} />
            ) : load.kind === 'error' ? (
              <p className="flex items-center gap-2 px-1.5 py-1 text-xs text-(--ui-text-tertiary)">
                {text.failed}
                <Button onClick={retry} size="xs" variant="ghost">
                  {text.retry}
                </Button>
              </p>
            ) : (
              <p className="flex items-center gap-1.5 px-1.5 py-1 text-xs text-(--ui-text-tertiary)">
                <GlyphSpinner className="text-(--ui-accent)" spinner="breathe" />
                {text.loading}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
