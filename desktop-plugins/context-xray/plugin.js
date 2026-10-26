/**
 * Context X-Ray — what is actually filling this session's context window.
 *
 * One pane, one question: *what is eating the window?* The pane splits the
 * occupied context into categories (system prompt, tool definitions, skills,
 * MCP, memory, conversation, …), draws the stacked bar the app's own context
 * popover draws, and then lists the single fattest contributors — the biggest
 * categories plus the biggest transcript rows.
 *
 * DATA — every number comes from a real RPC or a real atom; nothing is invented:
 *
 *   session.context_breakdown { session_id }   PRIMARY. Handler:
 *     tui_gateway/methods_session.py::session.context_breakdown →
 *     agent.context_breakdown.compute_session_context_breakdown.
 *     Returns { categories:[{id,label,color,tokens}], context_used, context_max,
 *     context_percent, context_estimated, context_source, estimated_total, model,
 *     context_files }. Read-only: a chars/4 pass on the server, no provider call.
 *   session.history { session_id }             Fallback + transcript rows
 *     ({ count, messages:[{role,text,…}] } — a DISPLAY projection).
 *   config.get { key:'full' }                  model.context_length, used only
 *     when the breakdown reports no window.
 *   host.state.focusedUsage / focusedSessionId Live atoms — the status-bar chip
 *     reads the streamed usage first and never pays an RPC for it.
 *
 * HONESTY RULES (non-negotiable, and visible in the UI):
 *   - 'measured'  = the gateway reported provider usage (context_estimated false).
 *   - 'estimated' = the gateway's own chars/4 pass, or our chars/4 pass over
 *     session.history. Both are labelled, both get a '~', both carry the method
 *     in a tooltip line. An estimate is never painted as measured.
 *   - session.history is a display projection: tool results arrive as a name and
 *     an 80-char context preview, so transcript-row sizes UNDERCOUNT tool output
 *     bodies. The note says so instead of pretending otherwise.
 *   - No live session / no breakdown / empty payload → a dedicated honest state,
 *     never a fake number and never a spinner that never ends.
 *
 * Surfaces: right-rail pane ('panes') + status-bar chip (STATUSBAR_AREAS.right).
 */

import { STATUSBAR_AREAS, atom, host, useQuery, useQueryClient, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useMemo, useState } from 'react'

const ID = 'context-xray'
const PANE_ID = 'ctx-pane'
const PANE_REF = `${ID}:${PANE_ID}`
const CHIP_ID = 'ctx-chip'
const POLL_MS = 5000 // breakdown: live enough for a context window, cheap (read-only, in-process)
const HISTORY_MS = 20000 // transcript rows move slower and the payload is bigger
const TOP_N = 5

/* ══════════════════════════════════════════════════════════ pure helpers
 * Everything below this banner is plain JS: no SDK identifier is referenced,
 * which is what lets the vm test harness call these directly.
 */

const CHARS_PER_TOKEN = 4 // agent/model_metadata.py::CHARS_PER_TOKEN
// Same dense-codepoint set as agent/model_metadata.py::_CJK_DENSE_RE (no /g: .test stays stateless).
const CJK_RE = /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/

/** Theme variables the app defines for context categories (apps/desktop/src/styles.css). */
const CATEGORY_COLORS = {
  system_prompt: 'var(--context-usage-system)',
  tool_definitions: 'var(--context-usage-tools)',
  rules: 'var(--context-usage-rules)',
  skills: 'var(--context-usage-skills)',
  mcp: 'var(--context-usage-mcp)',
  subagent_definitions: 'var(--context-usage-subagents)',
  memory: 'var(--context-usage-memory)',
  conversation: 'var(--context-usage-conversation)',
}
const FALLBACK_COLOR = 'var(--muted-foreground)'

const ROLE_LABEL = { user: 'user turn', assistant: 'assistant turn', tool: 'tool output', system: 'system row' }

const BASIS_LABEL = {
  measured: 'measured',
  estimated: 'estimated',
  derived: 'estimated · chars/4',
  unavailable: 'unavailable',
}

