/**
 * Jev HUD — the Jev decision meter.
 *
 * Jev (the oracle / second-mind head) decides behind the scenes all day: which engine,
 * whether to ship, what to do when a build fails, whether a trade is worth taking. Every
 * decision is appended to a JSONL ledger and then forgotten. This plugin makes it visible:
 *
 *   - Right-rail pane  ('panes'          → 'hud-pane', placement right, 300px)
 *   - Status-bar chip  (statusBar.right  → 'hud-chip', "jev 12 today")
 *   - Palette command  (PALETTE_AREA     → 'jev-hud.refresh')
 *
 * Every number on screen comes from GET /api/plugins/jev-hud/{recent,summary} through
 * `ctx.rest` — captured at register-time, called only from components and handlers. When the
 * backend half is not mounted the pane says so instead of inventing a ledger, and a field the
 * ledger does not carry (confidence, verdict, timestamp) renders as an explicit unknown.
 */
import { PALETTE_AREA, STATUSBAR_AREAS, host, queryClient, useQuery, useQueryClient } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'

const ID = 'jev-hud'
const PANE_ID = 'hud-pane'
const CHIP_ID = 'hud-chip'
const SCOPED_PANE_ID = 'jev-hud:hud-pane'
const REFRESH_MS = 10000
const RECENT_LIMIT = 50
const BACKEND_PATH = '/api/plugins/jev-hud'
const NOT_MOUNTED = 'backend not mounted yet — restart the Hermes backend to mount ' + BACKEND_PATH

/* ------------------------------------------------------------------ backend door */

// ctx.rest is captured at register-time. Calling it at import time (module scope) is the
// classic plugin bug: the context does not exist yet. Everything below calls `rest()`, and
// only from components / handlers, which run after register().
let ctxRest = null

function rest(path, opts) {
  if (!ctxRest) {
    return Promise.reject(new Error('jev-hud: register() has not run yet'))
  }
  return ctxRest(path, opts)
}

/** Poll while the pane is on screen; a hidden pane stops polling (feature-detected). */
function refetchInterval() {
  try {
    if (typeof host.paneVisibility !== 'function') return REFRESH_MS
    const visible = host.paneVisibility(SCOPED_PANE_ID)
    return () => (visible && typeof visible.get === 'function' && visible.get() === false ? false : REFRESH_MS)
  } catch (_err) {
    return REFRESH_MS
  }
}

/* ------------------------------------------------------------------ pure helpers
 * No SDK identifiers in this block: these are the functions the vm-harness tests call
 * directly, and the harness strips the SDK import.
 */

const UNKNOWN = '—'

/** 0.6532 → '65%'. A missing confidence is '—', never a number we made up. */
function pct(value) {
  if (typeof value !== 'number' || !isFinite(value)) return UNKNOWN
  return Math.round(value * 100) + '%'
}

function ageSeconds(ts, nowMs) {
  if (typeof ts !== 'number' || !isFinite(ts)) return null
  const now = typeof nowMs === 'number' ? nowMs : Date.now()
  return Math.max(0, now / 1000 - ts)
}

/** Compact age: '12s' / '4m' / '2h' / '3d'. Undated rows say so. */
function fmtAge(ts, nowMs) {
  const seconds = ageSeconds(ts, nowMs)
  if (seconds === null) return UNKNOWN
  if (seconds < 60) return Math.floor(seconds) + 's'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm'
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h'
  return Math.floor(seconds / 86400) + 'd'
}

const STOPPING = ['no', 'skip', 'stop', 'wait', 'hold', 'abort', 'roll back', 'rollback', 'deny', 'blocked', 'stop_and_report']
const GOING = ['yes', 'go', 'ship', 'take', 'take_small', 'proceed', 'proceed_conservative', 'merge_now', 'approve', 'allow']

