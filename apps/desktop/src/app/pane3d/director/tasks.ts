/**
 * Task sessions (architecture §8.7).
 *
 * The real interfaces live here — `TaskExecutor` and its event vocabulary are
 * what a non-harness executor would implement. `submitTask` creates the task,
 * runs the active executor and maps its events onto the avatar machine:
 *
 *   accepted → TASK_ACCEPTED (thinking)   progress → TASK_PROGRESS (pill)
 *   token    → STREAM_TOKEN (responding, one nod per burst)
 *   done     → TASK_DONE (celebrating) + a result card
 *   error    → TASK_ERROR (idle) + an error card
 *
 * The composer path enters `thinking` via SUBMIT before calling this, so
 * `accepted` is a no-op there; it matters for a programmatic submit while the
 * avatar is idle. Nothing here schedules a nod on a loop: `signalTokenBurst`
 * rate-limits a burst to at most two nods a second.
 *
 * A cancelled task is inert: its executor's late events are dropped, and the
 * machine is returned to idle through TASK_ERROR (it has no CANCEL event).
 */

import { PANE_COPY } from '../copy'
import type { AvatarId, ChartSpec, DemoScript, PageContext } from '../protocol'

import { presentChart } from './chart'
import { dispatch } from './director'
import { taskFeedEntry } from './feed'
import { clearNodSignals, signalTokenBurst } from './nods'
import {
  $avatars,
  $taskCards,
  $taskProgress,
  $tasks,
  pushFeed,
  type TaskCard,
  type TaskProgress,
  type TaskRecord,
  type TaskStatus
} from './store'

export interface AvatarTask {
  id: string
  avatar: AvatarId
  text: string
  context: PageContext
  createdAt: number
  /**
   * The scripted demo whose composer submitted this task, if any (§11). It
   * marks exactly one task, so demo-only behaviour can never follow the demo
   * into the tasks the user asks for afterwards.
   */
  demo?: DemoScript
}

export type TaskEvent =
  | { type: 'accepted' }
  | { type: 'progress'; label: string; pct?: number }
  | { type: 'token'; text: string }
  | { type: 'done'; result: TaskResult }
  | { type: 'error'; message: string }

export interface TaskResult {
  title: string
  body: string
  chart?: ChartSpec
  links?: { label: string; url: string }[]
  /** Set by an executor that wants its chart presented without a click (§8.9). */
  presentChart?: boolean
}

export interface TaskExecutor {
  readonly label: string
  readonly isDevHarness: boolean
  /** Returns the cancel function; `emit` may be called any number of times. */
  run(task: AvatarTask, emit: (event: TaskEvent) => void): () => void
}

/** The snapshot keeps the newest tasks, not an unbounded history (§12). */
export const TASK_CAP = 20

let executor: TaskExecutor | null = null
let sequence = 0

/** The one active executor. Installed at the composition point (§11). */
export function setTaskExecutor(next: TaskExecutor | null): void {
  executor = next
}

interface Session {
  id: string
  avatar: AvatarId
  source: 'live' | 'dev-harness'
  settled: boolean
  cancelled: boolean
  cancelFn: (() => void) | null
}

/** One running task per avatar; a second submit returns the running id. */
const running = new Map<AvatarId, Session>()

/** `demo` marks the task the scripted demo's own composer submitted (§11). */
export function submitTask(avatar: AvatarId, text: string, context: PageContext, demo?: DemoScript): string {
  const current = running.get(avatar)

  if (current) {
    return current.id
  }

  sequence += 1

  const id = `pane-task-${sequence}`
  const active = executor

  const session: Session = {
    avatar,
    cancelled: false,
    cancelFn: null,
    id,
    settled: false,
    source: active?.isDevHarness ? 'dev-harness' : 'live'
  }

  $tasks.set(
    [{ avatar, context, id, status: 'running', text } satisfies TaskRecord, ...$tasks.get()].slice(0, TASK_CAP)
  )
  // The pill exists from the submit, so the composer collapses into it before
  // the executor's first event arrives (§8.8).
  $taskProgress.set({
    ...$taskProgress.get(),
    [avatar]: { label: null, phase: 'thinking', source: session.source, stream: '', taskId: id }
  })

  const emit = (event: TaskEvent): void => {
    if (session.cancelled || session.settled) {
      return
    }

    handleEvent(session, event)
  }

  if (!active) {
    emit({ message: 'No task executor is installed.', type: 'error' })

    return id
  }

  running.set(avatar, session)

  try {
    session.cancelFn = active.run({ avatar, context, createdAt: Date.now(), demo, id, text }, emit)
  } catch (error) {
    emit({ message: error instanceof Error ? error.message : 'The task executor failed.', type: 'error' })
  }

  if (session.settled || session.cancelled) {
    // A synchronous executor may have finished inside `run`; nothing is pending.
    session.cancelFn?.()
  } else if (typeof session.cancelFn !== 'function') {
    emit({ message: 'The task executor did not return a cancel function.', type: 'error' })
  }

  return id
}

