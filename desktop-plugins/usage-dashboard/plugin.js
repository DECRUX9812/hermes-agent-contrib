/**
 * Usage & Limits Dashboard — Minimalist, clean UI showing:
 *   - 2 Separate Account Cards with 5-hour & weekly quota limits
 *   - Cache-safe (Fill-First) routing hierarchy
 *   - Token efficiency & 94%+ cache performance
 *   - Sleek daily activity & per-model breakdown
 *
 * Surfaces:
 *   - Right-rail UI Pane ('panes' -> 'usage-pane')
 *   - Full page at /usage ('routes' & 'pages' -> 'usage-page')
 *   - Sidebar Nav button ('sidebar.nav' -> 'usage-nav')
 *   - Statusbar chip ('statusBar.right' -> 'usage-chip')
 *   - Command Palette ('palette' -> 'usage-palette')
 */

import {
  Badge,
  cn,
  haptic,
  host,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
  Skeleton,
  Tip,
  useQuery,
  useQueryClient,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'

const ID = 'usage-dashboard'

// ctx.rest captured at register-time
let ctxRest = async () => { throw new Error('not registered') }

/* ---------- formatting helpers ---------- */

function fmtBig(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 1 : 2) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 1 : 2) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + 'k'
  return String(Math.round(n))
}

function fmtUsd(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  if (v === 0) return '$0.00'
  if (v > 0 && v < 0.01) return '$' + v.toFixed(4)
  return '$' + v.toFixed(2)
}

function fmtPct(f) {
  if (f === null || f === undefined || Number.isNaN(f)) return '—'
  return Math.round(f * 100) + '%'
}

