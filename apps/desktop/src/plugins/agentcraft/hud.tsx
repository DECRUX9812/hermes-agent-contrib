/** Studio HUD overlays: agent chips, goal chip, decision banner, feed ticker, controls. */

import { useEffect, useState } from 'react'

import type { SimDecision, SimStore } from './model'
import type { StudioScene } from './scene'
import { CAMERA_PRESETS } from './scene'

function useTick(ms = 500): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN(v => v + 1), ms)

    return () => clearInterval(t)
  }, [ms])

  return n
}

export function AgentChips({ store, onFocus, onOpen }: { store: SimStore; onFocus: (id: string) => void; onOpen: (id: string) => void }) {
  useTick(400)

  return (
    <div className="ac-chips">
      {[...store.agents.values()].map(a => (
        <button
          aria-label={`${a.name}: ${a.activity.replace('_', ' ')}${a.detail ? `, ${a.detail}` : ''}`}
          className={`ac-chip ac-act-${a.activity}`}
          key={a.id}
          onClick={() => onFocus(a.id)}
          onDoubleClick={() => onOpen(a.id)}
        >
          <span className="ac-chip-dot" style={{ background: a.color }} />
          <span className="ac-chip-name">{a.name}</span>
          <span className="ac-chip-state">{a.activity.replace('_', ' ')}</span>
        </button>
      ))}
    </div>
  )
}

export function GoalChip({ store, onClick }: { store: SimStore; onClick: () => void }) {
  useTick(600)
  const g = store.goal

  if (!g) {return null}

  return (
    <button aria-label={g.text} className="ac-goal" onClick={onClick}>
      <span className="ac-goal-label">GOAL</span>
      <span className="ac-goal-text">{g.text.slice(0, 64)}{g.text.length > 64 ? '…' : ''}</span>
      <span className={`ac-goal-pill ac-goal-${g.status}`}>{g.status}</span>
    </button>
  )
}

export function DecisionBanner({ store, onOpen }: { store: SimStore; onOpen: (d: SimDecision) => void }) {
  useTick(500)
  const open = [...store.decisions.values()].filter(d => d.status === 'open')

  if (open.length === 0) {return null}
  const d = open[0]

  return (
    <button className="ac-decision-banner" onClick={() => onOpen(d)}>
      <span className="ac-decision-kind">{d.kind === 'merge' ? 'MERGE REQUEST' : d.kind.toUpperCase()}</span>
      <span className="ac-decision-q">{d.question.length > 90 ? d.question.slice(0, 90) + '…' : d.question}</span>
      <span className="ac-decision-count">{open.length > 1 ? `+${open.length - 1} more` : 'answer'}</span>
    </button>
  )
}

export function FeedTicker({ store }: { store: SimStore }) {
  useTick(600)
  const items = store.feed.slice(-4)

  return (
    <div className="ac-feed">
      {items.map((f, i) => (
        <div className={`ac-feed-item ac-feed-${f.kind}`} key={`${f.t}-${i}`}>
          {f.text}
        </div>
      ))}
    </div>
  )
}