/** Colour by meaning, from the app's own palette classes — never a hex. */
function verdictTone(verdict) {
  const text = String(verdict || '').toLowerCase()
  if (!text) return 'text-[var(--muted-foreground)]'
  if (text === 'handoff' || text.indexOf('ask_user') === 0) return 'text-amber-500'
  if (STOPPING.indexOf(text) !== -1) return 'text-rose-500'
  if (GOING.indexOf(text) !== -1) return 'text-emerald-500'
  return 'text-[var(--foreground)]'
}

function shortVerdict(verdict, max) {
  const limit = typeof max === 'number' ? max : 38
  const text = String(verdict === null || verdict === undefined ? '' : verdict).trim()
  if (!text) return 'no verdict recorded'
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text
}

/**
 * Tell "the backend is not mounted" apart from "the backend answered badly", so the pane can
 * say which one it is. A rejected ctx.rest carries a status on some builds and only a message
 * on others — check both.
 */
function classifyRestError(err) {
  const status = err && (err.status || err.statusCode || (err.response && err.response.status))
  const detail = String((err && (err.message || err.error)) || err || '').trim()
  const notMounted =
    status === 404 || /(^|\D)404(\D|$)/.test(detail) || /not found|not mounted|no route|404/i.test(detail)
  return { kind: notMounted ? 'not_mounted' : 'error', detail: detail || 'no detail from the bridge' }
}

/** 'ok' | 'empty' | 'malformed' — what the pane is allowed to render from this payload. */
function classifyPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { state: 'malformed', rows: [], notes: [] }
  }
  const rows = Array.isArray(data.rows) ? data.rows : []
  const notes = Array.isArray(data.notes) ? data.notes : []
  if (data.ok === false) return { state: 'malformed', rows: rows, notes: notes }
  return { state: rows.length ? 'ok' : 'empty', rows: rows, notes: notes }
}

function fmtNumber(value, digits) {
  if (typeof value !== 'number' || !isFinite(value)) return UNKNOWN
  return value.toFixed(typeof digits === 'number' ? digits : 0)
}