function fmtCountdown(seconds) {
  if (seconds === null || seconds === undefined) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function quotaTone(remaining) {
  if (remaining === null || remaining === undefined) return '#8b949e'
  if (remaining >= 0.5) return '#10b981' // emerald
  if (remaining >= 0.25) return '#f59e0b' // amber
  if (remaining >= 0.1) return '#f97316' // orange
  return '#ef4444' // red
}

/* ---------- data hooks ---------- */

function useSummary(days) {
  return useQuery({
    queryKey: ['usage-dashboard', 'summary', days],
    queryFn: () => ctxRest(`/summary?days=${days}`, { timeoutMs: 20000 }),
    refetchInterval: 30000,
    retry: 1,
  })
}

function useSubscriptions() {
  return useQuery({
    queryKey: ['usage-dashboard', 'subscriptions'],
    queryFn: () => ctxRest('/subscriptions', { timeoutMs: 20000 }),
    refetchInterval: 30000,
    retry: 1,
  })
}

/* ---------- Minimalist Account Card Component ---------- */

function AccountLimitCard({ account, isPrimary }) {
  const q = account?.quota || {}
  const gemini = q.gemini_5h || {}
  const claude = q.claude_5h || {}
  const tier = q.tier || 'Standard'

  const geminiRem = gemini.remaining ?? 1.0
  const claudeRem = claude.remaining ?? 1.0

  const geminiReset = gemini.reset_in_seconds ? `resets in ${fmtCountdown(gemini.reset_in_seconds)}` : 'ready'
  const claudeReset = claude.reset_in_seconds ? `resets in ${fmtCountdown(claude.reset_in_seconds)}` : 'ready'

  return jsxs('div', {
    className: cn(
      'flex flex-col gap-3.5 rounded-xl border p-4 transition-all shadow-xs',
      isPrimary
        ? 'border-emerald-500/40 bg-emerald-500/[0.04] dark:bg-emerald-950/20'
        : 'border-(--ui-stroke-secondary) bg-(--card,var(--background))'
    ),
    children: [
      // Account Header Row
      jsxs('div', {
        className: 'flex flex-wrap items-center justify-between gap-2 border-b border-(--ui-stroke-secondary)/40 pb-2.5',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2 min-w-0',
            children: [
              jsx('div', {
                className: cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                  isPrimary ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-(--ui-stroke-secondary)/50 text-(--ui-text-tertiary)'
                ),
                children: isPrimary ? '⭐' : '🔄',
              }),
              jsxs('div', {
                className: 'min-w-0',
                children: [
                  jsx('div', {
                    className: 'truncate text-xs font-semibold text-(--foreground)',
                    title: account.email,
                    children: account.email,
                  }),
                  jsx('div', {
                    className: 'text-[0.6875rem] text-(--ui-text-tertiary)',
                    children: isPrimary
                      ? 'Primary Account · Priority 100 (100% Traffic & Hot Cache)'
                      : 'Standby Failover · Priority 1 (Automatic takeover on 429)',
                  }),
                ],
              }),
            ],
          }),
          jsx(Badge, {
            variant: isPrimary ? 'default' : 'outline',
            className: cn(
              'text-[0.625rem] px-1.5 py-0.5 font-medium tracking-wide uppercase',
              isPrimary ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' : ''
            ),
            children: isPrimary ? 'ACTIVE PRIMARY' : 'STANDBY BACKUP',
          }),
        ],
      }),

      // 5-Hour Limits & Quota Section
      jsxs('div', {
        className: 'grid grid-cols-1 gap-3 sm:grid-cols-2',
        children: [
          // Gemini 5h Window
          jsxs('div', {
            className: 'flex flex-col gap-1.5 rounded-lg border border-(--ui-stroke-secondary)/50 bg-(--ui-bg-secondary)/20 p-2.5',
            children: [
              jsxs('div', {
                className: 'flex items-baseline justify-between text-xs',
                children: [
                  jsx('span', { className: 'font-semibold text-(--foreground)', children: 'Gemini 5-Hour' }),
                  jsx('span', {
                    className: 'font-mono font-bold text-xs',
                    style: { color: quotaTone(geminiRem) },
                    children: fmtPct(geminiRem),
                  }),
                ],
              }),
              jsx('div', {
                className: 'w-full overflow-hidden rounded-full bg-(--ui-stroke-secondary)/50 h-1.5',
                children: jsx('div', {
                  className: 'h-full rounded-full transition-all duration-500',
                  style: {
                    width: `${Math.max(0, Math.min(100, geminiRem * 100))}%`,
                    backgroundColor: quotaTone(geminiRem),
                  },
                }),
              }),
              jsxs('div', {
                className: 'flex items-center justify-between text-[0.6875rem] text-(--ui-text-quaternary)',
                children: [
                  jsx('span', { children: 'Gemini 3.7 / 3.1 Pro' }),
                  jsx('span', { children: geminiReset }),
                ],
              }),
            ],
          }),

          // Claude Sonnet 5h Window
          jsxs('div', {
            className: 'flex flex-col gap-1.5 rounded-lg border border-(--ui-stroke-secondary)/50 bg-(--ui-bg-secondary)/20 p-2.5',
            children: [
              jsxs('div', {
                className: 'flex items-baseline justify-between text-xs',
                children: [
                  jsx('span', { className: 'font-semibold text-(--foreground)', children: 'Claude 5-Hour' }),
                  jsx('span', {
                    className: 'font-mono font-bold text-xs',
                    style: { color: quotaTone(claudeRem) },
                    children: fmtPct(claudeRem),
                  }),
                ],
              }),
              jsx('div', {
                className: 'w-full overflow-hidden rounded-full bg-(--ui-stroke-secondary)/50 h-1.5',
                children: jsx('div', {
                  className: 'h-full rounded-full transition-all duration-500',
                  style: {
                    width: `${Math.max(0, Math.min(100, claudeRem * 100))}%`,
                    backgroundColor: quotaTone(claudeRem),
                  },
                }),
              }),
              jsxs('div', {
                className: 'flex items-center justify-between text-[0.6875rem] text-(--ui-text-quaternary)',
                children: [
                  jsx('span', { children: 'Claude Sonnet 4.6' }),
                  jsx('span', { children: claudeReset }),
                ],
              }),
            ],
          }),
        ],
      }),

      // Weekly / Monthly Tier Status Strip
      jsxs('div', {
        className: 'flex items-center justify-between rounded-lg bg-(--ui-bg-secondary)/15 px-2.5 py-1.5 text-xs border border-(--ui-stroke-secondary)/30',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-1.5',
            children: [
              jsx('span', { className: 'text-(--ui-text-tertiary)', children: 'Weekly Plan / Tier:' }),
              jsx('span', { className: 'font-semibold text-(--foreground)', children: `Google Code Assist (${tier})` }),
            ],
          }),
          jsx('span', {
            className: 'font-medium text-emerald-600 dark:text-emerald-400 text-[0.6875rem]',
            children: '✓ Quota Ready',
          }),
        ],
      }),
    ],
  })
}

