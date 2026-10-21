// Spend — a Hermes desktop plugin. A page that answers "what is this costing me?": the week's
// estimated spend, how much of what you sent was served from cache, and which models it went to.
// Numbers come from `insights.get {report: true}`, the same totals `/insights` prints.
import { host } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const PATH = '/spend'
const DAYS = 7
// Output, fresh input, cache: the theme accent plus two hues that read on light and dark.
const SLICES = [
  { key: 'total_output_tokens', label: 'Written back', color: 'var(--ui-accent)' },
  { key: 'total_input_tokens', label: 'Fresh input', color: '#3fc8ff' },
  { key: 'total_cache_read_tokens', label: 'Read from cache', color: '#f2b53b' }
]

const tokens = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)
const usd = n => `$${n.toFixed(2)}`

function useReport() {
  const [report, setReport] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => host.request('insights.get', { days: DAYS, report: true })
      .then(r => { if (alive) setReport((r && r.report) || { empty: true }) })
      .catch(() => { if (alive) setReport({ empty: true }) })
    load()
    const id = setInterval(load, 15000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  return report
}

// 0 → 1 over `ms` once mounted, eased, so the donut sweeps in and the total counts up.
function useIntro(ms = 1400) {
  const [k, setK] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0)
  useEffect(() => {
    if (k === 1) return
    let raf = 0; const t0 = performance.now()
    const step = now => { const f = Math.min(1, (now - t0) / ms); setK(1 - Math.pow(1 - f, 3)); if (f < 1) raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])
  return k
}

function Donut({ parts, k, center, sub }) {
  const size = 236, r = 92, c = 2 * Math.PI * r, total = parts.reduce((a, p) => a + p.value, 0) || 1
  let at = 0
  return jsxs('div', { style: { position: 'relative', width: size, height: size, flex: 'none' }, children: [
    jsxs('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, children: [
      jsx('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--ui-stroke-secondary)', strokeWidth: 26 }),
      ...parts.map(p => {
        const len = (p.value / total) * c * k, off = at; at += (p.value / total) * c * k
        return jsx('circle', { key: p.key, cx: size / 2, cy: size / 2, r, fill: 'none', stroke: p.color, strokeWidth: 26,
          strokeDasharray: `${Math.max(0, len - 3)} ${c}`, strokeDashoffset: -off, transform: `rotate(-90 ${size / 2} ${size / 2})` })
      })
    ] }),
    jsxs('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center' }, children: [
      jsx('div', { style: { fontSize: 40, fontWeight: 800, letterSpacing: -1.5, color: 'var(--ui-text-primary)', fontVariantNumeric: 'tabular-nums' }, children: center }),
      jsx('div', { style: { fontSize: 12, color: 'var(--ui-text-tertiary)' }, children: sub })
    ] })
  ] })
}

