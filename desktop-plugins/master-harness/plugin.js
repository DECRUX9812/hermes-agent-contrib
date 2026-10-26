// master-harness — desktop app plugin: Fleet pane + statusbar chip
// De-slopped per plugin-design-spec.md: semantic --ui-* tokens only (zero
// hardcoded hex), SDK formatters, StatusDot + status language, proper
// loading/empty/error states, tabular-nums on all data, reduced-motion-safe.
// Plain ESM, NO JSX. Imports ONLY from @hermes/plugin-sdk and react/jsx-runtime.
// NOTE: children MUST go inside the props object (children: ...), never as the
// 3rd argument — these are raw jsx-runtime functions where arg 3 is the KEY.
import { jsx, jsxs } from 'react/jsx-runtime'
import * as React from 'react'
import {
  cn,
  host,
  useQuery,
  useQueryClient,
  StatusDot,
  Badge,
  Separator,
  Skeleton,
  EmptyState,
  ErrorState,
  CopyButton,
  compactNumber,
  coarseElapsed,
  relativeTime,
  profileColor,
  profileColorSoft,
} from '@hermes/plugin-sdk'

const ID = 'master-harness'
const BASE = '/fleet' // ctx.rest relative namespace

let ctxRest = async () => { throw new Error('master-harness not registered') }

// ---- shared fetch (React Query only — no hand-rolled poll loops) ----
function useFleet() {
  return useQuery({
    queryKey: ['mh-fleet'],
    queryFn: () => ctxRest('/fleet').then(r => r?.data ?? r),
    refetchInterval: 15000,
    staleTime: 5000,
    placeholderData: (prev) => prev, // keep last-known data while refreshing
  })
}

function useTasks() {
  return useQuery({
    queryKey: ['mh-tasks'],
    queryFn: () => ctxRest('/tasks?limit=50').then(r => r?.data ?? r),
    refetchInterval: 10000,
    staleTime: 5000,
    placeholderData: (prev) => prev,
  })
}

function useLedger() {
  return useQuery({
    queryKey: ['mh-ledger'],
    queryFn: () => ctxRest('/ledger').then(r => r?.data ?? r),
    refetchInterval: 10000,
    staleTime: 5000,
    placeholderData: (prev) => prev,
  })
}

// ---- status tone mapping (semantic — no raw hex) ----
const STATUS_TONE = {
  running: 'active',
  queued: 'warning',
  done: 'success',
  failed: 'danger',
  blocked: 'warning',
  cancelled: 'muted',
}

const BUDGET_TONE = {
  ok: 'success',
  alert: 'warning',
  exhausted: 'danger',
}

// ---- statusbar chip ----
function Now({ render }) {
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return render(now)
}

function FleetChip() {
  const { data } = useTasks()
  const running = (data?.tasks || []).filter(t => t.status === 'running').length
  return jsx('div', {
    className: cn('flex items-center gap-1 text-xs text-(--ui-text-secondary)'),
    style: { padding: '0 6px' },
    children: jsxs('span', {
      className: 'flex items-center gap-1',
      children: [
        jsx(StatusDot, { tone: running > 0 ? 'active' : 'muted' }),
        jsx('span', { style: { fontWeight: 600 }, children: `${running}` }),
        jsx('span', { children: running === 1 ? 'running' : 'running' }),
      ],
    }),
  })
}