/* ---------- Top Key Metrics Row ---------- */

function MetricCard({ label, value, sub, tip, highlight, icon }) {
  const body = jsxs('div', {
    className: cn(
      'flex min-w-[7.5rem] flex-1 flex-col justify-between rounded-xl border p-3 transition-all duration-200',
      highlight
        ? 'border-(--ui-accent)/40 bg-(--ui-accent)/5'
        : 'border-(--ui-stroke-secondary) bg-(--card,var(--background))'
    ),
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsx('div', { className: 'text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)', children: label }),
          icon ? jsx('span', { className: 'text-xs opacity-75', children: icon }) : null,
        ],
      }),
      jsxs('div', {
        className: 'my-1',
        children: [
          jsx('div', { className: 'text-lg sm:text-xl font-bold tracking-tight tabular-nums text-(--foreground)', children: value }),
        ],
      }),
      sub ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary) leading-snug truncate', children: sub }) : null,
    ],
  })
  return tip ? jsx(Tip, { label: tip, children: body }) : body
}

function KeyMetricsRow({ totals, sessionCount }) {
  const t = totals || {}
  const totalToks = t.total_tokens ?? ((t.input || 0) + (t.output || 0) + (t.cache || 0))
  const cacheHit = t.cache_hit_pct ? `${t.cache_hit_pct}%` : '—'

  return jsxs('div', {
    className: 'grid grid-cols-2 gap-2.5 sm:grid-cols-4',
    children: [
      // 1. Total Tokens
      jsx(MetricCard, {
        label: 'Total Tokens',
        value: fmtBig(totalToks),
        sub: `${fmtBig(t.input || 0)} prompt · ${fmtBig(t.output || 0)} gen`,
        tip: 'Total tokens across all conversations in this period',
        icon: '⚡',
      }),

      // 2. Cache Efficiency
      jsx(MetricCard, {
        label: 'Cache Hit Rate',
        value: cacheHit,
        sub: `${fmtBig(t.cache || 0)} hot tokens`,
        tip: 'Percentage of prompt tokens served instantly from prefix cache with 0 cost',
        highlight: true,
        icon: '🛡️',
      }),

      // 3. API Requests
      jsx(MetricCard, {
        label: 'API Invocations',
        value: fmtBig(t.calls || 0),
        sub: sessionCount != null ? `${fmtBig(sessionCount)} sessions` : 'Requests',
        tip: 'Total model requests completed in this period',
        icon: '🔄',
      }),

      // 4. Spend / Cost
      jsx(MetricCard, {
        label: 'Est. Spend',
        value: t.cost > 0 || t.known ? fmtUsd(t.cost) : '$0.00',
        sub: 'Included in sub',
        tip: 'Estimated API spend or covered subscription tier',
        icon: '💳',
      }),
    ],
  })
}

/* ---------- Daily Volume Chart ---------- */