const BASIS_NOTE = {
  measured: 'measured — the gateway read provider usage for this session (no client estimate)',
  estimated:
    "estimated — the gateway's own chars/4 pass over the live prompt, tools and transcript (agent/context_breakdown.py); not a tokenizer count",
  derived:
    'estimated — computed here from session.history at 4 chars/token; that feed is a display projection, so tool-output bodies are NOT in it and the total is a floor, not the whole window',
  unavailable: 'no breakdown for this session — nothing is shown rather than a guess',
  occupancyOnly:
    'occupancy is reported for this session but the gateway returned no category split (no live prompt build yet) — only the totals below are real',
}

/** UTF-8 byte length without TextEncoder (works in the vm harness too). */
function utf8Bytes(text) {
  const s = text == null ? '' : String(text)
  let bytes = 0
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i += 1
      } else {
        bytes += 3 // lone high surrogate → replacement char
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

/** Rough token estimate: CJK/Hangul/Kana ~1 token each, everything else ceil(bytes/4).
 *  Mirrors agent/model_metadata.py::estimate_tokens_rough — the same rule the server uses. */
function estimateTokensFromText(text) {
  if (text == null) return 0
  const s = String(text)
  if (!s) return 0
  if (!CJK_RE.test(s)) return Math.ceil(utf8Bytes(s) / CHARS_PER_TOKEN)
  let dense = 0
  let rest = ''
  for (const ch of s) {
    if (CJK_RE.test(ch)) dense += 1
    else rest += ch
  }
  return dense + (rest ? Math.ceil(utf8Bytes(rest) / CHARS_PER_TOKEN) : 0)
}

/** Compact token readout: 940 → '940', 41200 → '41k', 1250000 → '1.3M'.
 *  null/undefined are "unknown", not zero — an unknown size must not read as '0'. */
function fmtTokens(n) {
  if (n === null || n === undefined || n === '') return '—'
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  if (v <= 0) return '0'
  if (v < 1000) return String(Math.round(v))
  if (v < 10000) return `${(v / 1000).toFixed(1)}k`
  if (v < 1e6) return `${Math.round(v / 1000)}k`
  return `${(v / 1e6).toFixed(1)}M`
}

/** Share of `total`, one decimal, 0 when total is unusable. */
function sharePct(tokens, total) {
  const t = Number(tokens)
  const sum = Number(total)
  if (!Number.isFinite(t) || !Number.isFinite(sum) || sum <= 0 || t <= 0) return 0
  return Math.round((t / sum) * 1000) / 10
}

function shareLabel(pct) {
  const v = Number(pct)
  if (!Number.isFinite(v) || v <= 0) return '0%'
  if (v >= 10) return `${Math.round(v)}%`
  return `${v.toFixed(1)}%`
}

/** Clamp to a whole 0–100 percent; anything unparsable is 0. */
function clampPct(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, Math.round(v)))
}

/** Only theme variables are allowed through: a wire colour is accepted solely when it
 *  already is a var(...) reference, otherwise the category's own var or the muted default. */
function categoryColor(id, given) {
  const known = CATEGORY_COLORS[String(id || '')]
  if (known) return known
  const raw = typeof given === 'string' ? given.trim() : ''
  if (raw && raw.indexOf('var(') === 0 && raw.indexOf(')') > 0) return raw
  return FALLBACK_COLOR
}

/** Keep only rows we can actually draw: a non-empty id and a finite, non-negative token count. */
function normalizeCategories(list) {
  const rows = Array.isArray(list) ? list : []
  const out = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const id = String(raw.id || '')
    if (!id) continue
    const tokens = Number(raw.tokens)
    if (!Number.isFinite(tokens) || tokens < 0) continue
    out.push({
      id,
      label: String(raw.label || id),
      color: categoryColor(id, raw.color),
      tokens: Math.round(tokens),
    })
  }
  return out
}

function sumTokens(categories) {
  let total = 0
  for (const c of Array.isArray(categories) ? categories : []) {
    const t = Number(c && c.tokens)
    if (Number.isFinite(t) && t > 0) total += t
  }
  return total
}