// ---- pane ----
function FleetPane() {
  const fleet = useFleet()
  const tasks = useTasks()
  const ledger = useLedger()
  const qc = useQueryClient()
  const workers = fleet.data?.workers || []
  const ledgerMap = ledger.data?.ledger || {}

  const err = fleet.error?.message || tasks.error?.message || ledger.error?.message
  const loading = fleet.isLoading || tasks.isLoading || ledger.isLoading
  const refreshing = fleet.isFetching || tasks.isFetching || ledger.isFetching

  const retryAll = () => {
    qc.invalidateQueries({ queryKey: ['mh-fleet'] })
    qc.invalidateQueries({ queryKey: ['mh-tasks'] })
    qc.invalidateQueries({ queryKey: ['mh-ledger'] })
  }

  return jsxs('div', {
    className: 'flex flex-col gap-3 p-3 overflow-y-auto h-full',
    children: [
      err
        ? jsx(ErrorState, {
            title: 'Fleet data unavailable',
            message: err,
            onRetry: retryAll,
          })
        : null,

      // BOTS · BUDGETS
      jsxs('div', {
        className: 'flex flex-col gap-1.5',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between',
            children: [
              jsx('div', {
                className: 'text-[11px] font-semibold uppercase tracking-wide text-(--ui-text-tertiary)',
                children: 'Bots · Budgets',
              }),
              refreshing
                ? jsx('div', { className: 'text-[11px] text-(--ui-text-quaternary)', children: 'refreshing…' })
                : null,
            ],
          }),
          loading && workers.length === 0
            ? jsxs('div', {
                className: 'flex flex-col gap-1.5',
                children: [
                  jsx(Skeleton, { className: 'h-14 w-full rounded-md' }),
                  jsx(Skeleton, { className: 'h-14 w-full rounded-md' }),
                  jsx(Skeleton, { className: 'h-14 w-full rounded-md' }),
                ],
              })
            : workers.length === 0
              ? jsx(EmptyState, {
                  title: 'No workers configured',
                  message: 'Add workers to fleet.yaml and the budget ledger will appear here.',
                })
              : jsx('div', {
                  className: 'flex flex-col gap-1.5',
                  children: workers.map(bot => {
                    const row = ledgerMap[bot] || {}
                    const frac = row.used_fraction || 0
                    const state = row.state || 'ok'
                    return jsxs('div', {
                      className: 'rounded-md border border-(--ui-stroke-secondary) p-2',
                      children: [
                        jsxs('div', {
                          className: 'flex items-center justify-between gap-2',
                          children: [
                            jsxs('div', {
                              className: 'flex items-center gap-1.5 min-w-0',
                              children: [
                                jsx('div', {
                                  className: 'h-2 w-2 rounded-full shrink-0',
                                  style: { backgroundColor: profileColor(bot) },
                                }),
                                jsx('span', {
                                  className: 'text-sm font-semibold text-(--ui-text-primary) truncate',
                                  children: bot,
                                }),
                              ],
                            }),
                            jsx(StatusDot, { tone: BUDGET_TONE[state] || 'muted' }),
                          ],
                        }),
                        jsxs('div', {
                          className: 'flex items-center justify-between mt-1',
                          children: [
                            jsx('span', {
                              className: 'text-[11px] tabular-nums text-(--ui-text-tertiary)',
                              children: `$${(row.spend || 0).toFixed(2)} / $${(row.monthly_usd || 0).toFixed(2)}`,
                            }),
                            row.credits > 0
                              ? jsx('span', {
                                  className: 'text-[11px] tabular-nums text-(--ui-accent)',
                                  children: `+$${(row.credits).toFixed(2)} credit`,
                                })
                              : null,
                          ],
                        }),
                        jsx('div', {
                          className: 'h-1 w-full overflow-hidden rounded-full bg-(--chrome-action-hover) mt-1',
                          children: [
                            jsx('div', {
                              className: 'h-full rounded-full transition-[width] duration-300',
                              style: {
                                width: Math.min(frac, 1) * 100 + '%',
                                backgroundColor: 'var(--ui-accent)',
                                opacity: 0.85,
                              },
                            }),
                          ],
                        }),
                      ],
                    })
                  }),
                }),
        ],
      }),

      jsx(Separator, { className: 'my-1' }),

      // TASKS
      jsxs('div', {
        className: 'flex flex-col gap-1.5',
        children: [
          jsx('div', {
            className: 'text-[11px] font-semibold uppercase tracking-wide text-(--ui-text-tertiary)',
            children: 'Tasks',
          }),
          loading && (tasks.data?.tasks || []).length === 0
            ? jsxs('div', {
                className: 'flex flex-col gap-1.5',
                children: [
                  jsx(Skeleton, { className: 'h-8 w-full rounded-md' }),
                  jsx(Skeleton, { className: 'h-8 w-full rounded-md' }),
                  jsx(Skeleton, { className: 'h-8 w-full rounded-md' }),
                ],
              })
            : (tasks.data?.tasks || []).length === 0
              ? jsx(EmptyState, {
                  title: 'No tasks yet',
                  message: 'Tasks appear here as bots pick up work.',
                })
              : jsx('div', {
                  className: 'flex flex-col gap-1 max-h-72 overflow-y-auto',
                  children: tasks.data.tasks.map(t => {
                    const tone = STATUS_TONE[t.status] || 'muted'
                    const elapsed = t.started_at ? coarseElapsed(new Date(t.started_at).getTime(), Date.now()) : null
                    return jsxs('div', {
                      className: 'flex items-center gap-2 rounded-md border border-(--ui-stroke-secondary) px-2 py-1.5 hover:bg-(--ui-row-hover-background) transition-colors',
                      children: [
                        jsx(StatusDot, { tone }),
                        jsx('span', {
                          className: 'text-[11px] font-medium text-(--ui-text-secondary) w-14 shrink-0 uppercase tracking-wide',
                          children: t.status,
                        }),
                        jsx('span', {
                          className: 'text-xs text-(--ui-text-secondary) font-mono shrink-0',
                          children: `#${t.id}`,
                        }),
                        jsx('span', {
                          className: 'text-xs text-(--ui-text-quaternary) flex-1 truncate',
                          children: t.prompt,
                        }),
                        elapsed
                          ? jsx('span', {
                              className: 'text-[11px] tabular-nums text-(--ui-text-quaternary) shrink-0',
                              children: elapsed,
                            })
                          : null,
                        jsx('span', {
                          className: 'text-[11px] tabular-nums text-(--ui-text-tertiary) shrink-0',
                          children: `$${(t.cost_usd || 0).toFixed(2)}`,
                        }),
                        jsx(CopyButton, { value: String(t.id), label: 'Copy task id' }),
                      ],
                    })
                  }),
                }),
        ],
      }),
    ],
  })
}

export default {
  id: ID,
  name: 'Master Harness',
  register(ctx) {
    ctxRest = (path, opts) => ctx.rest(path, opts)
    ctx.register({
      id: 'chip',
      area: 'statusBar.right',
      order: 300,
      render: () => jsx(Now, { render: () => jsx(FleetChip, {}) }),
    })
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'Fleet',
      data: { placement: 'right', width: '340px' },
      render: () => jsx(FleetPane, {}),
    })
  },
}