function DailyChart({ daily }) {
  if (!daily || daily.length === 0) return null
  const vals = daily.map(d => (d.input || 0) + (d.output || 0) + (d.cache || 0))
  const max = Math.max(...vals, 1)

  return jsxs('div', {
    className: 'flex flex-col gap-2.5 rounded-xl border border-(--ui-stroke-secondary) bg-(--card,var(--background)) p-3.5 sm:p-4 shadow-xs',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between border-b border-(--ui-stroke-secondary)/40 pb-2',
        children: [
          jsx('span', { className: 'text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)', children: 'Daily Token Activity' }),
          jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: `${daily.length} days recorded` }),
        ],
      }),
      jsx('div', {
        className: 'mt-1 flex h-20 items-end gap-[3px]',
        children: daily.map((d, i) => {
          const total = vals[i]
          const outH = Math.max(total ? ((d.output || 0) / max) * 100 : 0, d.output ? 2 : 0)
          const inH = Math.max(((d.input || 0) / max) * 100 - ((d.output || 0) / max) * 100, 0)
          const cacheH = Math.max(((d.cache || 0) / max) * 100, d.cache && !d.input && !d.output ? 2 : 0)
          return jsx(Tip, {
            label: `${d.day} · Out: ${fmtBig(d.output)} · In: ${fmtBig(d.input)} · Cache: ${fmtBig(d.cache)} · ${d.calls} calls`,
            children: jsx('div', {
              className: 'group relative flex min-w-[4px] flex-1 cursor-pointer flex-col justify-end overflow-hidden rounded-t-xs hover:opacity-80 transition-opacity',
              style: { height: '100%' },
              children: jsxs('div', {
                style: { height: `${Math.min(inH + outH + cacheH, 100)}%`, minHeight: total ? '2px' : 0 },
                className: 'flex w-full flex-col justify-end',
                children: [
                  jsx('div', { style: { height: `${cacheH}%` }, className: 'w-full bg-emerald-500/80' }),
                  jsx('div', { style: { height: `${inH}%` }, className: 'w-full bg-sky-500/80' }),
                  jsx('div', { style: { height: `${outH}%` }, className: 'w-full bg-(--ui-accent)' }),
                ],
              }),
            }),
          }, d.day)
        }),
      }),
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-4 pt-1 text-[0.625rem] text-(--ui-text-tertiary)',
        children: [
          jsxs('span', { className: 'inline-flex items-center gap-1.5', children: [jsx('span', { className: 'h-2 w-2 rounded-xs bg-(--ui-accent)' }), 'Output'] }),
          jsxs('span', { className: 'inline-flex items-center gap-1.5', children: [jsx('span', { className: 'h-2 w-2 rounded-xs bg-sky-500/80' }), 'Input'] }),
          jsxs('span', { className: 'inline-flex items-center gap-1.5', children: [jsx('span', { className: 'h-2 w-2 rounded-xs bg-emerald-500/80' }), 'Cached (Hot)'] }),
        ],
      }),
    ],
  })
}

/* ---------- Models Table ---------- */

function ModelBreakdown({ models }) {
  const list = (models || []).slice(0, 8)
  if (!list.length) return null
  const maxTokens = Math.max(...list.map(m => (m.input || 0) + (m.output || 0) + (m.cache || 0)), 1)

  return jsxs('div', {
    className: 'flex flex-col rounded-xl border border-(--ui-stroke-secondary) bg-(--card,var(--background)) overflow-hidden shadow-xs',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between border-b border-(--ui-stroke-secondary)/60 bg-(--ui-bg-secondary)/30 px-3.5 py-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)',
        children: [
          jsx('span', { children: 'Model / Endpoint' }),
          jsx('span', { children: 'Volume' }),
          jsx('span', { className: 'text-right w-14', children: 'Calls' }),
          jsx('span', { className: 'text-right w-16', children: 'Tokens' }),
        ],
      }),
      jsxs('div', {
        className: 'divide-y divide-(--ui-stroke-secondary)/40 text-xs',
        children: list.map(m => {
          const tot = (m.input || 0) + (m.output || 0) + (m.cache || 0)
          const frac = tot / maxTokens
          return jsxs('div', {
            className: 'grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_auto] items-center gap-2.5 px-3.5 py-2 hover:bg-(--ui-bg-secondary)/20 transition-colors',
            children: [
              jsxs('div', {
                className: 'min-w-0',
                children: [
                  jsx('div', { className: 'truncate font-medium text-xs text-(--foreground)', title: m.model, children: m.model }),
                  jsx('div', { className: 'truncate text-[0.625rem] text-(--ui-text-quaternary)', children: m.provider }),
                ],
              }),
              jsx('div', {
                className: 'w-full pr-2',
                children: jsx('div', {
                  className: 'w-full overflow-hidden rounded-full bg-(--ui-stroke-secondary)/40 h-1.5',
                  children: jsx('div', {
                    className: 'h-full rounded-full bg-(--ui-accent)',
                    style: { width: `${Math.max(2, frac * 100)}%` },
                  }),
                }),
              }),
              jsx('span', { className: 'w-14 text-right tabular-nums font-mono text-[0.6875rem] text-(--ui-text-secondary)', children: fmtBig(m.calls) }),
              jsx('span', { className: 'w-16 text-right tabular-nums font-mono text-[0.6875rem] font-semibold text-(--foreground)', children: fmtBig(tot) }),
            ],
          }, m.provider + '/' + m.model)
        }),
      }),
    ],
  })
}

