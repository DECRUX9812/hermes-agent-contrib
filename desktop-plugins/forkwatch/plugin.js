/**
 * Fork Watch — visualize fork sync/update/gateway state in the desktop app.
 *
 * WHY: this checkout tracks Nous' origin/main while its work lives on fork/main;
 * the questions that keep coming up ("are we behind Nous?", "did the update
 * land?", "is the gateway healthy?", "what's pinned?") had no single surface.
 * This plugin answers all four on one route.
 *
 * DATA PATH — the sanctioned door only:
 *   ctx.rest('/state') → /api/plugins/forkwatch/state — the bundled Python
 *   backend (dashboard/plugin_api.py), read-only git + receipt/state/lockfile
 *   reads, cached ~15s server-side. No gateway RPC, no app REST routes.
 *
 * UNCOMPILED JSX RULES (this file loads raw — no bundler repairs it):
 *   - jsx()/jsxs() take children ONLY in props.children. The 3rd argument of
 *     jsx() is the KEY — children passed there are silently dropped (verified
 *     against react/jsx-runtime 19.2.7: they land in element.key, and
 *     props.children stays undefined).
 *   - NEVER pass null as props: jsx(Comp, null) throws "Cannot read properties
 *     of null (reading 'key')" in the production runtime. Pass {}.
 *   - jsx comes from react/jsx-runtime, NOT the SDK barrel (importing it there
 *     is a render-time ReferenceError, not a load error).
 *   - Only @hermes/plugin-sdk, react and react/jsx-runtime resolve.
 */