/** Display-projected history row ({ role, text, context?, args? }) → chars + est. tokens. */
function historyRowMeasure(msg) {
  if (!msg || typeof msg !== 'object') return { chars: 0, tokens: 0 }
  let chars = 0
  let tokens = 0
  const push = (value) => {
    if (typeof value !== 'string' || !value) return
    chars += value.length
    tokens += estimateTokensFromText(value)
  }
  push(msg.text)
  push(msg.context)
  if (msg.args && typeof msg.args === 'object') {
    let json = ''
    try {
      json = JSON.stringify(msg.args)
    } catch {
      json = '' // circular / unserialisable args: measured as nothing rather than guessed
    }
    push(json)
  }
  return { chars, tokens }
}

function historyRowLabel(msg) {
  const role = String((msg && msg.role) || 'row')
  const base = ROLE_LABEL[role] || role
  const name = msg && typeof msg.name === 'string' ? msg.name : ''
  return name ? `${base} · ${name}` : base
}

/** The N fattest transcript rows, biggest first (ties keep transcript order). */
function topHistoryRows(messages, limit = TOP_N) {
  const list = Array.isArray(messages) ? messages : []
  const rows = []
  for (let i = 0; i < list.length; i += 1) {
    const msg = list[i]
    if (!msg || typeof msg !== 'object') continue
    const measure = historyRowMeasure(msg)
    if (measure.tokens <= 0) continue
    rows.push({ key: `row-${i}`, index: i, label: historyRowLabel(msg), chars: measure.chars, tokens: measure.tokens })
  }
  rows.sort((a, b) => b.tokens - a.tokens || a.index - b.index)
  const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 0
  return rows.slice(0, cap)
}

/** Whole-transcript estimate: the chars/4 floor the 'derived' basis is built on. */
function estimateFromHistory(messages, limit = TOP_N) {
  const list = Array.isArray(messages) ? messages : []
  let tokens = 0
  let chars = 0
  for (const msg of list) {
    const measure = historyRowMeasure(msg)
    tokens += measure.tokens
    chars += measure.chars
  }
  return { chars, tokens, count: list.length, rows: topHistoryRows(list, limit) }
}

/** Biggest single items: measured categories + estimated transcript rows, tagged by basis. */
function buildContributors(categories, rows, limit = TOP_N) {
  const items = []
  for (const c of Array.isArray(categories) ? categories : []) {
    const tokens = Number(c && c.tokens)
    if (!Number.isFinite(tokens) || tokens <= 0) continue
    items.push({ key: `cat:${c.id}`, label: String(c.label || c.id), tokens: Math.round(tokens), color: c.color || FALLBACK_COLOR, basis: 'category', chars: 0 })
  }
  for (const r of Array.isArray(rows) ? rows : []) {
    const tokens = Number(r && r.tokens)
    if (!Number.isFinite(tokens) || tokens <= 0) continue
    items.push({ key: `row:${r.key}`, label: String(r.label || 'transcript row'), tokens: Math.round(tokens), color: null, basis: 'transcript', chars: Math.round(Number(r.chars) || 0) })
  }
  items.sort((a, b) => b.tokens - a.tokens)
  const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 0
  return items.slice(0, cap)
}

