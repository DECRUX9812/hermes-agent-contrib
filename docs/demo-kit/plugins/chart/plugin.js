// Chart — a Hermes desktop plugin. Teaches the chat to draw: the assistant writes
// ::chart{title="Signups" values="12,18,25" labels="Mon,Tue,Wed"} on its own line.
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const CSS = `@keyframes hermes-chart-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes hermes-chart-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`

function numbers(raw) {
  return String(raw || '').split(',').map(v => Number(v.trim())).filter(v => Number.isFinite(v) && v >= 0).slice(0, 14)
}

function useCount(to, ms = 1200) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = now => {
      const k = Math.min(1, (now - start) / ms)
      setN(Math.round(to * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, ms])
  return n
}

function Chart({ attrs, streaming }) {
  const values = numbers(attrs.values)
  const labels = String(attrs.labels || '').split(',').map(s => s.trim())
  const total = values.reduce((a, b) => a + b, 0)
  const shown = useCount(streaming ? 0 : total)
  if (!values.length) return null
  const max = Math.max(...values)
  const first = values[0] || 1
  const growth = Math.round(((values[values.length - 1] - first) / first) * 100)

  return jsxs('div', {
    style: { margin: '10px 0', padding: '16px 18px', borderRadius: 14, border: '1px solid var(--ui-stroke-secondary)', background: 'var(--ui-bg-elevated, transparent)', maxWidth: 520 },
    children: [
      jsx('style', { children: CSS }),
      jsxs('div', {
        style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
        children: [
          jsxs('div', { children: [
            jsx('div', { style: { fontSize: 12, color: 'var(--ui-text-tertiary)' }, children: attrs.title || 'Chart' }),
            jsx('div', { style: { fontSize: 30, fontWeight: 800, letterSpacing: -1, fontVariantNumeric: 'tabular-nums', color: 'var(--ui-text-primary)' }, children: shown.toLocaleString() })
          ] }),
          growth > 0 && jsx('div', {
            style: { fontSize: 13, fontWeight: 700, color: 'var(--ui-green, #16a34a)', animation: 'hermes-chart-fade .5s ease-out 1s both' },
            children: `▲ ${growth}%`
          })
        ]
      }),
      jsx('div', {
        style: { display: 'flex', alignItems: 'flex-end', gap: 8, height: 120, marginTop: 14 },
        children: values.map((v, i) => jsxs('div', {
          key: i,
          style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' },
          children: [
            jsx('div', {
              style: {
                width: '100%', height: `${Math.max(4, (v / max) * 100)}%`, borderRadius: 6,
                background: 'linear-gradient(180deg, var(--ui-accent), color-mix(in srgb, var(--ui-accent) 35%, transparent))',
                transformOrigin: 'bottom', animation: `hermes-chart-grow .7s cubic-bezier(.2,.9,.25,1.15) ${i * 0.09}s both`
              }
            }),
            jsx('div', { style: { fontSize: 10, color: 'var(--ui-text-quaternary)' }, children: labels[i] || '' })
          ]
        }))
      })
    ]
  })
}

export default {
  id: 'chart',
  name: 'Chart',
  register(ctx) {
    ctx.register({ id: 'chart', area: 'transcript.directives', data: { name: 'chart', render: props => jsx(Chart, props) } })
  }
}