import { atom, host, PALETTE_AREA, PANES_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, STATUSBAR_AREAS, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'forkwatch'

// ── stores (module scope: one snapshot shared by chip + page) ───────────────

const $state = atom(null)
const $error = atom(null)
const $busy = atom(false)
let restFn = null

async function refresh() {
  if (!restFn) return
  $busy.set(true)
  try {
    $state.set(await restFn('/state'))
    $error.set(null)
  } catch (err) {
    $error.set(String((err && err.message) || err))
  } finally {
    $busy.set(false)
  }
}

// ── pure helpers (tested by tests/harness.test.mjs) ─────────────────────────

/** One-line statusbar verdict from a /state payload. */
export function verdict(state) {
  if (!state) return { tone: 'muted', text: '⑂ …' }
  const origin = (state.legs && state.legs.origin) || {}
  const fork = (state.legs && state.legs.fork) || {}
  if (!origin.exists) return { tone: 'warn', text: '⑂ no origin/main' }
  const behind = origin.behind || 0
  const unpushed = fork.ahead || 0
  if (behind > 0) return { tone: 'warn', text: '⑂ ' + behind + ' behind Nous' }
  if (unpushed > 0) return { tone: 'ok', text: '⑂ +' + unpushed + ' unpushed' }
  return { tone: 'ok', text: '⑂ in sync' }
}

/** Receipt outcome → visual tone. */
export function receiptTone(outcome) {
  return outcome === 'ok' ? 'ok'
    : outcome === 'failed' ? 'bad'
    : outcome === 'running' ? 'busy'
    : 'muted'
}

/** Days → compact human string (hours under a day, months over 30). */
export function fmtDays(days) {
  if (days == null || isNaN(days)) return '—'
  if (days < 1) return Math.max(1, Math.round(days * 24)) + 'h'
  if (days < 30) return Math.round(days) + 'd'
  return Math.round(days / 30) + 'mo'
}

/**
 * Diverging-bar geometry: behind extends LEFT of center, ahead RIGHT.
 * Returns left/right percentages of the half-width tracks + the scale max.
 */
export function barGeom(behind, ahead) {
  const b = Math.max(0, behind || 0)
  const a = Math.max(0, ahead || 0)
  const max = Math.max(b, a, 1)
  return { leftPct: (b / max) * 100, rightPct: (a / max) * 100, max }
}

// ── theme palette (all vars carry fallbacks for older hosts) ────────────────

const T = {
  text: 'var(--ui-text-primary)',
  dim: 'var(--ui-text-tertiary)',
  sub: 'var(--ui-text-secondary)',
  line: 'var(--ui-stroke-secondary)',
  card: 'var(--chrome-action-hover)',
  ok: 'var(--ui-text-success, #3fb950)',
  warn: 'var(--ui-text-warning, #fbbf24)',
  bad: 'var(--ui-text-danger, #fb4a6a)',
  accent: 'var(--ui-accent, #58a6ff)',
  muted: 'var(--ui-text-quaternary, #6e7681)',
}

const toneColor = (tone) =>
  tone === 'ok' ? T.ok : tone === 'bad' ? T.bad : tone === 'busy' ? T.accent : tone === 'warn' ? T.warn : T.muted

const s = {
  page: {
    height: '100%', overflow: 'auto', padding: '18px 20px 28px',
    display: 'flex', flexDirection: 'column', gap: '14px', color: T.text,
  },
  head: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' },
  h1: { margin: 0, fontSize: '15px', fontWeight: 650 },
  meta: { fontSize: '11px', color: T.dim, fontFamily: 'var(--font-mono, ui-monospace, monospace)' },
  badge: {
    fontSize: '10px', padding: '2px 7px', borderRadius: '999px', fontWeight: 600,
    border: '1px solid ' + T.line, color: T.sub, textTransform: 'uppercase', letterSpacing: '.05em',
  },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' },
  tile: {
    background: T.card, border: '1px solid ' + T.line, borderRadius: '10px',
    padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '2px',
  },
  tileLabel: { fontSize: '10px', color: T.dim, textTransform: 'uppercase', letterSpacing: '.08em' },
  tileValue: { fontSize: '22px', fontWeight: 700, lineHeight: 1.1 },
  tileSub: { fontSize: '11px', color: T.sub },
  card: {
    background: T.card, border: '1px solid ' + T.line, borderRadius: '10px', padding: '12px 14px',
    display: 'flex', flexDirection: 'column', gap: '10px',
  },
  cardTitle: { fontSize: '11px', fontWeight: 650, color: T.sub, textTransform: 'uppercase', letterSpacing: '.08em', margin: 0 },
  barRow: { display: 'flex', flexDirection: 'column', gap: '4px' },
  barLabel: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: T.sub },
  barTrack: {
    position: 'relative', height: '18px', borderRadius: '6px',
    background: 'var(--chrome-background, rgba(127,127,127,.08))', overflow: 'hidden',
  },
  barCenter: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: T.line },
  barL: { position: 'absolute', top: 0, bottom: 0, right: '50%', background: T.warn, opacity: 0.85, borderRadius: '4px 0 0 4px' },
  barR: { position: 'absolute', top: 0, bottom: 0, left: '50%', background: T.accent, opacity: 0.85, borderRadius: '0 4px 4px 0' },
  strip: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
  block: { width: '26px', height: '26px', borderRadius: '6px', border: '1px solid ' + T.line },
  rows: { display: 'flex', flexDirection: 'column', gap: '6px' },
  row: { display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '12px' },
  rowName: { minWidth: '86px', fontWeight: 600, color: T.text },
  rowMsg: { color: T.sub, wordBreak: 'break-word' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  chip: {
    fontSize: '11px', padding: '3px 8px', borderRadius: '6px', border: '1px solid ' + T.line,
    color: T.sub, fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  },
  btn: {
    fontSize: '11px', padding: '4px 10px', borderRadius: '7px', border: '1px solid ' + T.line,
    background: 'transparent', color: T.sub, cursor: 'pointer',
  },
  empty: { fontSize: '12px', color: T.dim, padding: '8px 0' },
}

// ── pieces (children ALWAYS in props — see file header) ─────────────────────

