/**
 * TokenPulse — Real-time token usage tracker for Hermes desktop.
 *
 * A live dashboard that tracks token consumption across your AI sessions.
 * Features a status bar chip, detail pane with charts, sidebar navigation,
 * and command palette integration.
 */

import { cn, haptic, host, Tip, useValue, usePluginI18n, StatusDot, Separator, ScrollArea, Codicon, Button, Kbd, Badge } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useRef, useState, useEffect } from 'react'

const ID = 'tokenpulse'

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null || isNaN(n)) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(Math.round(n))
}

function extractUsage(usage) {
  if (!usage) return null
  const input = usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens ?? 0
  const output = usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens ?? 0
  const total = usage.totalTokens ?? usage.total_tokens ?? usage.tokens ?? (input + output)
  const cost = usage.cost ?? usage.costUsd ?? usage.cost_usd ?? 0
  const messages = usage.messages ?? usage.messageCount ?? usage.message_count ?? 0
  return { input, output, total, cost, messages }
}

// ─── Sparkline ─────────────────────────────────────────────────────────────

function Sparkline({ data, height = 48 }) {
  const width = 240
  if (!data || data.length < 2) {
    return jsx('div', {
      className: 'flex items-center justify-center text-xs text-(--ui-text-quaternary)',
      style: { height },
      children: 'Waiting for data…'
    })
  }

  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const stepX = width / (data.length - 1)
  const points = data.map((v, i) => [i * stepX, height - ((v - min) / range) * (height - 8) - 4])
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`

  const gridLines = [0.25, 0.5, 0.75].map(f => jsx('line', {
    key: f,
    x1: 0, y1: height * f, x2: width, y2: height * f,
    stroke: 'var(--ui-stroke-secondary)',
    strokeWidth: 0.5,
    strokeDasharray: '2,4',
  }))

  return jsx('svg', {
    width: '100%',
    height,
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    className: 'block',
    children: [
      jsx('g', { children: gridLines }),
      jsx('path', { d: areaPath, fill: 'var(--ui-accent)', opacity: 0.08 }),
      jsx('path', { d: linePath, fill: 'none', stroke: 'var(--ui-accent)', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    ]
  })
}

// ─── Bar Chart ─────────────────────────────────────────────────────────────

function BarChart({ data }) {
  if (!data || data.length === 0) {
    return jsx('div', {
      className: 'flex items-center justify-center text-xs text-(--ui-text-quaternary) h-16',
      children: 'Waiting for data…'
    })
  }
  const max = Math.max(...data.map(d => d.total), 1)
  return jsx('div', {
    className: 'flex items-end gap-0.5 h-16',
    children: data.map((d, i) => {
      const h = Math.max(2, (d.total / max) * 100)
      return jsx('div', {
        key: i,
        className: 'flex-1 rounded-t-sm bg-(--ui-accent) opacity-50 hover:opacity-100 transition-all duration-200 cursor-default',
        style: { height: `${h}%` },
        title: `${fmt(d.total)} tokens`
      })
    })
  })
}

// ─── Stat Card ─────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }) {
  return jsxs('div', {
    className: 'flex flex-col gap-0.5 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-2.5 transition-colors hover:border-(--ui-stroke-primary)',
    children: [
      jsx('span', { className: 'text-[0.625rem] font-medium text-(--ui-text-tertiary) uppercase tracking-wider', children: label }),
      jsx('span', { className: cn('text-base font-semibold tabular-nums', accent && 'text-(--ui-accent)'), children: value }),
    ]
  })
}

// ─── Main Pane ─────────────────────────────────────────────────────────────

function TokenPulsePane() {
  const t = usePluginI18n(ID)
  const focusedUsage = useValue(host.state.focusedUsage)
  const focusedSessionId = useValue(host.state.focusedSessionId)
  const model = useValue(host.state.model)
  const profile = useValue(host.state.profile)
  const busy = useValue(host.state.busy)

  const [history, setHistory] = useState([])
  const prevSessionIdRef = useRef(null)

  useEffect(() => {
    if (focusedSessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = focusedSessionId
      setHistory([])
    }
    const usage = extractUsage(focusedUsage)
    if (usage && usage.total > 0) {
      setHistory(prev => [...prev, { ...usage, ts: Date.now() }].slice(-30))
    }
  }, [focusedUsage, focusedSessionId])

  const usage = extractUsage(focusedUsage)
  const sparkData = history.map(h => h.total)
  const barData = history.slice(-15)

  return jsxs('div', {
    className: 'flex h-full flex-col gap-3 p-3 text-sm',
    children: [
      // Header
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('div', {
                className: cn('h-2 w-2 rounded-full transition-colors', busy ? 'bg-(--ui-accent) animate-pulse' : 'bg-(--ui-text-quaternary)'),
              }),
              jsx('span', { className: 'font-semibold', children: t('title') }),
            ]
          }),
          jsx('span', { className: 'text-xs text-(--ui-text-quaternary) truncate max-w-[120px]', children: model || '—' }),
        ]
      }),

      jsx(Separator, {}),

      // Stats grid
      jsxs('div', {
        className: 'grid grid-cols-2 gap-2',
        children: [
          jsx(StatCard, { label: t('input'), value: usage ? fmt(usage.input) : '—' }),
          jsx(StatCard, { label: t('output'), value: usage ? fmt(usage.output) : '—' }),
          jsx(StatCard, { label: t('total'), value: usage ? fmt(usage.total) : '—', accent: true }),
          jsx(StatCard, { label: t('cost'), value: usage && usage.cost ? `$${usage.cost.toFixed(4)}` : '—' }),
        ]
      }),

      // Sparkline
      jsxs('div', {
        className: 'flex flex-col gap-1.5',
        children: [
          jsx('span', { className: 'text-xs font-medium text-(--ui-text-tertiary)', children: t('flow') }),
          jsx('div', { className: 'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-2', children: jsx(Sparkline, { data: sparkData }) }),
        ]
      }),

      // Bar chart
      jsxs('div', {
        className: 'flex flex-col gap-1.5',
        children: [
          jsx('span', { className: 'text-xs font-medium text-(--ui-text-tertiary)', children: t('history') }),
          jsx('div', { className: 'rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-2', children: jsx(BarChart, { data: barData }) }),
        ]
      }),

      // Footer
      jsxs('div', {
        className: 'mt-auto flex items-center justify-between text-xs text-(--ui-text-quaternary)',
        children: [
          jsx('span', { children: profile ? `Profile: ${profile}` : '—' }),
          jsx('span', { children: usage && usage.messages ? `${usage.messages} msgs` : '' }),
        ]
      }),
    ]
  })
}

// ─── Status Bar Chip ───────────────────────────────────────────────────────

function TokenPulseChip() {
  const t = usePluginI18n(ID)
  const focusedUsage = useValue(host.state.focusedUsage)
  const usage = extractUsage(focusedUsage)

  return jsx(Tip, {
    label: t('chipTip'),
    children: jsx('button', {
      className: cn(
        'inline-flex h-full items-center gap-1.5 px-2 text-[0.6875rem] font-medium transition-colors',
        'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
      ),
      type: 'button',
      onClick: () => {
        haptic('tap')
        host.navigate('/tokenpulse')
      },
      children: [
        jsx('span', { className: 'h-1.5 w-1.5 rounded-full bg-(--ui-accent)' }),
        jsx('span', { className: 'tabular-nums', children: usage ? fmt(usage.total) : '0' }),
      ]
    })
  })
}

// ─── Plugin Export ─────────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'TokenPulse',
  register(ctx) {
    ctx.i18n.register({
      en: {
        title: 'TokenPulse',
        input: 'Input',
        output: 'Output',
        total: 'Total',
        cost: 'Cost',
        flow: 'Token Flow',
        history: 'Recent Usage',
        chipTip: 'TokenPulse — click to open',
        commandDesc: 'Show token usage',
      },
      ja: {
        title: 'TokenPulse',
        input: '入力',
        output: '出力',
        total: '合計',
        cost: 'コスト',
        flow: 'トークン流量',
        history: '最近の使用量',
        chipTip: 'TokenPulse — クリックで開く',
        commandDesc: 'トークン使用量を表示',
      }
    })

    // Detail pane (right sidebar)
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'TokenPulse',
      data: { placement: 'right', width: '280px' },
      render: () => jsx(TokenPulsePane, {})
    })

    // Status bar chip
    ctx.register({
      id: 'chip',
      area: 'statusBar.right',
      order: 130,
      render: () => jsx(TokenPulseChip, {})
    })

    // Sidebar navigation
    ctx.register({
      id: 'nav',
      area: 'sidebarNav',
      data: { path: '/tokenpulse', label: 'TokenPulse', codicon: 'pulse' },
    })

    // Command palette
    ctx.register({
      id: 'command',
      area: 'palette',
      data: { command: 'tokenpulse:show', title: 'TokenPulse: Show usage', description: 'Open the TokenPulse pane' },
    })
  }
}
