/**
 * Sim world model: the entity store the studio renders — a TypeScript mirror of
 * the Foreman's protocol entities (agent / task / decision / goal / feed / log).
 * Framework-free (plain atom + listener bus) so the same store drives the React
 * HUD, the three.js scene, and headless tests.
 */

import { Lamp } from './blocks'

// ------------------------------------------------------------------ entities

export type AgentActivity =
  | 'idle'
  | 'thinking'
  | 'reading'
  | 'editing'
  | 'running'
  | 'testing'
  | 'waiting_user'
  | 'blocked'
  | 'error'
  | 'done'
  | 'off_shift'

export type Station = 'desk' | 'meeting' | 'lounge' | 'library' | 'terminal' | 'testbench' | 'mergestation' | 'user' | 'atrium'

export interface SimAgent {
  id: string
  name: string
  role: string
  color: string
  accent: string
  model: 'default' | 'slim'
  activity: AgentActivity
  detail: string
  station: Station
  taskKey: string | null
  /** speech bubble until ms epoch */
  speech: { to: string; text: string; until: number } | null
}

export type TaskState = 'todo' | 'doing' | 'review' | 'done' | 'blocked' | 'cancelled'

export interface SimTask {
  key: string
  id: string // display id, e.g. "T-2"
  title: string
  description?: string
  state: TaskState
  assignee: string | null
  deps: string[]
  priority: number
  summary?: string
  blockedReason?: string
}

export type DecisionKind = 'permission' | 'question' | 'merge'
export type DecisionStatus = 'open' | 'answered' | 'expired'

export interface SimDecision {
  key: string
  agentId: string
  kind: DecisionKind
  question: string
  options: string[]
  context?: string
  tool?: string
  taskKey?: string
  status: DecisionStatus
  answer?: { option?: string; text?: string }
  /** merge payload */
  diff?: string
  files?: string[]
  openedAt: number
}

export interface LogLine {
  kind: 'text' | 'tool' | 'result' | 'error' | 'diff' | 'memory'
  text: string
  t: number
}

export interface FeedItem {
  kind: 'plan' | 'task' | 'merge' | 'decision' | 'ci' | 'memory' | 'say' | 'info'
  text: string
  agentId?: string
  t: number
}

export interface SimGoal {
  text: string
  status: 'draft' | 'active' | 'done'
  progress: number
}

// ------------------------------------------------------------------ store

type Listener = (ev: SimEvent) => void

export type SimEvent =
  | { type: 'agent'; id: string }
  | { type: 'lamp'; binding: string; status: Lamp }
  | { type: 'bulbs'; group: 'merge' | 'podium'; lit: boolean }
  | { type: 'tasks' }
  | { type: 'decision'; key: string; status: DecisionStatus }
  | { type: 'feed' }
  | { type: 'log'; agentId: string }
  | { type: 'goal' }
  | { type: 'confetti'; x: number; y: number; z: number }
  | { type: 'bell' }
  | { type: 'reset' }

export interface CastMember {
  id: string
  name: string
  role: string
  color: string
  accent: string
  model: 'default' | 'slim'
}

export class SimStore {
  readonly agents = new Map<string, SimAgent>()
  readonly tasks = new Map<string, SimTask>()
  readonly decisions = new Map<string, SimDecision>()
  readonly logs = new Map<string, LogLine[]>()
  readonly feed: FeedItem[] = []
  goal: SimGoal | null = null
  connection: 'connecting' | 'live' | 'stale' | 'error' | 'offline' = 'connecting'
  private listeners = new Set<Listener>()
  private dirtyAgents = new Set<string>()
  dirtyScreens = new Set<string>()
  taskWallDirty = true
  feedDirty = true

  constructor(cast: CastMember[]) {
    for (const c of cast) {
      this.agents.set(c.id, {
        id: c.id,
        name: c.name,
        role: c.role,
        color: c.color,
        accent: c.accent,
        model: c.model,
        activity: 'idle',
        detail: '',
        station: 'lounge',
        taskKey: null,
        speech: null,
      })
    }
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn)

    return () => this.listeners.delete(fn)
  }

  emit(ev: SimEvent): void {
    for (const fn of this.listeners) {fn(ev)}
  }

  /** Mark an agent's monitor + lamp dirty; emitted through on 'agent'. */
  touchAgent(id: string): void {
    this.dirtyScreens.add(id)
    this.dirtyAgents.add(id)
    this.emit({ type: 'agent', id })
  }

  setAgent(id: string, patch: Partial<SimAgent>): void {
    const a = this.agents.get(id)

    if (!a) {return}
    Object.assign(a, patch)
    this.touchAgent(id)
  }

  setTask(key: string, patch: Partial<SimTask>): void {
    const t = this.tasks.get(key)

    if (!t) {return}
    Object.assign(t, patch)
    this.taskWallDirty = true
    this.emit({ type: 'tasks' })
  }

  addTask(t: SimTask): void {
    this.tasks.set(t.key, t)
    this.taskWallDirty = true
    this.emit({ type: 'tasks' })
  }

  log(agentId: string, kind: LogLine['kind'], text: string): void {
    const list = this.logs.get(agentId) ?? []
    list.push({ kind, text, t: Date.now() })

    if (list.length > 400) {list.splice(0, list.length - 400)}
    this.logs.set(agentId, list)
    this.dirtyScreens.add(agentId)
    this.emit({ type: 'log', agentId })
  }

  pushFeed(kind: FeedItem['kind'], text: string, agentId?: string): void {
    this.feed.push({ kind, text, agentId, t: Date.now() })

    if (this.feed.length > 60) {this.feed.splice(0, this.feed.length - 60)}
    this.feedDirty = true
    this.emit({ type: 'feed' })
  }

  setLamp(binding: string, status: Lamp): void {
    this.emit({ type: 'lamp', binding, status })
  }

  setBulbs(group: 'merge' | 'podium', lit: boolean): void {
    this.emit({ type: 'bulbs', group, lit })
  }

  openDecision(d: SimDecision): void {
    this.decisions.set(d.key, d)
    this.setLamp('decisions', Lamp.WAITING)
    this.setBulbs('podium', true)
    this.emit({ type: 'decision', key: d.key, status: 'open' })
    this.emit({ type: 'bell' })
  }

  answerDecision(key: string, answer: { option?: string; text?: string }): void {
    const d = this.decisions.get(key)

    if (!d || d.status !== 'open') {return}
    d.status = 'answered'
    d.answer = answer
    const openLeft = [...this.decisions.values()].some(o => o.status === 'open')

    if (!openLeft) {
      this.setLamp('decisions', Lamp.OFF)
      this.setBulbs('podium', false)
    }

    this.emit({ type: 'decision', key, status: 'answered' })
  }

  setGoal(g: SimGoal): void {
    this.goal = g
    this.emit({ type: 'goal' })
  }

  agentStatus(a: SimAgent): Lamp {
    switch (a.activity) {
      case 'thinking':
        return Lamp.THINKING

      case 'editing':

      case 'running':

      case 'testing':

      case 'reading':
        return Lamp.WORKING

      case 'waiting_user':

      case 'blocked':
        return Lamp.WAITING

      case 'error':
        return Lamp.ERROR

      case 'done':
        return Lamp.DONE

      case 'off_shift':
        return Lamp.OFF

      default:
        return Lamp.IDLE
    }
  }
}