function Tile({ label, value, sub, tone }) {
  return jsxs('div', {
    style: s.tile,
    children: [
      jsx('span', { key: 'l', style: s.tileLabel, children: label }),
      jsx('span', { key: 'v', style: { ...s.tileValue, color: tone ? toneColor(tone) : T.text }, children: value }),
      sub ? jsx('span', { key: 's', style: s.tileSub, children: sub }) : null,
    ],
  })
}

function DivergingBar({ label, behind, ahead, rightNote }) {
  const g = barGeom(behind, ahead)
  return jsxs('div', {
    style: s.barRow,
    children: [
      jsxs('div', {
        key: 'lbl',
        style: s.barLabel,
        children: [
          jsx('span', { key: 'b', children: '⟵ ' + (behind == null ? '—' : behind) + ' behind' }),
          jsx('span', { key: 't', style: { fontWeight: 600, color: T.text }, children: label }),
          jsx('span', { key: 'a', children: (ahead == null ? '—' : ahead) + ' ahead ⟶' }),
        ],
      }),
      jsxs('div', {
        key: 'track',
        style: s.barTrack,
        title: rightNote || undefined,
        children: [
          behind > 0 ? jsx('div', { key: 'l', style: { ...s.barL, width: g.leftPct / 2 + '%' } }) : null,
          ahead > 0 ? jsx('div', { key: 'r', style: { ...s.barR, width: g.rightPct / 2 + '%' } }) : null,
          jsx('div', { key: 'c', style: s.barCenter }),
        ],
      }),
    ],
  })
}

function UpdateTimeline({ updates }) {
  const history = (updates && updates.history) || []
  if (!history.length) return jsx('div', { style: s.empty, children: 'No update receipts yet.' })
  const latest = (updates && updates.latest) || null
  return jsxs('div', {
    style: { display: 'flex', flexDirection: 'column', gap: '8px' },
    children: [
      jsxs('div', {
        key: 'strip',
        style: s.strip,
        children: history.map((r, i) => {
          const tone = receiptTone(r.outcome)
          const title = [r.outcome, r.started_at, (r.from_version || '?') + ' → ' + (r.to_version || '…'),
            r.skips ? r.skips + ' skipped' : ''].filter(Boolean).join(' · ')
          return jsx('div', { key: r.file || i, style: { ...s.block, background: toneColor(tone), opacity: 0.9 }, title })
        }),
      }),
      latest
        ? jsxs('div', {
            key: 'latest',
            style: { fontSize: '11px', color: T.sub, display: 'flex', gap: '8px', flexWrap: 'wrap' },
            children: [
              jsx('span', { key: 'o', style: { color: toneColor(receiptTone(latest.outcome)), fontWeight: 700 }, children: latest.outcome }),
              jsx('span', { key: 'v', children: (latest.from_version || '?') + ' → ' + (latest.to_version || 'in progress') }),
              latest.failed_steps && latest.failed_steps.length
                ? jsx('span', { key: 'f', style: { color: T.bad }, children: latest.failed_steps.length + ' failed step(s)' })
                : null,
              latest.skips ? jsx('span', { key: 's', children: latest.skips + ' skipped' }) : null,
            ],
          })
        : null,
    ],
  })
}