/** config.model.context_length — the configured window, used only when the RPC reports none. */
function configContextLength(config) {
  if (!config || typeof config !== 'object') return 0
  const model = config.model && typeof config.model === 'object' ? config.model : null
  const value = Number(model && model.context_length)
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function resolveWindowMax(breakdown, config) {
  const fromBreakdown = Number(breakdown && breakdown.context_max)
  if (Number.isFinite(fromBreakdown) && fromBreakdown > 0) return Math.round(fromBreakdown)
  return configContextLength(config)
}

/** Percent from a usage/breakdown payload, or null when the window is unknown. */
function usagePercent(usage) {
  if (!usage || typeof usage !== 'object') return null
  const max = Number(usage.context_max)
  if (!Number.isFinite(max) || max <= 0) return null
  if (typeof usage.context_percent === 'number' && Number.isFinite(usage.context_percent)) {
    return clampPct(usage.context_percent)
  }
  const used = Number(usage.context_used)
  if (Number.isFinite(used) && used >= 0) return clampPct((used / max) * 100)
  return null
}

/** 'ctx 63%' / 'ctx ~63%' / 'ctx —' (the — is the honest "nothing to report"). */
function chipText(percent, estimated) {
  const value = Number(percent)
  if (percent == null || !Number.isFinite(value)) return 'ctx —'
  return `ctx ${estimated ? '~' : ''}${clampPct(value)}%`
}

/**
 * The whole pane, as one honest view model.
 * basis: measured | estimated | derived | unavailable — never upgraded, never faked.
 */
function buildContextView(input) {
  const { breakdown, history, config, breakdownError, historyError } = input || {}
  const hasBreakdown = !!(breakdown && typeof breakdown === 'object')
  const categories = normalizeCategories(hasBreakdown ? breakdown.categories : null)
  const estimate = estimateFromHistory(history && history.messages, TOP_N)
  const windowMax = resolveWindowMax(breakdown, config)

  // No categories (no agent built yet, or a session the gateway has no prompt for):
  // the transcript estimate stands in — labelled 'derived', never 'measured'.
  const derived = categories.length
    ? categories
    : estimate.tokens > 0
      ? [{ id: 'conversation', label: 'Conversation (transcript rows)', color: CATEGORY_COLORS.conversation, tokens: estimate.tokens }]
      : []

  const segmentTotal = sumTokens(derived)
  const usedRaw = Number(hasBreakdown ? breakdown.context_used : NaN)
  const used = Number.isFinite(usedRaw) && usedRaw > 0 ? Math.round(usedRaw) : segmentTotal
  const source = String((hasBreakdown && breakdown.context_source) || '')
  const serverEstimated = !!(hasBreakdown && breakdown.context_estimated)

  let basis = 'unavailable'
  if (categories.length) {
    basis = !serverEstimated && (!source || source === 'provider_usage') ? 'measured' : 'estimated'
  } else if (derived.length) {
    basis = 'derived'
  } else if (hasBreakdown && (used > 0 || windowMax > 0)) {
    // Occupancy without a split: the gateway answered, it just had no prompt build to
    // break down (agent not built yet). Measured numbers are still measured numbers.
    basis = serverEstimated ? 'estimated' : 'measured'
  }

  const percent = windowMax > 0 ? clampPct((used / windowMax) * 100) : 0
  const contributors = buildContributors(categories, estimate.rows, TOP_N)
  const splitMissing = !categories.length && !derived.length && basis !== 'unavailable'

  return {
    basis,
    basisLabel: BASIS_LABEL[basis],
    note: splitMissing ? BASIS_NOTE.occupancyOnly : BASIS_NOTE[basis],
    estimated: basis !== 'measured',
    categories: derived,
    contributors,
    segmentTotal,
    used,
    windowMax,
    percent,
    model: String((hasBreakdown && breakdown.model) || ''),
    source,
    serverEstimated,
    historyCount: estimate.count,
    historyChars: estimate.chars,
    historyTokens: estimate.tokens,
    breakdownError: breakdownError ? String(breakdownError) : '',
    historyError: historyError ? String(historyError) : '',
  }
}

function chipLabel(view) {
  if (!view || view.basis === 'unavailable' || !(Number(view.windowMax) > 0)) return 'ctx —'
  return chipText(view.percent, view.estimated)
}

/** Module-scope refresh fan-out (pure JS so it is testable, and so the palette/button
 *  paths reach a pane that is already mounted). */
const refreshBus = {
  listeners: new Set(),
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {}
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  },
  emit() {
    let notified = 0
    for (const fn of Array.from(this.listeners)) {
      notified += 1
      try {
        fn()
      } catch {
        /* one bad listener never blocks the rest */
      }
    }
    return notified
  },
}

/* ══════════════════════════════════════════════════════════ SDK-touching glue */

