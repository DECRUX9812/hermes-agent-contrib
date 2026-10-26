/**
 * Handflow — desktop half.
 *
 * A dockable right-rail pane that shows the plan the agent is working through,
 * the same steps and notes the `handflow` tool writes, refreshed every few
 * seconds, plus a status-bar chip with the progress count.
 *
 * Design notes (this is the "skin"):
 *   - theme variables only (`--ui-*`, `--foreground`), so the pane reskins with
 *     every Hermes theme instead of shipping its own palette;
 *   - one visual idea per state: dim strikethrough = done, accent = the step in
 *     progress, amber = blocked, faint = not started;
 *   - the plan is the hero, chrome is a single row of counts;
 *   - unloaded, uncompiled ESM: jsx()/jsxs() calls, no JSX syntax, and imports
 *     limited to @hermes/plugin-sdk, react and react/jsx-runtime.
 */

import {
  cn,
  host,
  STATUSBAR_AREAS,
  useQuery,
  useQueryClient,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'

const ID = 'handflow'

// ctx.rest captured at register-time.
let ctxRest = async () => {
  throw new Error('handflow: not registered')
}

const MARKS = {
  completed: '[✓]',
  in_progress: '[→]',
  blocked: '[!]',
  not_started: '[ ]',
}

const MARK_TONE = {
  completed: 'text-(--ui-text-quaternary)',
  in_progress: 'text-(--ui-accent)',
  blocked: 'text-amber-500 dark:text-amber-400',
  not_started: 'text-(--ui-text-tertiary)',
}

/* ---------------- helpers ---------------- */

function ago(iso) {
  const ts = Date.parse(iso || '')
  if (Number.isNaN(ts)) return ''
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function tone(step) {
  return MARK_TONE[step?.status] || MARK_TONE.not_started
}

function label(step) {
  if (!step) return '—'
  if (step.status === 'completed') return 'reopen'
  if (step.status === 'in_progress') return 'complete'
  return 'start'
}

function op(step) {
  if (step?.status === 'completed') return 'reopen'
  if (step?.status === 'in_progress') return 'complete'
  return 'begin'
}

function useActive() {
  return useQuery({
    queryKey: [ID, 'active'],
    queryFn: () => ctxRest('/active', { timeoutMs: 8000 }),
    refetchInterval: 3000,
    retry: 1,
  })
}

/* ---------------- pieces ---------------- */

function Progress({ counts }) {
  const total = counts?.total || 0
  const done = counts?.done || 0
  const pct = total ? Math.round((done / total) * 100) : 0
  return jsxs('div', {
    className: 'flex items-center gap-2.5',
    children: [
      jsx('div', {
        className: 'h-1 flex-1 overflow-hidden rounded-full bg-(--ui-stroke-secondary)/60',
        children: jsx('div', {
          className: 'h-full rounded-full bg-(--ui-accent) transition-all duration-500',
          style: { width: `${pct}%` },
        }),
      }),
      jsx('span', {
        className: 'font-mono text-[0.6875rem] tabular-nums text-(--ui-text-tertiary)',
        children: `${done}/${total}`,
      }),
    ],
  })
}

function StepRow({ planId, step, index, isCurrent, onPatched }) {
  const isDone = step.status === 'completed'
  const isBlocked = step.status === 'blocked'
  const notes = Array.isArray(step.notes) ? step.notes : []
  return jsxs('div', {
    className: cn(
      'group flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors',
      isCurrent ? 'bg-(--ui-accent)/[0.07]' : 'hover:bg-(--ui-stroke-secondary)/25',
    ),
    children: [
      jsx('button', {
        type: 'button',
        title: label(step),
        onClick: () => onPatched(planId, step.id, op(step)),
        className: cn('mt-px shrink-0 font-mono text-[0.6875rem] leading-4', tone(step)),
        children: MARKS[step.status] || MARKS.not_started,
      }),
      jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsxs('div', {
            className: 'flex items-baseline gap-1.5',
            children: [
              jsx('span', {
                className: 'font-mono text-[0.625rem] text-(--ui-text-quaternary)',
                children: String(index).padStart(2, '0'),
              }),
              jsx('span', {
                className: cn(
                  'min-w-0 flex-1 text-xs leading-4',
                  isDone
                    ? 'text-(--ui-text-quaternary) line-through decoration-(--ui-stroke-secondary)'
                    : isCurrent
                      ? 'font-medium text-(--foreground)'
                      : 'text-(--ui-text-secondary)',
                ),
                children: step.title,
              }),
            ],
          }),
          isCurrent && notes.length
            ? jsx('div', {
                className: 'mt-0.5 truncate font-mono text-[0.625rem] text-(--ui-text-quaternary)',
                title: notes.join(' · '),
                children: `note: ${notes[notes.length - 1]}`,
              })
            : null,
        ],
      }),
      isBlocked
        ? jsx('button', {
            type: 'button',
            title: 'back to start',
            onClick: () => onPatched(planId, step.id, 'reopen'),
            className: 'shrink-0 font-mono text-[0.625rem] text-(--ui-text-quaternary) opacity-0 group-hover:opacity-100',
            children: '↺',
          })
        : jsx('button', {
            type: 'button',
            title: 'mark blocked',
            onClick: () => onPatched(planId, step.id, 'block'),
            className: 'shrink-0 font-mono text-[0.625rem] text-(--ui-text-quaternary) opacity-0 group-hover:opacity-100',
            children: '!',
          }),
    ],
  })
}

