// Pulse — a Hermes desktop plugin. An orb of light that idles while Hermes waits
// and flares while it thinks. Remixed on request: gold, twice as fast, denser.
import { host, Tip, useValue } from '@hermes/plugin-sdk'
import { useEffect, useRef } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const N = 340
const GOLD = [242, 181, 59]
const SPEED = 2
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

// Points spread evenly over a sphere (Fibonacci lattice).
const POINTS = Array.from({ length: N }, (_, i) => {
  const y = 1 - (i / (N - 1)) * 2
  const r = Math.sqrt(1 - y * y)
  const a = i * GOLDEN
  return { x: Math.cos(a) * r, y, z: Math.sin(a) * r, seed: (i * 9301 + 49297) % 233280 / 233280 }
})

// The theme accent as [r, g, b], whatever color syntax the theme uses.
function accent(el) {
  const v = getComputedStyle(el).getPropertyValue('--ui-accent').trim() || '#7c5cff'
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  probe.fillStyle = v
  probe.fillRect(0, 0, 1, 1)
  return [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)]
}

function Orb() {
  const busy = useValue(host.state.busy)
  const canvas = useRef(null)
  const energy = useRef({ target: 0, now: 0 })
  energy.current.target = busy ? 1 : 0

  useEffect(() => {
    const el = canvas.current
    const ctx = el.getContext('2d')
    let w = 0, h = 0, raf = 0, t = 0
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      w = el.clientWidth; h = el.clientHeight
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el); fit()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Re-read the accent now and then so a theme switch recolors the orb.
    let rgb = GOLD, frames = 0
    const rgba = a => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`

    const frame = () => {
      const e = energy.current
      e.now += (e.target - e.now) * 0.05
      t += still ? 0 : (0.006 + e.now * 0.03) * SPEED
      ctx.clearRect(0, 0, w, h)
      const R = Math.min(w, h) * (0.3 + e.now * 0.05 + Math.sin(t * 3) * 0.01 * (1 + e.now * 3))
      const cx = w / 2, cy = h / 2
      const cos = Math.cos(t), sin = Math.sin(t), tilt = 0.45

      // A soft core that brightens with thought.
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6)
      glow.addColorStop(0, rgba(0.18 + e.now * 0.3))
      glow.addColorStop(1, rgba(0))
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, h)

      const pts = POINTS.map(p => {
        const wobble = 1 + e.now * 0.18 * Math.sin(t * 6 + p.seed * 12)
        let x = p.x * cos - p.z * sin, z = p.x * sin + p.z * cos
        let y = p.y * Math.cos(tilt) - z * Math.sin(tilt)
        z = p.y * Math.sin(tilt) + z * Math.cos(tilt)
        return { sx: cx + x * R * wobble, sy: cy + y * R * wobble, z }
      })
      // Thinking draws the lattice together.
      if (e.now > 0.05) {
        ctx.strokeStyle = rgba(1)
        ctx.lineWidth = 0.6
        for (let i = 0; i < N; i += 2) {
          const a = pts[i], b = pts[(i + 21) % N]
          if (a.z < -0.1 || b.z < -0.1) continue
          ctx.globalAlpha = e.now * 0.35 * (a.z + 1) / 2
          ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
        }
      }
      ctx.fillStyle = rgba(1)
      for (const p of pts) {
        ctx.globalAlpha = 0.25 + 0.75 * (p.z + 1) / 2
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 1 + (p.z + 1) * (0.9 + e.now * 0.9), 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return jsxs('div', {
    style: { position: 'relative', height: '100%', minHeight: 220 },
    children: [
      jsx('canvas', { ref: canvas, style: { position: 'absolute', inset: 0, width: '100%', height: '100%' } }),
      jsx('div', {
        style: { position: 'absolute', left: 0, right: 0, bottom: 10, textAlign: 'center', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--ui-text-quaternary)' },
        children: busy ? 'thinking' : 'listening'
      })
    ]
  })
}

function Chip() {
  const busy = useValue(host.state.busy)
  return jsx(Tip, {
    label: busy ? 'Hermes is thinking' : 'Hermes is listening',
    children: jsx('span', {
      style: { display: 'inline-flex', alignItems: 'center', gap: 6, height: '100%', padding: '0 8px', fontSize: 11, color: 'var(--ui-text-tertiary)' },
      children: jsx('span', {
        style: { width: 8, height: 8, borderRadius: 999, background: 'var(--ui-accent)', boxShadow: busy ? '0 0 10px var(--ui-accent)' : 'none', opacity: busy ? 1 : 0.55, transition: 'all .4s' }
      })
    })
  })
}

export default {
  id: 'pulse',
  name: 'Pulse',
  register(ctx) {
    ctx.register({ id: 'orb', area: 'panes', title: 'Pulse', data: { placement: 'floating', anchor: 'top-right', width: '240px', height: '250px' }, render: () => jsx(Orb, {}) })
    ctx.register({ id: 'chip', area: 'statusBar.right', order: 110, render: () => jsx(Chip, {}) })
  }
}