let nullAtom = null
/** A stable atom for builds that do not expose the store we want — useValue(undefined) throws. */
function nullValueAtom() {
  if (!nullAtom) {
    try {
      nullAtom = atom(null)
    } catch {
      nullAtom = { get: () => null, listen: () => () => {}, subscribe: () => () => {} }
    }
  }
  return nullAtom
}

let visibleAtom = null
/** host.paneVisibility is newer than this plugin: feature-detect, fall back to always-visible. */
function paneVisibleAtom() {
  try {
    if (typeof host.paneVisibility === 'function') {
      const store = host.paneVisibility(PANE_REF)
      if (store) return store
    }
  } catch {
    /* older desktop build */
  }
  if (!visibleAtom) {
    try {
      visibleAtom = atom(true)
    } catch {
      visibleAtom = { get: () => true, listen: () => () => {}, subscribe: () => () => {} }
    }
  }
  return visibleAtom
}

function useFocusedSessionId() {
  const state = host && host.state ? host.state : {}
  const focused = useValue(state.focusedSessionId || nullValueAtom())
  const active = useValue(state.activeSessionId || nullValueAtom())
  return (typeof focused === 'string' && focused) || (typeof active === 'string' && active) || null
}

function useXrayData({ enabled, sessionId }) {
  const qc = useQueryClient()

  const breakdown = useQuery({
    queryKey: ['context-xray', 'breakdown', sessionId],
    queryFn: () => host.request('session.context_breakdown', { session_id: sessionId }),
    enabled: !!enabled && !!sessionId,
    refetchInterval: enabled && sessionId ? POLL_MS : false,
    staleTime: POLL_MS - 1000,
    retry: false,
  })

  // Transcript rows: the top-contributor list, and the fallback estimate when the
  // breakdown has no categories. Slower cadence — this payload is the transcript.
  const history = useQuery({
    queryKey: ['context-xray', 'history', sessionId],
    queryFn: () => host.request('session.history', { session_id: sessionId }),
    enabled: !!enabled && !!sessionId,
    refetchInterval: enabled && sessionId ? HISTORY_MS : false,
    staleTime: HISTORY_MS - 5000,
    retry: false,
  })

  // Only when the gateway reported no window at all do we read the configured pin.
  const needConfig = !!breakdown.data && !(Number(breakdown.data.context_max) > 0)
  const config = useQuery({
    queryKey: ['context-xray', 'config'],
    queryFn: () => host.request('config.get', { key: 'full' }),
    enabled: !!enabled && needConfig,
    refetchInterval: false,
    staleTime: 300000,
    retry: false,
  })

  useEffect(() => {
    const off = refreshBus.subscribe(() => {
      try {
        qc.invalidateQueries({ queryKey: ['context-xray'] })
      } catch {
        /* query client gone during teardown */
      }
    })
    return off
  }, [qc])

  const refresh = useCallback(() => {
    try {
      qc.invalidateQueries({ queryKey: ['context-xray'] })
    } catch {
      /* noop */
    }
    refreshBus.emit()
  }, [qc])

  return { breakdown, history, config, refresh }
}

/* ══════════════════════════════════════════════════════════ pieces */

function Badge({ children, tone = 'text-[var(--muted-foreground)]', title }) {
  return jsx('span', {
    className: `inline-flex items-center rounded-full border border-[var(--border)] px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider ${tone}`,
    title,
    children,
  })
}

function StackedBar({ categories, segmentTotal }) {
  const total = segmentTotal > 0 ? segmentTotal : 1
  return jsx('div', {
    className: 'flex h-[10px] w-full overflow-hidden rounded-full bg-[var(--border)]',
    title: 'share of the reported context, by category',
    children: categories.length
      ? categories.map((c) =>
          jsx('div', {
            key: c.id,
            className: 'h-full min-w-[2px]',
            style: { background: c.color, width: `${Math.max(0.5, (c.tokens / total) * 100)}%` },
            title: `${c.label}: ${fmtTokens(c.tokens)} tokens (${shareLabel(sharePct(c.tokens, total))})`,
          }),
        )
      : jsx('div', { className: 'h-full w-full opacity-40' }),
  })
}