function Empty({ error }) {
  return jsxs('div', {
    className: 'flex flex-col gap-2 px-2 py-6 text-center',
    children: [
      jsx('div', { className: 'font-mono text-[0.6875rem] tracking-widest text-(--ui-text-quaternary)', children: 'NO ACTIVE PLAN' }),
      jsx('div', {
        className: 'text-xs leading-5 text-(--ui-text-tertiary)',
        children: error
          ? 'Handflow backend unreachable — enable the plugin in Capabilities → Plugins.'
          : 'Ask the agent to plan the task (it calls handflow with goal + steps) and the steps appear here as it works.',
      }),
    ],
  })
}

function PlanPane() {
  const qc = useQueryClient()
  const { data, isError, error } = useActive()
  const [busy, setBusy] = useState(false)

  const plan = data?.plan || null

  async function onPatched(planId, stepId, action) {
    setBusy(true)
    try {
      await ctxRest(`/plans/${planId}/steps/${stepId}`, { method: 'POST', body: { op: action }, timeoutMs: 8000 })
    } catch (err) {
      if (host && host.notify) {
        host.notify({ kind: 'error', message: 'Handflow: could not update that step', detail: String(err) })
      }
    } finally {
      setBusy(false)
      qc.invalidateQueries({ queryKey: [ID, 'active'] })
    }
  }

  if (!plan) {
    return jsx('div', { className: 'flex h-full flex-col overflow-auto p-2', children: jsx(Empty, { error: isError }) })
  }

  const counts = data.counts || { done: 0, total: (plan.steps || []).length }
  const steps = plan.steps || []
  const currentId = data.current_step_id

  return jsxs('div', {
    className: 'flex h-full flex-col gap-2 overflow-auto p-2',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-2 px-1',
        children: [
          jsx('span', {
            className: 'font-mono text-[0.625rem] tracking-[0.18em] text-(--ui-text-quaternary)',
            children: 'HAND FLOW',
          }),
          jsxs('span', {
            className: 'flex items-center gap-2',
            children: [
              counts.blocked
                ? jsx('span', { className: 'font-mono text-[0.625rem] text-amber-500 dark:text-amber-400', children: `${counts.blocked} blocked` })
                : null,
              jsx('span', {
                className: cn(
                  'rounded-full border px-1.5 py-px font-mono text-[0.5625rem] uppercase tracking-wider',
                  plan.status === 'active'
                    ? 'border-(--ui-accent)/40 text-(--ui-accent)'
                    : 'border-(--ui-stroke-secondary) text-(--ui-text-quaternary)',
                ),
                children: plan.status,
              }),
            ],
          }),
        ],
      }),
      jsx('div', {
        className: 'px-1 text-xs font-medium leading-5 text-(--foreground)',
        children: plan.goal,
      }),
      jsx('div', { className: 'px-1', children: jsx(Progress, { counts }) }),
      jsx('div', {
        className: 'flex flex-col gap-px border-t border-(--ui-stroke-secondary)/50 pt-1.5',
        children: steps.map((step, i) =>
          jsx(
            StepRow,
            {
              planId: plan.id,
              step,
              index: i + 1,
              isCurrent: step.id === currentId,
              onPatched,
            },
            step.id || String(i),
          ),
        ),
      }),
      jsxs('div', {
        className: 'mt-auto flex items-center justify-between gap-2 border-t border-(--ui-stroke-secondary)/50 px-1 pt-1.5 font-mono text-[0.5625rem] text-(--ui-text-quaternary)',
        children: [
          jsx('span', { className: 'truncate', title: plan.id, children: plan.id }),
          jsx('span', { children: busy ? 'syncing…' : ago(plan.updated_at) }),
        ],
      }),
    ],
  })
}

function Chip() {
  const { data } = useActive()
  const counts = data?.counts
  const total = counts?.total || 0
  const done = counts?.done || 0
  return jsx('span', {
    className: 'flex items-center gap-1.5 px-1.5 font-mono text-[0.6875rem] text-(--ui-text-tertiary)',
    title: total ? `Handflow: ${done}/${total} steps complete` : 'Handflow: no active plan',
    children: total ? `▤ ${done}/${total}${counts.blocked ? ` ·${counts.blocked}!` : ''}` : '▤ —',
  })
}

/* ---------------- registration ---------------- */

export default {
  id: ID,
  name: 'Handflow',
  register(ctx) {
    ctxRest = (path, opts) => ctx.rest(path, opts)

    ctx.register({
      id: 'plan-pane',
      area: 'panes',
      title: 'Plan',
      data: { placement: 'right', width: '330px' },
      render: () => jsx(PlanPane, {}),
    })

    ctx.register({
      id: 'progress-chip',
      area: STATUSBAR_AREAS.right,
      order: 43,
      render: () => jsx(Chip, {}),
    })
  },
}