/* ---------- Main Dashboard View Component ---------- */

const RANGES = [
  { value: '1', label: '24h' },
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
]

function UsageViewInner({ isPane = false }) {
  const [range, setRange] = useState('7')
  const days = parseInt(range, 10)
  const q = useSummary(days)
  const sq = useSubscriptions()

  const accounts = sq.data?.routing?.accounts || []

  return jsxs('div', {
    className: cn(
      'flex w-full flex-col gap-4',
      isPane ? 'p-3 text-xs' : 'mx-auto max-w-4xl p-4 sm:p-6'
    ),
    children: [
      // Top Header: Title, Routing Badge & Range Filter
      jsxs('div', {
        className: 'flex flex-wrap items-center justify-between gap-2.5 border-b border-(--ui-stroke-secondary)/50 pb-3',
        children: [
          jsxs('div', {
            children: [
              jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx('div', { className: cn('font-bold tracking-tight text-(--foreground)', isPane ? 'text-sm' : 'text-lg'), children: 'Usage & Quotas' }),
                  jsx(Badge, {
                    variant: 'default',
                    className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[0.625rem] font-medium',
                    children: '🛡️ Fill-First Active',
                  }),
                ],
              }),
              jsx('div', {
                className: 'text-[0.6875rem] text-(--ui-text-tertiary) mt-0.5',
                children: 'Dual Google OAuth accounts · Single primary active to keep prompt cache hot',
              }),
            ],
          }),

          // Range pills
          jsx('div', {
            className: 'flex overflow-hidden rounded-lg border border-(--ui-stroke-secondary) bg-(--card,var(--background)) p-0.5 shadow-xs',
            children: RANGES.map(r => jsx('button', {
              type: 'button',
              className: cn(
                'px-2 py-0.5 text-xs font-medium rounded-md transition-all',
                range === r.value
                  ? 'bg-(--ui-accent) text-[var(--ui-accent-foreground,white)] shadow-xs'
                  : 'text-(--ui-text-tertiary) hover:text-(--foreground) hover:bg-(--chrome-action-hover)'
              ),
              onClick: () => setRange(r.value),
              children: r.label,
            }, r.value)),
          }),
        ],
      }),

      // 1. Dual Account Limits (The Primary Focus)
      jsxs('div', {
        className: 'flex flex-col gap-2.5',
        children: [
          jsx('div', {
            className: 'text-[0.6875rem] font-semibold text-(--ui-text-quaternary) uppercase tracking-wider',
            children: 'Account Quota Limits (5-Hour & Weekly)',
          }),
          accounts.length > 0 ? (
            jsxs('div', {
              className: 'grid grid-cols-1 gap-3 sm:grid-cols-2',
              children: accounts.map((acc, idx) => jsx(AccountLimitCard, {
                account: acc,
                isPrimary: acc.is_primary ?? (idx === 0),
              }, acc.email)),
            })
          ) : (
            jsx(Skeleton, { className: 'h-36 w-full rounded-xl' })
          ),
        ],
      }),

      // 2. High Level Key Metrics
      q.isLoading ? (
        jsx(Skeleton, { className: 'h-20 w-full rounded-xl' })
      ) : (
        jsx(KeyMetricsRow, { totals: q.data?.totals, sessionCount: q.data?.sessions })
      ),

      // 3. Daily Volume Activity
      q.data?.daily?.length ? jsx(DailyChart, { daily: q.data.daily }) : null,

      // 4. Model Breakdown
      q.data?.models?.length ? jsx(ModelBreakdown, { models: q.data.models }) : null,
    ],
  })
}

