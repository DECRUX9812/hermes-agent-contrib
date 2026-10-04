// Focus timer — a Hermes desktop plugin. The chat can place a live timer in a reply:
// ::timer{minutes="25" label="Deep work"} on its own line. Start, pause, and a status-bar chip.
import { atom, Tip, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

// One running timer at a time, shared by the in-chat card and the status-bar chip.
const $timer = atom(null) // { label, total, endsAt } | { label, total, left, paused: true }

const remaining = t => !t ? 0 : t.paused ? t.left : Math.max(0, t.endsAt - Date.now())
const clock = ms => { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }

function useTick(on) {
  const [, set] = useState(0)
  useEffect(() => { if (!on) return; const id = setInterval(() => set(n => n + 1), 250); return () => clearInterval(id) }, [on])
}

function Ring({ fraction, size = 168 }) {
  const r = size / 2 - 10, c = 2 * Math.PI * r
  return jsxs('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, style: { display: 'block' }, children: [
    jsx('defs', { children: jsxs('linearGradient', { id: 'ft-grad', x1: 0, y1: 0, x2: 1, y2: 1, children: [
      jsx('stop', { offset: '0%', stopColor: 'var(--ui-accent)' }),
      jsx('stop', { offset: '100%', stopColor: 'color-mix(in srgb, var(--ui-accent) 40%, #ffffff)' }) ] }) }),
    jsx('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--ui-stroke-secondary)', strokeWidth: 8 }),
    jsx('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'url(#ft-grad)', strokeWidth: 8, strokeLinecap: 'round',
      strokeDasharray: c, strokeDashoffset: c * (1 - fraction), transform: `rotate(-90 ${size / 2} ${size / 2})`,
      style: { transition: 'stroke-dashoffset .25s linear' } })
  ] })
}

function TimerCard({ attrs }) {
  const minutes = Math.min(180, Math.max(1, Number(attrs.minutes) || 25))
  const label = String(attrs.label || 'Focus').slice(0, 40)
  const total = minutes * 60000
  const t = useValue($timer)
  const mine = t && t.label === label
  const running = mine && !t.paused
  useTick(running)
  const left = mine ? remaining(t) : total
  const start = () => $timer.set(mine && t.paused ? { label, total, endsAt: Date.now() + t.left } : { label, total, endsAt: Date.now() + total })
  const pause = () => $timer.set({ label, total, left: remaining(t), paused: true })
  const btn = { font: '600 13px inherit', padding: '8px 16px', borderRadius: 999, border: 0, cursor: 'pointer',
    background: 'var(--ui-accent)', color: 'var(--ui-bg-elevated, #fff)' }

  return jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 22, margin: '10px 0', padding: '18px 22px',
    borderRadius: 18, border: '1px solid var(--ui-stroke-secondary)', maxWidth: 460 }, children: [
    jsxs('div', { style: { position: 'relative', width: 168, height: 168, flex: 'none' }, children: [
      jsx(Ring, { fraction: left / total }),
      jsx('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 34, fontWeight: 800,
        letterSpacing: -1, fontVariantNumeric: 'tabular-nums', color: 'var(--ui-text-primary)' }, children: clock(left) })
    ] }),
    jsxs('div', { style: { display: 'grid', gap: 10 }, children: [
      jsx('div', { style: { fontSize: 16, fontWeight: 700, color: 'var(--ui-text-primary)' }, children: label }),
      jsx('div', { style: { fontSize: 12, color: 'var(--ui-text-tertiary)' }, children: `${minutes} min · stays in your status bar` }),
      jsx('button', { type: 'button', style: btn, onClick: running ? pause : start, children: running ? 'Pause' : mine ? 'Resume' : 'Start' })
    ] })
  ] })
}

function Chip() {
  const t = useValue($timer)
  useTick(!!t && !t.paused)
  if (!t) return null
  return jsx(Tip, { label: t.label, children: jsx('span', { style: { display: 'inline-flex', alignItems: 'center', height: '100%',
    padding: '0 8px', fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--ui-accent)' },
    children: `◷ ${clock(remaining(t))}` }) })
}

export default {
  id: 'focus-timer',
  name: 'Focus timer',
  register(ctx) {
    ctx.register({ id: 'timer', area: 'transcript.directives', data: { name: 'timer', render: props => jsx(TimerCard, props) } })
    ctx.register({ id: 'chip', area: 'statusBar.right', order: 100, render: () => jsx(Chip, {}) })
  }
}
