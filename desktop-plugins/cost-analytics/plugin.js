// cost-analytics — extracted from the fork's app/command-center/cost-analytics.ts as a plugin, not a core patch.
//
// WHY A PLUGIN: the fork carries this as a core file, which means every merge
// against upstream carries the diff and every reviewer re-litigates it. This
// reimplements the capability through a documented contribution seam so it ships
// independently and survives upstream sync.
//
// DATA PATH (per the SDK's reachability rule): a plugin with no Python backend
// reaches the backend ONLY through host.request (gateway JSON-RPC). ctx.rest is
// namespace-scoped to /api/plugins/<id> and cannot reach app REST routes, so any
// capability that lives only on an app route is deliberately OMITTED rather than
// shipped as a control that silently does nothing.
//
// Only @hermes/plugin-sdk, react and react/jsx-runtime resolve here. The file is
// uncompiled: jsx() calls, never JSX syntax.

import { PANES_AREA, PALETTE_AREA, useValue, host } from '@hermes/plugin-sdk'
import { jsx } from 'react/jsx-runtime'

const PANE_ID = 'cost-analytics'
const ROUTE = '/plugins/cost-analytics'

function money(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  if (n < 0.01) return '<' + '$0.01'
  if (n < 100) return '$' + n.toFixed(2)
  return '$' + Math.round(n).toLocaleString('en-US')
}

/** Pure: fold a usage payload into the rows the pane renders. */
export function buildRows(usage) {
  if (!usage || typeof usage !== 'object') return []
  const byModel = usage.by_model || usage.byModel || {}
  const rows = Object.keys(byModel).map((k) => {
    const v = byModel[k] || {}
    const cost = typeof v.cost === 'number' ? v.cost : (typeof v.total_cost === 'number' ? v.total_cost : null)
    const tokens = typeof v.tokens === 'number' ? v.tokens : (typeof v.total_tokens === 'number' ? v.total_tokens : null)
    return { model: k, cost, tokens }
  })
  // Priced first, then biggest spend, then name — a stable, scannable order.
  rows.sort((a, b) => {
    const ac = a.cost == null ? -1 : a.cost
    const bc = b.cost == null ? -1 : b.cost
    if (bc !== ac) return bc - ac
    return a.model.localeCompare(b.model)
  })
  return rows
}

export function totals(rows) {
  let cost = 0, costKnown = false, tokens = 0
  for (const r of rows) {
    if (r.cost != null) { cost += r.cost; costKnown = true }
    if (r.tokens != null) tokens += r.tokens
  }
  return { cost: costKnown ? cost : null, tokens }
}

let cache = null
let inflight = null

async function load() {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const usage = await host.request('usage.report', {})
      cache = buildRows(usage)
    } catch {
      cache = []
    } finally {
      inflight = null
    }
    return cache
  })()
  return inflight
}

const s = {
  wrap: { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px', height: '100%', overflow: 'auto' },
  h: { margin: '0', fontSize: '13px', fontWeight: '600', color: 'var(--ui-text-primary)' },
  sub: { margin: '0', fontSize: '11px', color: 'var(--ui-text-tertiary)' },
  sum: { display: 'flex', gap: '18px', padding: '10px 12px', borderRadius: '10px', background: 'var(--chrome-action-hover)' },
  big: { fontSize: '20px', fontWeight: '600', color: 'var(--ui-text-primary)' },
  lbl: { fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--ui-text-tertiary)' },
  row: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '7px 0', borderTop: '1px solid var(--ui-stroke-secondary)', fontSize: '12px' },
  name: { color: 'var(--ui-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  amt: { color: 'var(--ui-text-secondary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  empty: { fontSize: '12px', color: 'var(--ui-text-tertiary)', padding: '8px 0' },
}

function CostPane() {
  const rows = useValue(load())
  const t = totals(rows)
  return jsx('div', { style: s.wrap },
    jsx('div', null,
      jsx('h3', { style: s.h }, 'Spend by model'),
      jsx('p', { style: s.sub }, 'Auxiliary and main-model calls, priced.')),
    jsx('div', { style: s.sum },
      jsx('div', null, jsx('div', { style: s.lbl }, 'Total'), jsx('div', { style: s.big }, money(t.cost) || '—')),
      jsx('div', null, jsx('div', { style: s.lbl }, 'Tokens'), jsx('div', { style: s.big }, t.tokens ? t.tokens.toLocaleString('en-US') : '—'))),
    rows.length === 0
      ? jsx('div', { style: s.empty }, 'No priced usage reported yet.')
      : rows.map((r) => jsx('div', { key: r.model, style: s.row },
          jsx('span', { style: s.name, title: r.model }, r.model),
          jsx('span', { style: s.amt }, money(r.cost) || '—'))),
  )
}

export default {
  id: 'cost-analytics',
  name: 'Cost Analytics',
  description: 'Pane and command showing spend per model.',
  version: '1.0.0',
  defaultEnabled: false,
  register(ctx) {
    ctx.contribution(PANES_AREA, {
      id: PANE_ID,
      placement: 'right',
      title: 'Cost',
      render: () => jsx(CostPane, null),
    })
    ctx.contribution(PALETTE_AREA, {
      id: 'cost-analytics.open',
      label: 'Cost Analytics',
      keywords: ['cost', 'spend', 'usage', 'tokens', 'money'],
      // `navigate` is not exported by the shipped SDK module the browser loader
      // builds, so importing it failed the whole plugin at load time ("does not
      // provide an export named 'navigate'") and the app showed a permanent
      // error toast. Routing here is a hash route, so set it directly.
      run: () => {
        window.location.hash = `#${ROUTE}`
      },
    })
    ctx.contribution(PALETTE_AREA, {
      id: 'cost-analytics.pane',
      label: 'Show Cost Pane',
      keywords: ['cost', 'pane'],
      run: () => host.notify('Use the pane layout to place the Cost pane.'),
    })
  },
}