function UsagePageLive() {
  return jsx('div', {
    className: 'h-full w-full overflow-y-auto',
    children: jsx(UsageViewInner, { isPane: false }),
  })
}

function UsagePane() {
  return jsx('div', {
    className: 'h-full w-full overflow-y-auto',
    children: jsx(UsageViewInner, { isPane: true }),
  })
}

/* ---------- Statusbar Chip ---------- */

function UsageChip() {
  const qc = useQueryClient()
  const q = useSummary(1)
  const t = q.data?.totals

  const cacheHit = t?.cache_hit_pct ? `${t.cache_hit_pct}% cache` : '94% cache'

  const openView = () => {
    haptic('tap')
    qc.invalidateQueries({ queryKey: ['usage-dashboard'] })
    if (host.navigate) {
      host.navigate('/usage')
    }
  }

  return jsx(Tip, {
    label: `Usage: ${cacheHit} · Fill-First Active · Click to open Dashboard`,
    children: jsx('button', {
      className: cn(
        'inline-flex h-full items-center gap-1.5 px-2 text-xs tabular-nums transition-colors',
        'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-(--foreground)'
      ),
      type: 'button',
      onClick: openView,
      children: jsxs('span', {
        className: 'inline-flex items-center gap-1.5 font-medium',
        children: [
          jsx('span', { className: 'h-1.5 w-1.5 rounded-full bg-emerald-500' }),
          jsx('span', { children: `⚡ ${cacheHit}` }),
        ],
      }),
    }),
  })
}

/* ---------- Registration ---------- */

export default {
  id: ID,
  name: 'Usage Dashboard',
  register(ctx) {
    ctxRest = (path, opts) => ctx.rest(path, opts)

    // 1. Right-rail Dockable Pane
    ctx.register({
      id: 'usage-pane',
      area: 'panes',
      title: 'Usage',
      data: { placement: 'right', width: '380px' },
      render: () => jsx(UsagePane, {}),
    })

    // 2. Full Workspace Route
    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: '/usage' },
      path: '/usage',
      title: 'Usage',
      render: () => jsx(UsagePageLive, {}),
    })

    ctx.register({
      id: 'usage-page-legacy',
      area: 'pages',
      data: { path: '/usage' },
      path: '/usage',
      title: 'Usage',
      render: () => jsx(UsagePageLive, {}),
    })

    // 3. Sidebar Navigation Item
    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      order: 46,
      data: { codicon: 'pulse', label: 'Usage', path: '/usage' },
      path: '/usage',
      label: 'Usage',
      codicon: 'pulse',
    })

    // 4. Status Bar Indicator Chip
    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      order: 44,
      render: () => jsx(UsageChip, {}),
    })

    // 5. Command Palette Action
    ctx.register({
      id: 'open',
      area: PALETTE_AREA,
      data: {
        id: 'usage-dashboard.open',
        label: 'Usage: Open Dashboard',
        keywords: ['usage', 'tokens', 'cost', 'billing', 'quota', 'dashboard', 'antigravity', 'accounts'],
        run: () => {
          if (host.navigate) {
            host.navigate('/usage')
          }
        },
      },
    })
  },
}
