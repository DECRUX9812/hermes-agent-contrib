// Mission Control — a Hermes desktop plugin. A page that shows every chat as a star around
// Hermes: working chats flare and stream light to the core, chats that need you glow amber.
import { host, useValue } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const PATH = '/mission'
const AMBER = [242, 181, 59]

function useSessions() {
  const [rows, setRows] = useState([])
  useEffect(() => {
    let alive = true
    const load = () => host.request('session.list', { limit: 18 })
      .then(r => { if (alive) setRows((r && r.sessions) || []) })
      .catch(() => {})
    load()
    const id = setInterval(load, 3000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  return rows
}

// The theme accent as [r, g, b], whatever syntax the theme writes it in.
function accentOf(el) {
  const v = getComputedStyle(el).getPropertyValue('--ui-accent').trim() || '#7c5cff'
  const p = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  p.fillStyle = v; p.fillRect(0, 0, 1, 1)
  return [...p.getImageData(0, 0, 1, 1).data.slice(0, 3)]
}

function Sky({ rows, states }) {
  const canvas = useRef(null)
  const live = useRef({ rows, states })
  live.current = { rows, states }
  const hits = useRef([])

  useEffect(() => {
    const el = canvas.current, ctx = el.getContext('2d')
    let w = 0, h = 0, raf = 0, frames = 0, rgb = accentOf(el)
    const fit = () => { const d = devicePixelRatio || 1; w = el.clientWidth; h = el.clientHeight
      el.width = w * d; el.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0) }
    const ro = new ResizeObserver(fit); ro.observe(el); fit()
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const ink = getComputedStyle(el).getPropertyValue('--ui-text-tertiary').trim() || '#888'
    const c = (col, a) => `rgba(${col[0]},${col[1]},${col[2]},${a})`

    const frame = now => {
      if (++frames % 30 === 0) rgb = accentOf(el)
      const t = still ? 0 : now / 1000
      const { rows, states } = live.current
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42
      // Wide orbits, but never so wide that a star's label leaves the page.
      const RX = Math.min(R * 1.25, w / 2 - 170)
      // Orbits.
      ctx.strokeStyle = c(rgb, 0.12); ctx.lineWidth = 1
      for (const k of [0.55, 1]) { ctx.beginPath(); ctx.ellipse(cx, cy, RX * k, R * k, 0, 0, 7); ctx.stroke() }
      // Core.
      const anyWorking = rows.some(r => states[r.id] === 'working')
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90)
      core.addColorStop(0, c(rgb, anyWorking ? 0.9 : 0.6)); core.addColorStop(1, c(rgb, 0))
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, 90 + (anyWorking ? Math.sin(t * 4) * 8 : 0), 0, 7); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, 7); ctx.fill()

      hits.current = []
      rows.forEach((row, i) => {
        const inner = i % 2 === 0, k = inner ? 0.55 : 1
        const a = (i / Math.max(1, rows.length)) * Math.PI * 2 + t * (inner ? 0.06 : 0.035)
        const x = cx + Math.cos(a) * RX * k, y = cy + Math.sin(a) * R * k
        const st = states[row.id]
        const working = st === 'working', waiting = st === 'needs-input'
        const col = waiting ? AMBER : rgb
        if (working || waiting) {
          // A link to the core with light running along it.
          ctx.strokeStyle = c(col, 0.35); ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke()
          for (let p = 0; p < 3; p++) {
            const f = ((t * 0.9 + p / 3) % 1)
            ctx.fillStyle = c(col, 0.9); ctx.beginPath(); ctx.arc(x + (cx - x) * f, y + (cy - y) * f, 2.6, 0, 7); ctx.fill()
          }
          const ring = (t * 1.2) % 1
          ctx.strokeStyle = c(col, 0.6 * (1 - ring)); ctx.lineWidth = 2
          ctx.beginPath(); ctx.arc(x, y, 10 + ring * 26, 0, 7); ctx.stroke()
        }
        const glow = ctx.createRadialGradient(x, y, 0, x, y, working || waiting ? 26 : 14)
        glow.addColorStop(0, c(col, working || waiting ? 0.95 : 0.45)); glow.addColorStop(1, c(col, 0))
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 26, 0, 7); ctx.fill()
        ctx.fillStyle = working || waiting ? '#fff' : c(col, 0.8); ctx.beginPath(); ctx.arc(x, y, working || waiting ? 5 : 3.5, 0, 7); ctx.fill()
        const full = (row.title || row.preview || 'Untitled').replace(/\s+/g, ' ')
        const title = full.length > 26 ? full.slice(0, 25) + '…' : full
        ctx.font = `${working || waiting ? 600 : 500} 12px system-ui, sans-serif`
        ctx.fillStyle = working || waiting ? c(col, 1) : ink
        ctx.textAlign = x < cx ? 'right' : 'left'
        ctx.fillText(title, x + (x < cx ? -14 : 14), y + 4)
        hits.current.push({ id: row.id, x, y })
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  const open = e => {
    const r = canvas.current.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top
    const hit = hits.current.find(n => Math.hypot(n.x - x, n.y - y) < 18)
    if (hit) void host.openSession(hit.id)
  }
  return jsx('canvas', { ref: canvas, onClick: open, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' } })
}

function Page() {
  const rows = useSessions()
  const states = useValue(host.state.dotStateBySession) || {}
  const working = rows.filter(r => states[r.id] === 'working').length
  const waiting = rows.filter(r => states[r.id] === 'needs-input').length
  return jsxs('div', { style: { position: 'relative', height: '100%', minHeight: 420, overflow: 'hidden' }, children: [
    jsx(Sky, { rows, states }),
    jsxs('div', { style: { position: 'absolute', left: 24, top: 20, pointerEvents: 'none' }, children: [
      jsx('div', { style: { fontSize: 20, fontWeight: 800, letterSpacing: -0.4, color: 'var(--ui-text-primary)' }, children: 'Mission Control' }),
      jsx('div', { style: { fontSize: 12, marginTop: 4, color: 'var(--ui-text-tertiary)', fontVariantNumeric: 'tabular-nums' },
        children: `${working} working · ${waiting} need you · ${rows.length} chats` })
    ] })
  ] })
}

export default {
  id: 'mission-control',
  name: 'Mission Control',
  register(ctx) {
    ctx.register({ id: 'page', area: 'routes', title: 'Mission Control', data: { path: PATH }, render: () => jsx(Page, {}) })
    ctx.register({ id: 'nav', area: 'sidebar.nav', order: 40, data: { codicon: 'pulse', label: 'Mission Control', path: PATH } })
    ctx.register({ id: 'open', area: 'palette', data: { id: 'mission.open', label: 'Open Mission Control', keywords: ['agents', 'sessions'], run: () => host.navigate(PATH) } })
  }
}
