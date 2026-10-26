/**
 * Local Model Deck — the deck for the local LLM runtimes on this machine.
 *
 * One place to see the llama.cpp-family server that is actually running here — model, context,
 * slot occupancy, RSS, process uptime, and whether metrics are on — instead of scrolling a
 * terminal to find out.
 *
 * Surfaces:
 *   - Right-rail pane  ('panes'             → placement right, 320px): the full readout
 *   - Status-bar chip  (STATUSBAR_AREAS.right): 'bonsai ok · 5.5 GB' at a glance
 *   - Command palette  (PALETTE_AREA): refresh the deck
 *
 * Truth rules baked into this plugin:
 *   - Every number comes from the plugin backend's probe pass (GET /runtimes, GET /process),
 *     which reads the runtime's own /health, /props, /slots, /v1/models, /metrics and /proc on
 *     this host. Nothing is estimated, and a value that was not measured renders as '—' or '?'.
 *   - llama.cpp answers /metrics with HTTP 501 unless it was started with `--metrics`; the pane
 *     then says so — in the server's own words — and shows NO tokens/sec. It never invents
 *     throughput.
 *   - Backend not mounted / backend unreachable / nothing listening / no process found are four
 *     distinct honest states, never a spinner that never resolves.
 */

import {
  host,
  PALETTE_AREA,
  STATUSBAR_AREAS,
  atom,
  queryClient,
  useQuery,
  useValue,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'local-model-deck'
// The host namespaces every contribution id as `${pluginId}:${id}` (contrib/plugin.ts), so the
// pane contribution id 'pane' is what host.paneVisibility('local-model-deck:pane') tracks.
const PANE_CONTRIB_ID = 'pane'
const PANE_ID = `${ID}:${PANE_CONTRIB_ID}`
const QUERY_KEY = ['local-model-deck', 'runtimes']
const PANE_POLL_MS = 5000 // pane visible: live-ish
const CHIP_POLL_MS = 15000 // status bar: slow data, cheap
const PROCESS_POLL_MS = 15000 // /proc readout: slower than the HTTP probes
const REST_TIMEOUT_MS = 8000 // the backend budgets 1s per upstream probe; 8s is a hard ceiling

/** The honest copy for a llama.cpp server that was started without `--metrics`. */
const METRICS_OFF_NOTE = 'metrics disabled on this server (start with --metrics for tok/s)'

let ctxRest = async () => {
  throw new Error('local-model-deck: not registered yet')
}

const fetchRuntimes = () => ctxRest('/runtimes', { timeoutMs: REST_TIMEOUT_MS })
const fetchProcess = (port) => ctxRest(`/process?port=${port}`, { timeoutMs: REST_TIMEOUT_MS })

// --------------------------------------------------------------------------- pure helpers
// These are deliberately SDK-free so they can be unit-tested in a bare vm sandbox.

function orNull(value) {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s ? s : null
}

/** Number or null — never the `Number(null) === 0` trap, which would turn 'unknown' into a 0. */
function numOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function baseName(path) {
  const s = orNull(path)
  if (!s) return null
  const parts = s.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || null
}

function shortId(id) {
  const s = orNull(id)
  if (!s) return 'runtime'
  return s.toLowerCase().split(/[:@\s]/)[0] || 'runtime'
}

function modelFromProps(props) {
  if (!props || typeof props !== 'object') return null
  return orNull(props.model_alias) || orNull(props.model_path) || orNull(props.model)
}

function nCtxFromProps(props) {
  if (!props || typeof props !== 'object') return null
  const gen = props.default_generation_settings
  const raw = gen && typeof gen === 'object' && gen.n_ctx != null ? gen.n_ctx : props.n_ctx
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function totalSlotsFromProps(props) {
  if (!props || typeof props !== 'object') return null
  const n = Number(props.total_slots)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Busy/idle slots. Accepts both shapes: the plugin backend's summary object ({total,busy,idle})
 * and a raw llama.cpp /slots list. busy stays null whenever it was not measured — never guessed.
 */
function slotsSummary(slots, fallbackTotal) {
  const fallback = numOrNull(fallbackTotal) > 0 ? numOrNull(fallbackTotal) : null
  if (Array.isArray(slots)) {
    if (!slots.length) return { total: fallback, busy: null, idle: null }
    const busy = slots.filter((s) => s && s.is_processing === true).length
    return { total: slots.length, busy, idle: slots.length - busy }
  }
  if (slots && typeof slots === 'object') {
    const total = numOrNull(slots.total) > 0 ? numOrNull(slots.total) : fallback
    const busy = numOrNull(slots.busy)
    if (total === null) return { total: null, busy: null, idle: null }
    return { total, busy, idle: busy === null ? null : Math.max(0, total - busy) }
  }
  return { total: fallback, busy: null, idle: null }
}

/** Basename of the `-m` / `--model` argument — the last-resort model source. */
function modelFromCmdline(cmdline) {
  const s = orNull(cmdline)
  if (!s) return null
  const m = s.match(/(?:^|\s)(?:-m|--model)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/)
  const path = m && (m[1] || m[2] || m[3])
  return path ? baseName(path) : null
}

function fmtBytes(bytes) {
  const b = Number(bytes)
  if (!Number.isFinite(b) || b <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = b
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  const text = i === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1)
  return `${text} ${units[i]}`
}

function fmtCount(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`
  return String(Math.round(v))
}

function fmtCtx(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1024 && v % 1024 === 0) return `${v / 1024}k`
  return String(Math.round(v))
}

function fmtRss(mb) {
  const v = Number(mb)
  if (!Number.isFinite(v) || v <= 0) return '—'
  return v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${Math.round(v)} MB`
}

function fmtUptime(seconds) {
  const s = numOrNull(seconds)
  if (s === null || s < 0) return null
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${Math.floor(s % 60)}s`
  return `${Math.floor(s)}s`
}

function fmtClock(unixSeconds) {
  const t = Number(unixSeconds)
  if (!Number.isFinite(t) || t <= 0) return null
  const d = new Date(t * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Metrics state, always honest: 'on' only when /metrics really answered 200. */
function metricsRow(rt) {
  const r = rt && typeof rt === 'object' ? rt : {}
  if (r.metrics_enabled === true) {
    return { on: true, label: 'metrics on', note: 'tok/s available from /metrics', raw: null }
  }
  return { on: false, label: 'metrics off', note: METRICS_OFF_NOTE, raw: orNull(r.metrics_note) }
}

/** One runtime probe record → the row the pane renders. Pure: no SDK, no fetching. */
function runtimeRow(rt) {
  const r = rt && typeof rt === 'object' ? rt : {}
  const slots = slotsSummary(r.slots, null)
  const sizeText = fmtBytes(r.size_bytes)
  const paramsText = fmtCount(r.params)
  return {
    id: orNull(r.id) || 'runtime',
    short: shortId(r.id),
    label: orNull(r.label) || orNull(r.id) || 'runtime',
    host: orNull(r.host),
    port: numOrNull(r.port),
    up: r.up === true,
    health: orNull(r.health_detail),
    model: orNull(r.model),
    modelFile: orNull(r.model_file) || baseName(orNull(r.model)),
    ftype: orNull(r.ftype),
    nCtx: fmtCtx(r.n_ctx),
    nCtxRaw: numOrNull(r.n_ctx) > 0 ? numOrNull(r.n_ctx) : null,
    slotsBusy: slots.busy,
    slotsTotal: slots.total,
    slotsText: slots.total === null ? '—' : `${slots.busy === null ? '?' : slots.busy}/${slots.total}`,
    paramsText,
    sizeText,
    sizeHint: sizeText !== '—' ? sizeText : paramsText === '—' ? '' : `~${paramsText} params`,
    probeMs: numOrNull(r.probe_ms),
    metrics: metricsRow(r),
    error: orNull(r.error),
  }
}

/** One /process payload → the process block the pane renders. Pure. */
function processRow(payload) {
  const r = payload && typeof payload === 'object' ? payload : {}
  if (r.found !== true) {
    return {
      found: false,
      pidText: '—',
      rssText: '—',
      uptimeText: null,
      startedText: null,
      cmdline: null,
      note: orNull(r.note) || 'no listener process found for this port',
    }
  }
  return {
    found: true,
    pidText: numOrNull(r.pid) === null ? '—' : `pid ${numOrNull(r.pid)}`,
    rssText: fmtRss(r.rss_mb),
    uptimeText: fmtUptime(r.uptime_s),
    startedText: fmtClock(r.started_at),
    cmdline: orNull(r.cmdline),
    note: null,
  }
}

/** The status-bar state, derived from a /runtimes payload. Pure. */
function deckStatus(data) {
  const rows = data && Array.isArray(data.runtimes) ? data.runtimes : []
  if (!rows.length) return { text: 'deck ?', hint: '', tone: 'unknown' }
  const row = runtimeRow(rows[0])
  const more = rows.length > 1 ? ` +${rows.length - 1}` : ''
  return {
    text: `${row.short} ${row.up ? 'ok' : 'down'}${more}`,
    hint: row.up ? row.sizeHint : row.error || 'not answering',
    tone: row.up ? 'ok' : 'down',
  }
}

function errorText(err) {
  if (!err) return 'no error detail'
  const raw = typeof err === 'string' ? err : err.message || err.error || String(err)
  return orNull(raw) || 'no error detail'
}

/** The three backend-side failure states, told apart by what the error actually says. */
function backendState(err) {
  if (!err) return null
  const detail = errorText(err)
  const notMounted = /404|not found|not mounted|no such|405|method not allowed|501/i.test(detail)
  return {
    kind: notMounted ? 'not-mounted' : 'unreachable',
    title: notMounted ? 'backend not mounted yet' : 'backend unreachable',
    detail,
    hint: notMounted
      ? 'the local-model-deck API is not served by this gateway yet — enable the plugin and restart the backend'
      : 'the pane is loaded but its backend did not answer in time',
  }
}

// --------------------------------------------------------------------------- shared bits

let paneVisibleAtom = null
function paneVisible() {
  if (paneVisibleAtom) return paneVisibleAtom
  try {
    // Feature-detected: older SDKs have no paneVisibility, so fall back to always-visible and
    // let the poll interval stand. Never assume the atom exists.
    paneVisibleAtom =
      typeof host.paneVisibility === 'function' ? host.paneVisibility(PANE_ID) : atom(true)
  } catch (_err) {
    paneVisibleAtom = atom(true)
  }
  if (!paneVisibleAtom || typeof paneVisibleAtom.get !== 'function') paneVisibleAtom = atom(true)
  return paneVisibleAtom
}

function refresh(where) {
  try {
    queryClient.invalidateQueries({ queryKey: ['local-model-deck'] })
  } catch (_err) {
    /* nothing to invalidate: the queries will retry on their own interval */
  }
  return where
}

function useRuntimes(intervalMs) {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchRuntimes,
    refetchInterval: intervalMs,
    retry: 0,
  })
}

// --------------------------------------------------------------------------- status-bar chip

function DeckChip() {
  const query = useRuntimes(CHIP_POLL_MS)
  const status = deckStatus(query.data)
  const dotColor = status.tone === 'ok' ? 'var(--accent)' : 'var(--muted-foreground)'
  const title = query.isError
    ? `Local Model Deck — ${errorText(query.error)}`
    : `Local Model Deck — ${status.hint || status.text} (click to refresh)`
  return jsxs('button', {
    type: 'button',
    title,
    onClick: () => refresh('chip'),
    className:
      'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
    children: [
      jsx('span', {
        'aria-hidden': 'true',
        className: 'h-1.5 w-1.5 shrink-0 rounded-full',
        style: { background: dotColor },
      }),
      jsx('span', { children: status.text }),
      status.hint ? jsx('span', { className: 'opacity-70', children: status.hint }) : null,
    ],
  })
}

// --------------------------------------------------------------------------- pane pieces

function kv(label, value, title) {
  return jsxs('div', {
    className: 'flex items-baseline justify-between gap-2',
    children: [
      jsx('span', {
        className: 'text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]',
        children: label,
      }),
      jsx('span', {
        className: 'truncate text-[11px] tabular-nums text-[var(--foreground)]',
        title: title || undefined,
        children: value,
      }),
    ],
  })
}

function card(children) {
  return jsxs('div', {
    className: 'flex flex-col gap-1.5 rounded border border-[var(--border)] bg-[var(--card)] p-2',
    children,
  })
}

function note(text, tone) {
  return jsx('div', {
    className:
      tone === 'warn'
        ? 'text-[10px] leading-snug text-[var(--muted-foreground)]'
        : 'text-[10px] leading-snug text-[var(--muted-foreground)]',
    children: text,
  })
}

function backendCard(state) {
  if (!state) return null
  return card([
    jsxs('div', { className: 'flex items-center gap-1.5', children: [
      jsx('span', {
        'aria-hidden': 'true',
        className: 'h-1.5 w-1.5 rounded-full',
        style: { background: 'var(--muted-foreground)' },
      }),
      jsx('span', { className: 'text-[11px] font-semibold text-[var(--foreground)]', children: state.title }),
    ] }),
    note(state.detail),
    note(state.hint),
  ])
}

function runtimeCard(row, procQuery) {
  const process = processRow(procQuery && procQuery.data)
  const children = [
    jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
      jsxs('div', { className: 'flex items-center gap-1.5 min-w-0', children: [
        jsx('span', {
          'aria-hidden': 'true',
          className: 'h-2 w-2 shrink-0 rounded-full',
          style: { background: row.up ? 'var(--accent)' : 'var(--muted-foreground)' },
        }),
        jsx('span', {
          className: 'truncate text-[12px] font-semibold text-[var(--foreground)]',
          title: row.model || row.label,
          children: row.modelFile || row.label,
        }),
      ] }),
      jsx('span', {
        className: 'shrink-0 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]',
        children: row.up ? 'up' : 'down',
      }),
    ] }),
    row.ftype ? note(row.ftype) : null,
    row.error ? note(`probe: ${row.error}`, 'warn') : null,
    kv('ctx', row.nCtx),
    kv('slots', `${row.slotsText} busy`),
    kv('weights', row.sizeText),
    kv('params', row.paramsText),
    kv('endpoint', row.port ? `${row.host || '127.0.0.1'}:${row.port}` : '—'),
    kv('probe', row.probeMs === null ? '—' : `${Math.round(row.probeMs)} ms`),
  ]
  if (row.up) {
    children.push(
      jsxs('div', { className: 'mt-0.5 flex flex-col gap-0.5 border-t border-[var(--border)] pt-1.5', children: [
        kv('process', process.pidText),
        kv('rss', process.rssText),
        kv('uptime', process.uptimeText || '—'),
        kv('started', process.startedText || '—'),
        process.cmdline ? jsx('div', { className: 'mt-0.5 break-all text-[9px] leading-snug text-[var(--muted-foreground)]', children: process.cmdline }) : null,
        procQuery && procQuery.isError ? note(`process read failed: ${errorText(procQuery.error)}`, 'warn') : null,
        process.note ? note(process.note) : null,
      ] }),
    )
  }
  children.push(
    jsxs('div', { className: 'mt-0.5 flex flex-col gap-0.5 border-t border-[var(--border)] pt-1.5', children: [
      kv('metrics', row.metrics.label),
      note(row.metrics.note),
      row.metrics.raw ? note(`server said: ${row.metrics.raw}`) : null,
    ] }),
  )
  return card(children)
}

// --------------------------------------------------------------------------- pane

function DeckPane() {
  const visible = useValue(paneVisible())
  const runtimes = useRuntimes(visible ? PANE_POLL_MS : false)
  const data = runtimes.data
  const rows = data && Array.isArray(data.runtimes) ? data.runtimes : []
  const primary = rows.length ? runtimeRow(rows[0]) : null
  const others = rows.slice(1).map((r) => runtimeRow(r))
  const port = primary && primary.port ? primary.port : null

  const proc = useQuery({
    queryKey: ['local-model-deck', 'process', port],
    enabled: port !== null,
    queryFn: () => fetchProcess(port),
    refetchInterval: visible && port !== null ? PROCESS_POLL_MS : false,
    retry: 0,
  })

  const sampled = data && data.ts ? `sampled ${fmtClock(data.ts)}` : runtimes.isLoading ? 'probing…' : 'no sample yet'

  const body = []
  if (runtimes.isError) {
    body.push(backendCard(backendState(runtimes.error)))
  } else if (!data && runtimes.isLoading) {
    body.push(card([note('probing the configured runtime endpoints… (1 s budget per probe)')]))
  } else if (data && !rows.length) {
    body.push(card([
      jsx('div', { className: 'text-[11px] font-semibold text-[var(--foreground)]', children: 'no runtimes configured' }),
      note('the backend answered, but RUNTIME_ENDPOINTS in the plugin backend is empty — add a host:port there.'),
    ]))
  } else if (data) {
    if (!data.any_up) {
      body.push(card([
        jsx('div', { className: 'text-[11px] font-semibold text-[var(--foreground)]', children: 'no local runtime is up' }),
        note(data.note || 'nothing answered /health on the configured endpoints'),
        note('start llama-server (or add its endpoint to the plugin backend) and refresh.'),
      ]))
    }
    if (primary) body.push(runtimeCard(primary, proc))
    for (let i = 0; i < others.length; i += 1) {
      const other = others[i]
      body.push(card([
        jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
          jsx('span', { className: 'truncate text-[11px] text-[var(--foreground)]', children: other.modelFile || other.label }),
          jsx('span', { className: 'text-[10px] uppercase text-[var(--muted-foreground)]', children: other.up ? 'up' : 'down' }),
        ] }),
        kv('ctx', other.nCtx),
        kv('slots', `${other.slotsText} busy`),
      ]))
    }
    if (data.version) {
      body.push(note(`backend v${data.version} · read-only observer`))
    }
  }

  return jsxs('div', {
    className: 'flex h-full w-full flex-col gap-2 overflow-y-auto p-2 text-[11px] text-[var(--foreground)]',
    children: [
      jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
        jsxs('div', { className: 'flex min-w-0 flex-col', children: [
          jsx('div', {
            className: 'text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]',
            children: 'Local Model Deck',
          }),
          jsx('div', { className: 'text-[10px] text-[var(--muted-foreground)]', children: sampled }),
        ] }),
        jsx('button', {
          type: 'button',
          onClick: () => refresh('pane'),
          className:
            'shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
          children: 'refresh',
        }),
      ] }),
      body,
      jsx('div', {
        className: 'mt-auto text-[9px] leading-snug text-[var(--muted-foreground)]',
        children: 'auto-refresh 5s while visible · probes /health /props /slots /v1/models and /proc',
      }),
    ],
  })
}

// --------------------------------------------------------------------------- registration

export default {
  id: ID,
  name: 'Local Model Deck',
  description:
    'The deck for the local LLM runtimes on this machine: model, context, slots, RSS, process uptime and honest metrics state — instead of scrolling a terminal.',
  register(ctx) {
    ctxRest = (path, options) => ctx.rest(path, options)

    ctx.register({
      id: PANE_CONTRIB_ID,
      area: 'panes',
      title: 'Local Model Deck',
      data: { placement: 'right', width: '320px' },
      render: () => jsx(DeckPane, {}),
    })

    ctx.register({
      id: 'deck-chip',
      area: STATUSBAR_AREAS.right,
      order: 42,
      render: () => jsx(DeckChip, {}),
    })

    ctx.register({
      id: 'deck-refresh',
      area: PALETTE_AREA,
      data: {
        id: `${ID}.refresh`,
        label: 'Local Model Deck: refresh local runtime status',
        keywords: ['local', 'model', 'deck', 'llama', 'llama.cpp', 'bonsai', 'runtime', 'slots', 'vram', 'rss'],
        run: () => {
          refresh('palette')
          host.notify({ kind: 'info', message: 'Local Model Deck: re-probing the configured runtime endpoints.' })
        },
      },
    })
  },
}