function CategoryRows({ categories, segmentTotal }) {
  if (!categories.length) {
    return jsx('div', { className: 'text-[11px] text-[var(--muted-foreground)]', children: 'no category split for this session' })
  }
  return jsx('div', {
    className: 'flex flex-col gap-[3px]',
    children: categories.map((c) =>
      jsxs(
        'div',
        {
          key: c.id,
          className: 'flex items-center justify-between gap-2 text-[11.5px]',
          children: [
            jsxs('span', {
              className: 'flex min-w-0 items-center gap-1.5',
              children: [
                jsx('span', { className: 'size-[8px] shrink-0 rounded-[2px]', style: { background: c.color } }),
                jsx('span', { className: 'truncate text-[var(--muted-foreground)]', children: c.label }),
              ],
            }),
            jsxs('span', {
              className: 'shrink-0 tabular-nums text-[var(--foreground)]',
              children: [
                fmtTokens(c.tokens),
                jsx('span', { className: 'ml-1.5 text-[10px] text-[var(--muted-foreground)]', children: shareLabel(sharePct(c.tokens, segmentTotal)) }),
              ],
            }),
          ],
        },
        c.id,
      ),
    ),
  })
}

function ContributorRows({ contributors, segmentTotal }) {
  if (!contributors.length) {
    return jsx('div', { className: 'text-[11px] text-[var(--muted-foreground)]', children: 'no individual items to rank' })
  }
  return jsx('div', {
    className: 'flex flex-col gap-[3px]',
    children: contributors.map((item) =>
      jsxs(
        'div',
        {
          key: item.key,
          className: 'flex items-center justify-between gap-2 text-[11.5px]',
          children: [
            jsxs('span', {
              className: 'flex min-w-0 items-center gap-1.5',
              children: [
                jsx('span', {
                  className: 'size-[8px] shrink-0 rounded-[2px]',
                  style: { background: item.color || 'var(--ui-accent, var(--foreground))' },
                }),
                jsx('span', { className: 'truncate text-[var(--foreground)]', children: item.label }),
              ],
            }),
            jsxs('span', {
              className: 'shrink-0 tabular-nums text-[var(--muted-foreground)]',
              children: [
                item.basis === 'transcript' ? '~' : '',
                fmtTokens(item.tokens),
                item.basis === 'transcript' && item.chars ? ` · ${item.chars} ch` : '',
                jsx('span', { className: 'ml-1.5 text-[10px]', children: shareLabel(sharePct(item.tokens, segmentTotal)) }),
              ],
            }),
          ],
        },
        item.key,
      ),
    ),
  })
}

function SectionTitle({ children, right }) {
  return jsxs('div', {
    className: 'flex items-baseline justify-between',
    children: [
      jsx('div', { className: 'text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]', children }),
      right ? jsx('div', { className: 'text-[9.5px] tabular-nums text-[var(--muted-foreground)]', children: right }) : null,
    ],
  })
}

/* ══════════════════════════════════════════════════════════ the pane */