function fmtExtraValue(value) {
  if (Array.isArray(value)) return value.join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** 'oracle 40 · trading 4' — only the sources the ledger actually reported. */
function sourceLine(bySource) {
  if (!bySource || typeof bySource !== 'object') return ''
  return Object.keys(bySource)
    .map((key) => key + ' ' + bySource[key])
    .join(' · ')
}

/** 'no 5 · wait 4 · handoff 10', the longest buckets first, capped for a 300px pane. */
function verdictLine(byVerdict, max) {
  if (!byVerdict || typeof byVerdict !== 'object') return ''
  const limit = typeof max === 'number' ? max : 4
  // A verdict can be a whole sentence ("This needs a human decision; ask the user directly.")
  // — the header is 300px wide, so keys are shortened the same way rows are.
  const pairs = Object.keys(byVerdict).map((key) => [shortVerdict(key, 20), byVerdict[key]])
  pairs.sort((a, b) => b[1] - a[1])
  const head = pairs.slice(0, limit).map((pair) => pair[0] + ' ' + pair[1])
  return head.join(' · ') + (pairs.length > limit ? ' · +' + (pairs.length - limit) + ' more' : '')
}

/* ------------------------------------------------------------------ pane */

function HudSummary({ summary, recent, nowMs, fetching, onRefresh }) {
  const counts = (summary && summary.today_counts) || null
  const last = summary && summary.last_seen ? summary.last_seen : null
  const scored = summary && typeof summary.mean_confidence_today_n === 'number' ? summary.mean_confidence_today_n : null
  const mean = summary && typeof summary.mean_confidence_today === 'number' ? summary.mean_confidence_today : null
  const notes = []
    .concat(summary && Array.isArray(summary.notes) ? summary.notes : [])
    .concat(recent && Array.isArray(recent.notes) ? recent.notes : [])

  return jsxs('div', {
    className: 'space-y-1 rounded-lg border border-[var(--border)] p-2',
    children: [
      jsxs('div', {
        className: 'flex items-baseline gap-1.5',
        children: [
          jsx('span', {
            className: 'text-[19px] font-semibold tabular-nums text-[var(--foreground)]',
            children: counts && typeof counts.count === 'number' ? String(counts.count) : UNKNOWN,
          }),
          jsx('span', { className: 'text-[10.5px] text-[var(--muted-foreground)]', children: 'today' }),
          jsx('span', { className: 'ml-auto text-[10px] tabular-nums text-[var(--muted-foreground)]', children: 'last ' + fmtAge(last && last.ts, nowMs) }),
        ],
      }),
      jsx('div', { className: 'text-[10.5px] text-[var(--muted-foreground)]', children: sourceLine(counts && counts.by_source) || 'no ledger rows read' }),
      jsx('div', {
        className: 'text-[10.5px] text-[var(--muted-foreground)]',
        children: verdictLine(counts && counts.by_verdict) || 'no verdicts today',
      }),
      jsx('div', {
        className: 'text-[10.5px] text-[var(--muted-foreground)]',
        children:
          mean === null
            ? 'mean confidence ' + UNKNOWN + (scored ? ' (' + scored + ' scored)' : '')
            : 'mean confidence ' + pct(mean) + ' (' + scored + ' of ' + (counts ? counts.count : UNKNOWN) + ' scored)',
      }),
      jsxs('div', {
        className: 'flex items-center gap-2 pt-0.5',
        children: [
          jsx('button', {
            type: 'button',
            className: 'rounded border border-[var(--border)] px-2 py-[3px] text-[10px] text-[var(--foreground)] hover:border-[var(--foreground)]/40',
            onClick: onRefresh,
            children: fetching ? 'refreshing…' : 'refresh',
          }),
          jsx('span', { className: 'text-[10px] text-[var(--muted-foreground)]', children: 'auto 10s while visible' }),
        ],
      }),
      notes.length
        ? jsx('div', {
            className: 'pt-0.5 text-[10px] italic text-[var(--muted-foreground)]',
            children: notes.slice(0, 3).join(' · '),
          })
        : null,
    ],
  })
}

function DecisionDetail({ row }) {
  const probabilities = row && row.probabilities && typeof row.probabilities === 'object' ? Object.keys(row.probabilities) : []
  const extra = row && row.extra && typeof row.extra === 'object' ? Object.keys(row.extra) : []
  const meta = []
  if (row && row.model) meta.push(row.model)
  if (row && typeof row.ms === 'number') meta.push(fmtNumber(row.ms) + 'ms')
  if (row && typeof row.cost_usd === 'number') meta.push('$' + fmtNumber(row.cost_usd, 6))
  if (row && row.cached) meta.push('cached')
  if (row && row.decider) meta.push('decider ' + row.decider)
  if (row && row.kind) meta.push(row.kind)
  if (row && row.ts_iso) meta.push(row.ts_iso)

  return jsxs('div', {
    className: 'mt-1.5 space-y-1 border-t border-[var(--border)] pt-1.5 text-[10px] text-[var(--muted-foreground)]',
    children: [
      row && row.fallback && row.reason ? jsx('div', { children: 'jev did not decide — ' + row.reason }) : null,
      probabilities.length
        ? jsx('div', {
            className: 'space-y-0.5',
            children: probabilities.slice(0, 6).map((key) =>
              jsxs(
                'div',
                {
                  className: 'flex items-center gap-1.5',
                  children: [
                    jsx('span', { className: 'w-[45%] truncate', children: key }),
                    jsx('span', {
                      className: 'h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--border)]',
                      children: jsx('span', {
                        className: 'block h-full bg-[var(--accent)]',
                        style: { width: pct(row.probabilities[key]) },
                      }),
                    }),
                    jsx('span', { className: 'tabular-nums', children: pct(row.probabilities[key]) }),
                  ],
                },
                key,
              ),
            ),
          })
        : null,
      meta.length ? jsx('div', { children: meta.join(' · ') }) : null,
      extra.length
        ? jsx('div', {
            children: extra
              .map((key) => key + ' ' + fmtExtraValue(row.extra[key]))
              .join(' · '),
          })
        : null,
    ],
  })
}

function DecisionRow({ row, nowMs }) {
  const [open, setOpen] = useState(false)
  const verdict = row && row.verdict ? row.verdict : row && row.fallback ? 'handoff' : ''
  return jsxs('div', {
    className: 'rounded border border-[var(--border)] px-2 py-1.5',
    children: [
      jsxs('button', {
        type: 'button',
        className: 'flex w-full items-baseline gap-1.5 text-left',
        onClick: () => setOpen(!open),
        children: [
          jsx('span', {
            className: 'shrink-0 rounded px-1 text-[9px] uppercase tracking-wider text-[var(--muted-foreground)]',
            children: (row && row.source) || 'unknown',
          }),
          jsx('span', {
            className: 'min-w-0 flex-1 truncate text-[11.5px] font-medium ' + verdictTone(verdict),
            children: shortVerdict(verdict),
          }),
          jsx('span', { className: 'shrink-0 text-[10px] tabular-nums text-[var(--muted-foreground)]', children: pct(row && row.confidence) }),
          jsx('span', { className: 'shrink-0 text-[10px] tabular-nums text-[var(--muted-foreground)]', children: fmtAge(row && row.ts, nowMs) }),
        ],
      }),
      jsx('div', {
        className: 'truncate text-[10.5px] text-[var(--muted-foreground)]',
        children: (row && row.question) || '(no question recorded)',
      }),
      open ? jsx(DecisionDetail, { row: row }) : null,
    ],
  })
}

function HudPane() {
  const qc = useQueryClient()
  const recent = useQuery({
    queryKey: [ID, 'recent', RECENT_LIMIT],
    queryFn: () => rest('/recent?limit=' + RECENT_LIMIT, { timeoutMs: 15000 }),
    refetchInterval: refetchInterval(),
    refetchIntervalInBackground: false,
    retry: 1,
  })
  const summary = useQuery({
    queryKey: [ID, 'summary'],
    queryFn: () => rest('/summary', { timeoutMs: 15000 }),
    refetchInterval: refetchInterval(),
    refetchIntervalInBackground: false,
    retry: 1,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: [ID] })
  const nowMs = Date.now()
  const payload = classifyPayload(recent.data)
  const summaryData = summary.data && typeof summary.data === 'object' && !Array.isArray(summary.data) ? summary.data : null

  let body
  if (recent.isError) {
    const info = classifyRestError(recent.error)
    body = jsxs('div', {
      className: 'space-y-1 rounded-lg border border-dashed border-[var(--border)] p-2.5',
      children: [
        jsx('div', {
          className: 'text-[11px] ' + (info.kind === 'not_mounted' ? 'text-[var(--foreground)]' : 'text-rose-500'),
          children: info.kind === 'not_mounted' ? NOT_MOUNTED : 'backend error — the meter shows nothing rather than guessing',
        }),
        jsx('div', { className: 'text-[10px] text-[var(--muted-foreground)]', children: info.detail }),
        jsx('div', {
          className: 'text-[10px] text-[var(--muted-foreground)]',
          children: 'expected at ' + BACKEND_PATH + '/recent and ' + BACKEND_PATH + '/summary',
        }),
      ],
    })
  } else if (!recent.data) {
    body = jsx('div', {
      className: 'rounded-lg border border-dashed border-[var(--border)] p-2.5 text-[11px] text-[var(--muted-foreground)]',
      children: 'reading the Jev ledger…',
    })
  } else if (payload.state === 'empty') {
    body = jsxs('div', {
      className: 'space-y-1 rounded-lg border border-dashed border-[var(--border)] p-2.5',
      children: [
        jsx('div', { className: 'text-[11px] text-[var(--foreground)]', children: 'no decisions in the ledger tail' }),
        jsx('div', {
          className: 'text-[10px] text-[var(--muted-foreground)]',
          children: 'nothing has been decided yet, or the ledger is empty — this pane will not invent a row',
        }),
      ],
    })
  } else if (payload.state === 'malformed') {
    body = jsx('div', {
      className: 'rounded-lg border border-dashed border-[var(--border)] p-2.5 text-[11px] text-rose-500',
      children: 'the backend answered, but not with decision rows',
    })
  } else {
    body = jsxs('div', {
      className: 'space-y-1.5',
      children: payload.rows.map((row, index) => jsx(DecisionRow, { row: row, nowMs: nowMs }, row.id || 'row-' + index)),
    })
  }

  return jsxs('div', {
    className: 'flex h-full flex-col gap-2 overflow-auto p-2 text-[11px] text-[var(--foreground)]',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsx('span', { className: 'text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]', children: 'Jev decisions' }),
          jsx('span', {
            className: 'text-[10px] tabular-nums text-[var(--muted-foreground)]',
            children: payload.state === 'ok' ? payload.rows.length + ' of ' + (recent.data.available || payload.rows.length) : '—',
          }),
        ],
      }),
      jsx(HudSummary, {
        summary: summaryData,
        recent: recent.data,
        nowMs: nowMs,
        fetching: !!recent.isFetching || !!summary.isFetching,
        onRefresh: refresh,
      }),
      body,
    ],
  })
}