function handleEvent(session: Session, event: TaskEvent): void {
  switch (event.type) {
    case 'accepted':
      dispatch(session.avatar, 'TASK_ACCEPTED')

      return

    case 'progress':
      dispatch(session.avatar, 'TASK_PROGRESS')
      updateProgress(session, progress => ({ ...progress, label: event.label, pct: event.pct ?? progress.pct }))

      return

    case 'token':
      dispatch(session.avatar, 'STREAM_TOKEN')
      updateProgress(session, progress => ({ ...progress, phase: 'responding', stream: progress.stream + event.text }))
      signalTokenBurst(session.avatar)

      return

    case 'done':
      settle(session, 'done')
      dispatch(session.avatar, 'TASK_DONE')
      openTaskCard(session, {
        body: event.result.body,
        chart: event.result.chart,
        kind: 'result',
        links: event.result.links,
        presentChart: event.result.presentChart,
        title: event.result.title
      })

      return

    case 'error':
      settle(session, 'error')
      dispatch(session.avatar, 'TASK_ERROR')
      openTaskCard(session, { body: event.message, kind: 'error', title: PANE_COPY.taskErrorTitle })

      return
  }
}

function updateProgress(session: Session, update: (progress: TaskProgress) => TaskProgress): void {
  const current = $taskProgress.get()[session.avatar]

  if (!current || current.taskId !== session.id) {
    return
  }

  $taskProgress.set({ ...$taskProgress.get(), [session.avatar]: update(current) })
}

function clearProgress(avatar: AvatarId): void {
  const next = { ...$taskProgress.get() }

  delete next[avatar]
  $taskProgress.set(next)
}

function setTaskStatus(id: string, status: TaskStatus): void {
  $tasks.set($tasks.get().map(task => (task.id === id ? { ...task, status } : task)))
}

/** A done/error task stops being the avatar's running task. */
function settle(session: Session, status: TaskStatus): void {
  session.settled = true

  if (running.get(session.avatar) === session) {
    running.delete(session.avatar)
  }

  setTaskStatus(session.id, status)
  clearProgress(session.avatar)
  clearNodSignals(session.avatar)
}

interface TaskCardPayload {
  kind: TaskCard['kind']
  title: string
  body: string
  chart?: ChartSpec
  links?: { label: string; url: string }[]
  presentChart?: boolean
}

/** One card per avatar: a second settled task replaces the previous card. */
function openTaskCard(session: Session, payload: TaskCardPayload): void {
  const cards = { ...$taskCards.get() }
  const at = Date.now()

  // The replaced card collapses into the feed first, exactly like a dismissal —
  // a follow-up asked while the earlier result is still open must not lose it
  // (§8.6 records results).
  Object.values(cards).forEach(card => {
    if (card.avatar === session.avatar) {
      delete cards[card.id]
      pushFeed(taskFeedEntry(card, at))
    }
  })

  const id = `${session.id}-${payload.kind}`

  cards[id] = {
    avatar: session.avatar,
    body: payload.body,
    chart: payload.chart,
    id,
    kind: payload.kind,
    links: payload.links,
    presentChart: payload.presentChart,
    shownAt: Date.now(),
    source: session.source,
    taskId: session.id,
    title: payload.title
  }
  $taskCards.set(cards)
}

/** The card's close control: it collapses into the feed as a `task` entry. */
export function dismissTaskCard(id: string): void {
  const card = $taskCards.get()[id]

  if (!card) {
    return
  }

  const cards = { ...$taskCards.get() }

  delete cards[id]
  $taskCards.set(cards)
  pushFeed(taskFeedEntry(card, Date.now()))
}

/** The result card's "Show chart": hands the spec to the registered presenter. */
export function presentTaskCardChart(id: string): void {
  const card = $taskCards.get()[id]

  if (!card?.chart || !presentChart(card.avatar, card.chart, card.source)) {
    return
  }

  dismissTaskCard(id)
}

/**
 * Cancel one avatar's task. The machine has no CANCEL event, so the avatar is
 * returned to idle with TASK_ERROR — the one transition that works from both
 * `thinking` and `responding` — and no card is opened for a cancellation.
 */
export function cancelTask(avatar: AvatarId): void {
  const session = running.get(avatar)

  if (!session) {
    return
  }

  session.cancelled = true
  session.cancelFn?.()
  running.delete(avatar)
  setTaskStatus(session.id, 'cancelled')
  clearProgress(avatar)
  clearNodSignals(avatar)
  dispatch(avatar, 'TASK_ERROR')
}

/** The pane-close path (§8.7): every running task stops, with no exceptions. */
export function cancelTasks(): void {
  ;[...running.keys()].forEach(cancelTask)
}

/** Test seam: stop everything and drop the atoms this module owns. */
export function resetTasks(): void {
  running.forEach(session => {
    session.cancelled = true
    session.cancelFn?.()
  })
  running.clear()
  sequence = 0
  $tasks.set([])
  $taskProgress.set({})
  $taskCards.set({})
}

// A card must never outlive its avatar: hiding one collapses its card into the
// feed exactly like a settled notification (§8.5, §8.7).
$avatars.listen(rows => {
  const cards = $taskCards.get()

  const stale = Object.values(cards).filter(card => {
    const state = rows[card.avatar]?.state

    return state === 'hiding' || state === 'hidden'
  })

  if (stale.length === 0) {
    return
  }

  const next = { ...cards }

  stale.forEach(card => {
    delete next[card.id]
    pushFeed(taskFeedEntry(card, Date.now()))
  })
  $taskCards.set(next)
})