function GatewayCard({ gateway }) {
  if (!gateway) return null
  const platforms = Object.entries(gateway.platforms || {})
  return jsxs('div', {
    style: s.card,
    children: [
      jsxs('div', {
        key: 't',
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        children: [
          jsx('h3', { key: 'h', style: s.cardTitle, children: 'Gateway' }),
          jsx('span', {
            key: 'b',
            style: { ...s.badge,
                     color: gateway.alive ? (gateway.state === 'degraded' ? T.warn : T.ok) : T.bad,
                     borderColor: gateway.alive ? 'transparent' : T.bad },
            children: (gateway.state || '?') + (gateway.alive ? '' : ' (down)'),
          }),
        ],
      }),
      gateway.exit_reason
        ? jsx('div', { key: 'e', style: { fontSize: '11px', color: T.bad }, children: gateway.exit_reason })
        : null,
      !platforms.length
        ? jsx('div', { key: 'n', style: s.empty, children: 'No platform states reported.' })
        : jsxs('div', {
            key: 'p',
            style: s.rows,
            children: platforms.map(([name, info]) => {
              const tone = info.state === 'connected' ? 'ok'
                : info.state === 'retrying' ? 'busy'
                : info.state ? 'bad' : 'muted'
              return jsxs('div', { key: name, style: s.row, children: [
                jsx('span', { key: 'n', style: { ...s.rowName, color: toneColor(tone) }, children: name }),
                jsx('span', { key: 'm', style: s.rowMsg, children: info.error_message || info.state || '—' }),
              ] })
            }),
          }),
    ],
  })
}

function PinsCard({ pins }) {
  const entries = Object.entries(pins || {})
  if (!entries.length) return null
  return jsxs('div', {
    style: s.card,
    children: [
      jsx('h3', { key: 't', style: s.cardTitle, children: 'Pinned tools' }),
      jsxs('div', {
        key: 'c',
        style: s.chips,
        children: entries.map(([name, version]) =>
          jsx('span', { key: name, style: s.chip, title: name, children: name + ' ' + version })),
      }),
    ],
  })
}

function ForkWatchPage() {
  const state = useValue($state)
  const error = useValue($error)
  const busy = useValue($busy)

  const head = (state && state.head) || null
  const origin = (state && state.legs && state.legs.origin) || {}
  const fork = (state && state.legs && state.legs.fork) || {}
  const v = verdict(state)

  const header = jsxs('div', {
    style: s.head,
    children: [
      jsx('h1', { key: 'h', style: s.h1, children: 'Fork Watch' }),
      head ? jsx('span', { key: 'b', style: s.meta, children: state.repo + ' @ ' + head.branch + ' ' + head.short_sha }) : null,
      head ? jsx('span', {
        key: 'fa',
        style: { ...s.badge, color: head.fork_aware ? T.ok : T.warn },
        title: head.fork_aware
          ? "branch tracks '" + head.tracking_remote + "' — hermes update MERGES Nous' main in"
          : 'branch tracks origin — hermes update resets onto origin/main',
        children: head.fork_aware ? 'fork-aware update' : 'reset-path update',
      }) : null,
      head && head.dirty_files
        ? jsx('span', { key: 'd', style: { ...s.badge, color: T.warn }, children: head.dirty_files + ' dirty' })
        : null,
      jsx('button', {
        key: 'r',
        type: 'button',
        style: s.btn,
        disabled: busy,
        onClick: () => refresh(),
        children: busy ? '…' : 'refresh',
      }),
      jsx('span', { key: 'v', style: { ...s.meta, color: toneColor(v.tone) }, children: v.text }),
    ],
  })

  if (!state && !error) {
    return jsxs('div', {
      style: s.page,
      children: [header, jsx('div', { key: 'w', style: s.empty, children: 'Loading fork state…' })],
    })
  }
  if (!state && error) {
    return jsxs('div', {
      style: s.page,
      children: [
        header,
        jsx('div', {
          key: 'e',
          style: { fontSize: '12px', color: T.bad },
          children: 'Backend not reachable yet (' + error + '). If this is a fresh install, the webapp service may still be starting — the panel refreshes every 30s.',
        }),
      ],
    })
  }

  const originDays = origin.staleness_days
  const est = origin.est_days_of_upstream

  return jsxs('div', {
    style: s.page,
    children: [
      header,

      // stat tiles
      jsxs('div', {
        key: 'tiles',
        style: s.tiles,
        children: [
          jsx(Tile, { key: 'o', label: 'Behind Nous main', value: origin.behind == null ? '—' : String(origin.behind),
                      sub: 'commits', tone: origin.behind > 0 ? 'warn' : 'ok' }),
          jsx(Tile, { key: 'a', label: 'Ahead of Nous main', value: origin.ahead == null ? '—' : String(origin.ahead),
                      sub: "fork's own commits" }),
          jsx(Tile, { key: 's', label: 'Nous staleness', value: fmtDays(originDays),
                      sub: origin.rate_7d ? origin.rate_7d + ' commits/7d upstream' : 'tip age', tone: 'muted' }),
          jsx(Tile, { key: 'f', label: 'vs fork/main',
                      value: (fork.ahead == null ? '—' : '+' + fork.ahead) + ' / ' + (fork.behind == null ? '—' : '−' + fork.behind),
                      sub: 'ahead / behind', tone: fork.behind > 0 ? 'warn' : 'ok' }),
          jsx(Tile, { key: 'e', label: 'Sync effort', value: est == null ? '—' : '~' + fmtDays(est),
                      sub: 'days of Nous to absorb', tone: est > 3 ? 'warn' : 'ok' }),
        ],
      }),

      // divergence bars
      jsxs('div', {
        key: 'bars',
        style: s.card,
        children: [
          jsx('h3', { key: 't', style: s.cardTitle, children: 'Divergence' }),
          jsx(DivergingBar, { key: 'f', label: 'fork/main', behind: fork.behind, ahead: fork.ahead,
                              rightNote: 'your work relative to your published fork' }),
          jsx(DivergingBar, { key: 'o', label: 'origin/main (Nous)', behind: origin.behind, ahead: origin.ahead,
                              rightNote: "commits Nous has that you don't (left) / your fork's divergence (right)" }),
          jsx('div', { key: 'n', style: { fontSize: '10px', color: T.dim },
                       children: 'Left of center = missing from you ⟵ · Right of center = yours only ⟶' }),
        ],
      }),

      // update history
      jsxs('div', { key: 'u', style: s.card, children: [
        jsx('h3', { key: 't', style: s.cardTitle, children: 'Update history' }),
        jsx(UpdateTimeline, { key: 'l', updates: state.updates }),
      ] }),

      jsx(GatewayCard, { key: 'g', gateway: state.gateway }),
      jsx(PinsCard, { key: 'p', pins: state.pins }),
    ],
  })
}