function XrayPane() {
  const sessionId = useFocusedSessionId()
  const visible = useValue(paneVisibleAtom()) !== false
  const { breakdown, history, config, refresh } = useXrayData({ enabled: visible, sessionId })
  const [showAllRows, setShowAllRows] = useState(false)

  const view = useMemo(
    () =>
      buildContextView({
        breakdown: breakdown.data,
        history: history.data,
        config: config.data && config.data.config,
        breakdownError: breakdown.error ? breakdown.error.message || 'breakdown RPC failed' : '',
        historyError: history.error ? history.error.message || 'history RPC failed' : '',
      }),
    [breakdown.data, breakdown.error, history.data, history.error, config.data],
  )

  const loading = !sessionId ? false : breakdown.isLoading && !breakdown.data
  const errors = [view.breakdownError, view.historyError].filter(Boolean)

  return jsxs('div', {
    className: 'flex h-full w-full flex-col gap-2 overflow-y-auto p-3 text-[var(--foreground)]',
    children: [
      /* header */
      jsxs('div', {
        key: 'hdr',
        className: 'flex items-center justify-between gap-2',
        children: [
          jsxs('div', {
            className: 'flex min-w-0 flex-col',
            children: [
              jsx('div', { className: 'text-[12px] font-semibold uppercase tracking-[0.18em]', children: 'Context X-Ray' }),
              jsx('div', { className: 'text-[10px] text-[var(--muted-foreground)]', children: 'what is filling this session window' }),
            ],
          }),
          jsx('button', {
            type: 'button',
            className: 'shrink-0 rounded border border-[var(--border)] px-2 py-[3px] text-[10.5px] hover:border-[var(--foreground)]/40',
            onClick: refresh,
            title: 'refetch now (auto-refresh every 5s while this pane is visible)',
            children: 'refresh',
          }),
        ],
      }),

      /* honest states */
      !sessionId
        ? jsx('div', {
            key: 'nosess',
            className: 'rounded-lg border border-dashed border-[var(--border)] px-2.5 py-3 text-[11.5px] text-[var(--muted-foreground)]',
            children: 'no active session — open a chat and the breakdown appears here',
          })
        : null,

      sessionId && loading
        ? jsx('div', { key: 'loading', className: 'text-[11px] text-[var(--muted-foreground)]', children: 'reading session.context_breakdown…' })
        : null,

      sessionId && view.basis === 'unavailable'
        ? jsxs('div', {
            key: 'empty',
            className: 'rounded-lg border border-dashed border-[var(--border)] px-2.5 py-3 text-[11.5px] text-[var(--muted-foreground)]',
            children: [
              jsx('div', { children: 'usage unavailable for this session' }),
              jsx('div', {
                className: 'mt-1 text-[10.5px]',
                children: 'the gateway reported no categories and no transcript rows for it yet',
              }),
            ],
          })
        : null,

      /* the numbers */
      sessionId && view.basis !== 'unavailable'
        ? jsxs('div', {
            key: 'nums',
            className: 'flex flex-col gap-2',
            children: [
              jsxs('div', {
                className: 'flex items-baseline justify-between gap-2',
                children: [
                  jsxs('div', {
                    className: 'text-[13px] tabular-nums text-[var(--foreground)]',
                    children: [
                      'used ',
                      jsx('b', { children: `${view.estimated ? '~' : ''}${fmtTokens(view.used)}` }),
                      ' / window ',
                      jsx('b', { children: view.windowMax > 0 ? fmtTokens(view.windowMax) : '—' }),
                      view.windowMax > 0 ? ` (${view.estimated ? '~' : ''}${view.percent}%)` : '',
                    ],
                  }),
                  jsx(Badge, {
                    tone: view.basis === 'measured' ? 'text-[var(--ui-green)]' : 'text-[var(--ui-yellow)]',
                    title: view.note,
                    children: view.basisLabel,
                  }),
                ],
              }),

              view.windowMax > 0
                ? jsx('div', {
                    className: 'h-[3px] w-full overflow-hidden rounded-full bg-[var(--border)]',
                    title: `${view.percent}% of the reported window`,
                    children: jsx('div', {
                      className: 'h-full rounded-full bg-[var(--foreground)]',
                      style: { width: `${view.percent > 0 ? Math.max(1, view.percent) : 0}%` },
                    }),
                  })
                : jsx('div', { className: 'text-[10.5px] text-[var(--muted-foreground)]', children: 'window size unknown — set model.context_length or run a turn' }),

              jsx('div', {
                className: 'text-[10px] leading-snug text-[var(--muted-foreground)]',
                children: view.note,
              }),

              jsx(StackedBar, { categories: view.categories, segmentTotal: view.segmentTotal }),

              jsx(CategoryRows, { categories: view.categories, segmentTotal: view.segmentTotal }),

              jsxs('div', {
                className: 'mt-1 flex flex-col gap-1.5',
                children: [
                  jsx(SectionTitle, {
                    children: 'top contributors',
                    right: view.historyCount
                      ? `${view.contributors.length} shown · ${view.historyCount} transcript rows`
                      : `${view.contributors.length} shown`,
                  }),
                  jsx(ContributorRows, { contributors: view.contributors, segmentTotal: view.segmentTotal }),
                  jsx('div', {
                    className: 'text-[10px] leading-snug text-[var(--muted-foreground)]',
                    children: view.historyCount
                      ? 'categories are the gateway’s own split; rows marked ~ are this plugin’s chars/4 estimate over the display transcript (tool-output bodies are not in that feed).'
                      : 'categories only — no transcript rows returned for this session.',
                  }),
                ],
              }),

              view.historyCount > TOP_N
                ? jsx('button', {
                    type: 'button',
                    className: 'self-start text-[10.5px] text-[var(--muted-foreground)] underline decoration-dotted hover:text-[var(--foreground)]',
                    onClick: () => setShowAllRows((v) => !v),
                    children: showAllRows ? 'hide transcript size detail' : `show transcript size detail (${view.historyCount} rows, ${view.historyChars} chars)`,
                  })
                : null,

              showAllRows
                ? jsx('div', {
                    className: 'text-[10px] leading-snug text-[var(--muted-foreground)]',
                    children: `session.history: ${view.historyCount} display rows · ${view.historyChars} chars · ~${fmtTokens(view.historyTokens)} tokens at 4 chars/token`,
                  })
                : null,

              jsx('div', {
                className: 'text-[10px] text-[var(--muted-foreground)]',
                children: [
                  view.model ? `model ${view.model}` : 'model unknown',
                  view.source ? ` · source ${view.source}` : '',
                  sessionId ? ` · session ${String(sessionId).slice(0, 12)}` : '',
                ].join(''),
              }),
            ],
          })
        : null,

      errors.length
        ? jsx('div', {
            key: 'errs',
            className: 'rounded-lg border border-[var(--border)] px-2.5 py-2 text-[10.5px] text-[var(--muted-foreground)]',
            children: `rpc: ${errors.join(' · ')}`,
          })
        : null,
    ],
  })
}

