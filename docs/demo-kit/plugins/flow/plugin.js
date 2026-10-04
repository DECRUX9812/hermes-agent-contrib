// Flow — a Hermes desktop plugin. The chat draws a flow you can change where it stands:
// ::flow{title="Launch plan" steps="Draft|Review|Ship"} on its own line. Click a step to rename it,
// press + between two steps to add one, × to drop one. The drawing re-lays itself out as you go.
import { useLayoutEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

// Edits survive the reply re-rendering (stream settle, scrolling back), keyed by what the chat drew.
const edited = new Map()
let uid = 0
const node = label => ({ id: ++uid, label })

const STYLE = `
@keyframes fl-in { from { opacity: 0; transform: scale(.6) } to { opacity: 1; transform: none } }
@keyframes fl-draw { from { stroke-dashoffset: 40 } to { stroke-dashoffset: 0 } }
.fl-step { animation: fl-in .45s cubic-bezier(.2,.9,.3,1.25) both; transition: transform .45s cubic-bezier(.2,.9,.3,1) }
.fl-arrow path { stroke-dasharray: 40; animation: fl-draw .5s ease-out both }
.fl-gap { position: relative; width: 56px; flex: none; display: grid; place-items: center }
.fl-add { position: absolute; width: 24px; height: 24px; border-radius: 50%; border: 0; cursor: pointer; opacity: 0;
  font: 700 15px/24px system-ui; background: var(--ui-accent); color: var(--ui-bg-elevated, #fff); transition: opacity .15s, transform .15s }
.fl-gap:hover .fl-add, .fl-add:focus-visible { opacity: 1; transform: scale(1.1) }
.fl-x { position: absolute; top: -9px; right: -9px; width: 20px; height: 20px; border-radius: 50%; border: 0; cursor: pointer;
  opacity: 0; font: 700 12px/20px system-ui; background: var(--ui-text-tertiary); color: var(--ui-bg-elevated, #fff) }
.fl-step:hover .fl-x, .fl-x:focus-visible { opacity: 1 }
@media (prefers-reduced-motion: reduce) { .fl-step, .fl-arrow path { animation: none } }`

function Step({ step, first, last, onRename, onRemove, editing, setEditing }) {
  const input = useRef(null)
  useLayoutEffect(() => { if (editing) { input.current.focus(); input.current.select() } }, [editing])
  const box = { position: 'relative', minWidth: 112, padding: '14px 18px', borderRadius: first || last ? 999 : 14, textAlign: 'center',
    fontSize: 14, fontWeight: 650, color: last ? 'var(--ui-bg-elevated, #fff)' : 'var(--ui-text-primary)',
    background: last ? 'var(--ui-accent)' : 'color-mix(in srgb, var(--ui-accent) 12%, transparent)',
    border: '1.5px solid color-mix(in srgb, var(--ui-accent) 60%, transparent)', cursor: 'text' }
  return jsxs('div', { className: 'fl-step', style: box, onClick: () => setEditing(step.id), children: [
    editing
      ? jsx('input', { ref: input, defaultValue: step.label, 'aria-label': 'Step name', size: Math.max(6, step.label.length),
          style: { all: 'unset', textAlign: 'center', width: '100%' },
          onBlur: e => { onRename(e.target.value); setEditing(null) },
          onKeyDown: e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() } })
      : step.label,
    jsx('button', { type: 'button', className: 'fl-x', 'aria-label': `Remove ${step.label}`, onClick: e => { e.stopPropagation(); onRemove() }, children: '×' })
  ] })
}

function Arrow({ onAdd }) {
  return jsxs('div', { className: 'fl-gap', children: [
    jsx('svg', { className: 'fl-arrow', width: 56, height: 16, viewBox: '0 0 56 16', children:
      jsx('path', { d: 'M4 8 H48 M42 3 L49 8 L42 13', fill: 'none', stroke: 'color-mix(in srgb, var(--ui-accent) 70%, transparent)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }) }),
    jsx('button', { type: 'button', className: 'fl-add', 'aria-label': 'Add a step here', onClick: onAdd, children: '+' })
  ] })
}

function Flow({ attrs }) {
  const source = String(attrs.steps || '')
  const [steps, setSteps] = useState(() => edited.get(source) || source.split('|').map(s => s.trim()).filter(Boolean).slice(0, 12).map(node))
  const [editing, setEditing] = useState(null)
  const save = next => { edited.set(source, next); setSteps(next) }
  const children = []
  steps.forEach((step, i) => {
    if (i) children.push(jsx(Arrow, { key: `a${step.id}`, onAdd: () => { const n = node('New step'); save([...steps.slice(0, i), n, ...steps.slice(i)]); setEditing(n.id) } }))
    children.push(jsx(Step, { key: step.id, step, first: i === 0, last: i === steps.length - 1, editing: editing === step.id, setEditing,
      onRename: label => save(steps.map(s => s.id === step.id ? { ...s, label: label.trim() || s.label } : s)),
      onRemove: () => steps.length > 2 && save(steps.filter(s => s.id !== step.id)) }))
  })
  return jsxs('div', { style: { margin: '12px 0', padding: '18px 20px 22px', borderRadius: 18, border: '1px solid var(--ui-stroke-secondary)' }, children: [
    jsx('style', { children: STYLE }),
    jsxs('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }, children: [
      jsx('span', { style: { fontSize: 15, fontWeight: 750, color: 'var(--ui-text-primary)' }, children: String(attrs.title || 'Flow').slice(0, 60) }),
      jsx('span', { style: { fontSize: 12, color: 'var(--ui-text-tertiary)' }, children: 'click a step to rename · + to add' })
    ] }),
    jsx('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 14 }, children })
  ] })
}

export default {
  id: 'flow',
  name: 'Flow',
  register(ctx) {
    ctx.register({ id: 'flow', area: 'transcript.directives', data: { name: 'flow', render: props => jsx(Flow, props) } })
  }
}