export function Controls({ scene, autoAnswer, setAutoAnswer, initialTime = 'golden', initialSpeed = 1.6 }: { scene: StudioScene; autoAnswer: boolean; setAutoAnswer: (v: boolean) => void; initialTime?: 'day' | 'golden' | 'night'; initialSpeed?: number }) {
  const [speed, setSpeed] = useState(initialSpeed)
  const [time, setTime] = useState<'day' | 'golden' | 'night'>(initialTime)

  return (
    <div className="ac-controls">
      <select aria-label="camera" className="ac-select" defaultValue="" onChange={e => scene.flyTo(e.target.value)}>
        <option disabled value="">
          Camera
        </option>
        {CAMERA_PRESETS.map(p => (
          <option key={p.name} value={p.name}>
            {p.name.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      <select
        aria-label="time"
        className="ac-select"
        onChange={e => {
          const v = e.target.value as 'day' | 'golden' | 'night'
          setTime(v)
          scene.setTime(v)
        }}
        value={time}
      >
        <option value="golden">golden hour</option>
        <option value="day">day</option>
        <option value="night">night</option>
      </select>
      <label className="ac-speed">
        <span>{speed.toFixed(1)}×</span>
        <input
          max={8}
          min={0.5}
          onChange={e => {
            const v = Number(e.target.value)
            setSpeed(v)
            scene.setSpeed(v)
          }}
          step={0.5}
          type="range"
          value={speed}
        />
      </label>
      <label className="ac-auto">
        <input checked={autoAnswer} onChange={e => setAutoAnswer(e.target.checked)} type="checkbox" />
        auto
      </label>
    </div>
  )
}

export function DecisionScreen({ decision, store, onClose }: { decision: SimDecision; store: SimStore; onClose: () => void }) {
  const [free, setFree] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)

  const submit = (option?: string) => {
    store.answerDecision(decision.key, { option, text: free.trim() || undefined })
    onClose()
  }

  const a = store.agents.get(decision.agentId)

  return (
    <div className="ac-modal-backdrop" onClick={onClose}>
      <div aria-modal="true" className={`ac-modal ac-decision ac-kind-${decision.kind}`} onClick={e => e.stopPropagation()} role="dialog">
        <div className="ac-modal-head">
          <span className="ac-modal-kind">{decision.kind === 'merge' ? 'merge request' : decision.kind}</span>
          <span className="ac-modal-from">{a?.name ?? decision.agentId}</span>
          <button aria-label="close" className="ac-modal-x" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="ac-modal-q">{decision.question}</div>
        {decision.context && <pre className="ac-modal-ctx">{decision.context}</pre>}
        {decision.diff && (
          <pre className="ac-modal-diff">{decision.diff.split('\n').slice(0, 24).join('\n')}</pre>
        )}
        <div className="ac-modal-opts">
          {decision.options.map(o => (
            <button className={`ac-opt${chosen === o ? ' sel' : ''}`} key={o} onClick={() => setChosen(o)}>
              {o}
            </button>
          ))}
        </div>
        <input className="ac-modal-note" onChange={e => setFree(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit(chosen ?? undefined)} placeholder="note (optional)" value={free} />
        <div className="ac-modal-actions">
          <button className="ac-btn ac-btn-primary" disabled={!chosen} onClick={() => submit(chosen!)}>
            Answer
          </button>
          {decision.kind === 'merge' && (
            <button className="ac-btn" onClick={() => submit(chosen ?? 'Request changes')}>
              Send note
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function AgentCard({ agentId, store, onClose }: { agentId: string; store: SimStore; onClose: () => void }) {
  useTick(500)
  const a = store.agents.get(agentId)

  if (!a) {return null}
  const logs = (store.logs.get(agentId) ?? []).slice(-40)
  const task = a.taskKey ? store.tasks.get(a.taskKey) : null

  return (
    <div className="ac-modal-backdrop" onClick={onClose}>
      <div aria-modal="true" className="ac-modal ac-agent" onClick={e => e.stopPropagation()} role="dialog">
        <div className="ac-modal-head" style={{ borderColor: a.color }}>
          <span className="ac-modal-kind" style={{ background: a.color }}>{a.name}</span>
          <span className="ac-modal-from">{a.role}</span>
          <span className="ac-chip-state">{a.activity.replace('_', ' ')}</span>
          <button aria-label="close" className="ac-modal-x" onClick={onClose}>
            ×
          </button>
        </div>
        {task && (
          <div className="ac-agent-task">
            <b>{task.id}</b> {task.title}
            <div className="ac-agent-taskmeta">{task.state}{task.summary ? ` — ${task.summary}` : ''}</div>
          </div>
        )}
        <pre className="ac-modal-log">
          {logs.map(l => `${l.kind.padEnd(6)} ${l.text}`).join('\n') || 'no log yet'}
        </pre>
      </div>
    </div>
  )
}