function Page() {
  const report = useReport()
  const k = useIntro()
  const wrap = children => jsx('div', { style: { height: '100%', overflow: 'auto' }, children:
    jsx('div', { style: { maxWidth: 880, margin: '0 auto', padding: '40px 32px', display: 'grid', gap: 28 }, children }) })
  const head = sub => jsxs('div', { children: [
    jsx('div', { style: { fontSize: 26, fontWeight: 800, letterSpacing: -0.6, color: 'var(--ui-text-primary)' }, children: 'Where the money goes' }),
    jsx('div', { style: { fontSize: 13, marginTop: 6, color: 'var(--ui-text-tertiary)' }, children: sub })
  ] })
  if (!report) return wrap([head('Adding it up…')])
  if (report.empty) return wrap([head(`Nothing spent in the last ${DAYS} days.`)])

  const o = report.overview
  const parts = SLICES.map(s => ({ ...s, value: o[s.key] || 0 }))
  const sent = (o.total_input_tokens || 0) + (o.total_cache_read_tokens || 0)
  const cached = sent ? Math.round((o.total_cache_read_tokens / sent) * 100) : 0
  const cost = o.actual_cost || o.estimated_cost || 0
  // Models under half a percent of the week's tokens are noise in a four-row summary.
  const models = report.models.filter(m => (m.total_tokens || 0) >= o.total_tokens * 0.005).sort((a, b) => (b.cost || 0) - (a.cost || 0) || b.total_tokens - a.total_tokens).slice(0, 4)
  const top = Math.max(...models.map(m => m.total_tokens || 0), 1)

  return wrap([
    head(`Last ${DAYS} days · ${o.total_sessions} chats · ${tokens(o.total_tokens)} tokens`),
    jsxs('div', { key: 'sum', style: { display: 'flex', alignItems: 'center', gap: 40, flexWrap: 'wrap' }, children: [
      jsx(Donut, { parts, k, center: `${Math.round(cached * k)}%`, sub: 'from cache' }),
      jsxs('div', { style: { display: 'grid', gap: 16, minWidth: 260 }, children: [
        jsxs('div', { children: [
          jsx('div', { style: { fontSize: 48, fontWeight: 800, letterSpacing: -2, color: 'var(--ui-text-primary)', fontVariantNumeric: 'tabular-nums' }, children: usd(cost * k) }),
          jsx('div', { style: { fontSize: 12, color: 'var(--ui-text-tertiary)' }, children: o.actual_cost ? 'billed' : 'estimated' })
        ] }),
        ...parts.map(p => jsxs('div', { key: p.key, style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--ui-text-secondary)' }, children: [
          jsx('span', { style: { width: 10, height: 10, borderRadius: 3, background: p.color } }),
          jsx('span', { style: { flex: 1 }, children: p.label }),
          jsx('span', { style: { fontWeight: 700, color: 'var(--ui-text-primary)', fontVariantNumeric: 'tabular-nums' }, children: tokens(p.value) })
        ] }))
      ] })
    ] }),
    cached > 0 && jsx('div', { key: 'note', style: { fontSize: 15, lineHeight: 1.5, color: 'var(--ui-text-secondary)', padding: '14px 18px',
      borderRadius: 14, border: '1px solid var(--ui-stroke-secondary)' }, children: [
      jsx('b', { style: { color: 'var(--ui-text-primary)' }, children: `${cached}% of what you sent came from cache. ` }),
      'Hermes keeps each conversation’s opening identical, so providers bill most of it at their cache rate.'
    ] }),
    jsxs('div', { key: 'models', style: { display: 'grid', gap: 12 }, children: [
      jsx('div', { style: { fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--ui-text-tertiary)' }, children: 'By model' }),
      ...models.map((m, i) => jsxs('div', { key: m.model, style: { display: 'grid', gridTemplateColumns: '200px 1fr 80px', alignItems: 'center', gap: 14, fontSize: 14 }, children: [
        jsx('span', { style: { color: 'var(--ui-text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: m.model }),
        jsx('span', { style: { height: 10, borderRadius: 5, background: 'var(--ui-stroke-secondary)', overflow: 'hidden' }, children:
          jsx('span', { style: { display: 'block', height: '100%', borderRadius: 5, background: SLICES[i % 3].color,
            width: `${((m.total_tokens || 0) / top) * 100 * Math.min(1, k * 1.2)}%` } }) }),
        jsx('span', { style: { textAlign: 'right', fontWeight: 700, color: 'var(--ui-text-primary)', fontVariantNumeric: 'tabular-nums' },
          children: m.has_pricing ? usd(m.cost || 0) : '—' })
      ] }))
    ] })
  ])
}

export default {
  id: 'spend',
  name: 'Spend',
  register(ctx) {
    ctx.register({ id: 'page', area: 'routes', title: 'Spend', data: { path: PATH }, render: () => jsx(Page, {}) })
    ctx.register({ id: 'nav', area: 'sidebar.nav', order: 41, data: { codicon: 'graph', label: 'Spend', path: PATH } })
    ctx.register({ id: 'open', area: 'palette', data: { id: 'spend.open', label: 'Where the money goes', keywords: ['cost', 'tokens', 'usage'], run: () => host.navigate(PATH) } })
  }
}