/* ------------------------------------------------------------------ status-bar chip */

function HudChip() {
  const summary = useQuery({
    queryKey: [ID, 'summary'],
    queryFn: () => rest('/summary', { timeoutMs: 15000 }),
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  })
  const data = summary.data && typeof summary.data === 'object' && !Array.isArray(summary.data) ? summary.data : null

  let label = 'jev …'
  let tone = 'text-[var(--muted-foreground)]'
  let title = 'Jev HUD — reading the ledger'
  if (summary.isError) {
    const info = classifyRestError(summary.error)
    label = 'jev offline'
    tone = 'text-rose-500'
    title = info.kind === 'not_mounted' ? NOT_MOUNTED : 'Jev HUD backend error: ' + info.detail
  } else if (data) {
    const today = data.today_counts && typeof data.today_counts.count === 'number' ? data.today_counts.count : null
    const last = data.last_seen
    label = today === null ? 'jev —' : 'jev ' + today + ' today'
    tone = today ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'
    title =
      'Jev HUD — ' +
      (today === null ? 'count unavailable' : today + ' decisions today') +
      (last ? ' · last ' + shortVerdict(last.verdict, 24) + ' ' + fmtAge(last.ts) + ' ago' : '') +
      ' · click to refresh'
  }

  return jsx('button', {
    type: 'button',
    className: 'px-1.5 text-[0.6875rem] ' + tone,
    title: title,
    onClick: () => queryClient.invalidateQueries({ queryKey: [ID] }),
    children: label,
  })
}

/* ------------------------------------------------------------------ registration */

export default {
  id: ID,
  name: 'Jev HUD',
  register(ctx) {
    ctxRest = (path, opts) => ctx.rest(path, opts)

    ctx.register({
      id: PANE_ID,
      area: 'panes',
      title: 'Jev HUD',
      data: { placement: 'right', width: '300px' },
      render: () => jsx(HudPane, {}),
    })

    ctx.register({
      id: CHIP_ID,
      area: STATUSBAR_AREAS.right,
      order: 43,
      render: () => jsx(HudChip, {}),
    })

    ctx.register({
      id: 'hud-refresh',
      area: PALETTE_AREA,
      data: {
        id: 'jev-hud.refresh',
        label: 'Jev HUD: refresh the decision meter',
        keywords: ['jev', 'hud', 'decisions', 'ledger', 'oracle', 'second mind', 'confidence', 'meter'],
        run: () => {
          queryClient.invalidateQueries({ queryKey: [ID] })
          host.notify({ kind: 'info', message: 'Jev HUD: re-reading the decision ledgers' })
        },
      },
    })
  },
}