function Chip() {
  const v = verdict(useValue($state))
  return jsx('span', {
    title: 'Fork Watch — click to open',
    style: { fontSize: '11px', color: toneColor(v.tone), cursor: 'pointer', whiteSpace: 'nowrap' },
    onClick: () => host.navigate('/forkwatch'),
    children: v.text,
  })
}

function Pane() {
  return jsx('div', {
    style: { height: '100%', overflow: 'auto' },
    children: jsx(ForkWatchPage, {}),
  })
}

// ── plugin ──────────────────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'Fork Watch',
  description: 'Fork sync, update receipts, gateway health and pins on one dashboard.',
  version: '1.0.1',
  defaultEnabled: true,

  register(ctx) {
    restFn = (path, opts) => ctx.rest(path, opts)
    refresh()
    ctx.setInterval(refresh, 30_000)

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/forkwatch' },
        render: () => jsx(ForkWatchPage, {}),
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: '/forkwatch', label: 'Fork Watch', codicon: 'git-branch' },
      },
      {
        id: 'chip',
        area: STATUSBAR_AREAS.right,
        render: () => jsx(Chip, {}),
      },
      {
        id: 'pane',
        area: PANES_AREA,
        data: { placement: 'right', width: '420px', title: 'Fork Watch' },
        render: () => jsx(Pane, {}),
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'forkwatch.open',
          label: 'Fork Watch: open dashboard',
          keywords: ['fork', 'sync', 'update', 'divergence', 'nous', 'receipts', 'gateway'],
          run: () => host.navigate('/forkwatch'),
        },
      },
    ])
  },
}