/* ══════════════════════════════════════════════════════════ the chip */

function XrayChip() {
  const sessionId = useFocusedSessionId()
  const liveUsage = useValue((host.state && host.state.focusedUsage) || nullValueAtom())
  const livePct = usagePercent(liveUsage)

  // The live atom is free; only when it carries no context window do we ask the
  // gateway, and then slowly (a status-bar chip must never be the busy surface).
  const fallback = useQuery({
    queryKey: ['context-xray', 'chip', sessionId],
    queryFn: () => host.request('session.context_breakdown', { session_id: sessionId }),
    enabled: !!sessionId && livePct == null,
    refetchInterval: 15000,
    staleTime: 10000,
    retry: false,
  })

  const pct = livePct != null ? livePct : usagePercent(fallback.data)
  const estimated = livePct != null ? !!(liveUsage && liveUsage.context_estimated) : !!(fallback.data && fallback.data.context_estimated)
  const label = sessionId ? chipText(pct, estimated) : 'ctx —'
  const detail =
    livePct != null
      ? 'live streamed usage of the focused session (host.state.focusedUsage)'
      : pct != null
        ? 'session.context_breakdown — the gateway’s read of this session’s context window'
        : 'no context figure for this session yet'

  return jsx('div', {
    className: `flex items-center gap-1 px-1 text-[10.5px] tabular-nums ${pct == null ? 'text-[var(--muted-foreground)]' : 'text-[var(--foreground)]'}`,
    title: `Context X-Ray — ${label} · ${detail}`,
    children: jsx('span', { className: 'font-semibold', children: label }),
  })
}

/* ══════════════════════════════════════════════════════════ registration */

export default {
  id: ID,
  name: 'Context X-Ray',
  description: "What is filling the active session's context window: categories, shares, top contributors.",
  register(ctx) {
    ctx.register({
      id: PANE_ID,
      area: 'panes',
      title: 'Context X-Ray',
      data: { placement: 'right', width: '340px' },
      render: () => jsx(XrayPane, {}),
    })

    ctx.register({
      id: CHIP_ID,
      area: STATUSBAR_AREAS.right,
      order: 42,
      render: () => jsx(XrayChip, {}),
    })
  },
}
