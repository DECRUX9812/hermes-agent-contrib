import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AvatarId, PageContext } from '../protocol'
import { AVATAR_IDS } from '../protocol'

import { dispatch } from './director'
import { $avatars, $feed, $taskCards, $taskProgress, $tasks, $transitions, type AvatarRuntime } from './store'
import { cancelTask, cancelTasks, dismissTaskCard, resetTasks, setTaskExecutor, submitTask } from './tasks'
import type { TaskEvent, TaskExecutor } from './tasks'

const context: PageContext = {
  capturedAt: 42,
  selection: 'a generative shader',
  source: 'hermes-browser',
  title: 'Ada on X',
  url: 'http://127.0.0.1:5181/x-post.html'
}

function resetAvatars(): void {
  const out = {} as Record<AvatarId, AvatarRuntime>

  AVATAR_IDS.forEach(id => {
    out[id] = { changedAt: 0, id, pendingNotify: 0, state: 'hidden', visible: false }
  })

  $avatars.set(out)
  $transitions.set([])
}

/** An avatar that finished emerging: the state a composer submit starts from. */
function perch(id: AvatarId): void {
  dispatch(id, 'SUMMON')
  dispatch(id, 'EMERGED')
}

interface ManualExecutor {
  executor: TaskExecutor
  emit: (event: TaskEvent) => void
  cancels: () => number
  runs: () => number
}

/** A driver whose events the test emits by hand — fully deterministic. */
function manualExecutor(isDevHarness = true): ManualExecutor {
  let emitFn: (event: TaskEvent) => void = () => {}
  let cancels = 0
  let runs = 0

  return {
    cancels: () => cancels,
    emit: event => emitFn(event),
    executor: {
      isDevHarness,
      label: 'Manual harness',
      run: (_task, emit) => {
        runs += 1
        emitFn = emit

        return () => {
          cancels += 1
        }
      }
    },
    runs: () => runs
  }
}

describe('task sessions', () => {
  beforeEach(() => {
    resetTasks()
    resetAvatars()
    setTaskExecutor(null)
    $feed.set([])
  })

  it('maps accepted/progress/tokens/done onto the machine and opens a result card', () => {
    const harness = manualExecutor()

    setTaskExecutor(harness.executor)
    perch('muse')

    const id = submitTask('muse', 'build this', context)

    expect(id).toBe('pane-task-1')
    expect($tasks.get()[0]).toMatchObject({ avatar: 'muse', status: 'running', text: 'build this' })
    // The pill exists from the submit, before the first executor event.
    expect($taskProgress.get().muse).toMatchObject({ phase: 'thinking', taskId: id })

    harness.emit({ type: 'accepted' })

    expect($avatars.get().muse.state).toBe('thinking')

    harness.emit({ type: 'progress', label: 'Reading the post', pct: 0.1 })

    expect($avatars.get().muse.state).toBe('thinking')
    expect($taskProgress.get().muse).toMatchObject({ label: 'Reading the post', pct: 0.1, phase: 'thinking' })

    harness.emit({ type: 'token', text: 'Hello ' })

    expect($avatars.get().muse.state).toBe('responding')
    expect($taskProgress.get().muse).toMatchObject({ phase: 'responding', stream: 'Hello ' })

    harness.emit({ type: 'token', text: 'world' })
    harness.emit({ type: 'progress', label: 'Rendering preview', pct: 0.8 })

    expect($taskProgress.get().muse).toMatchObject({
      label: 'Rendering preview',
      phase: 'responding',
      stream: 'Hello world'
    })

    harness.emit({
      type: 'done',
      result: { body: 'A page for the post.', title: 'Built a landing page', links: [{ label: 'Preview', url: '#' }] }
    })

    expect($avatars.get().muse.state).toBe('celebrating')
    expect($taskProgress.get().muse).toBeUndefined()
    expect($tasks.get()[0].status).toBe('done')

    const card = Object.values($taskCards.get())[0]

    expect(card).toMatchObject({ avatar: 'muse', kind: 'result', taskId: id, title: 'Built a landing page' })
    expect(card.source).toBe('dev-harness')
  })

  it('maps an executor error to TASK_ERROR, an error card and idle', () => {
    const harness = manualExecutor(false)

    setTaskExecutor(harness.executor)
    perch('grok')
    submitTask('grok', 'do the thing', context)

    harness.emit({ type: 'accepted' })
    harness.emit({ type: 'error', message: 'the renderer fell over' })

    expect($avatars.get().grok.state).toBe('idle')
    expect($taskProgress.get().grok).toBeUndefined()

    const card = Object.values($taskCards.get())[0]

    expect(card).toMatchObject({ avatar: 'grok', kind: 'error' })
    expect(card.body).toContain('the renderer fell over')
    expect(card.source).toBe('live')
  })

  it('cancels a running task, ignores its late events and returns the avatar to idle', () => {
    const harness = manualExecutor()

    setTaskExecutor(harness.executor)
    perch('muse')
    submitTask('muse', 'build this', context)
    harness.emit({ type: 'accepted' })
    harness.emit({ type: 'token', text: 'partial' })

    cancelTask('muse')

    expect(harness.cancels()).toBe(1)
    expect($taskProgress.get().muse).toBeUndefined()
    expect($tasks.get()[0].status).toBe('cancelled')
    // A cancelled task never opens a card, and the avatar is not left talking.
    expect($avatars.get().muse.state).toBe('idle')
    expect($taskCards.get()).toEqual({})

    harness.emit({ type: 'done', result: { body: 'late', title: 'late' } })

    expect($avatars.get().muse.state).toBe('idle')
    expect($taskCards.get()).toEqual({})
    expect($feed.get()).toEqual([])
  })

  it('cancels every running task (the pane-close path)', () => {
    const harness = manualExecutor()

    setTaskExecutor(harness.executor)
    perch('muse')
    perch('grok')

    const first = submitTask('muse', 'muse task', context)
    const second = submitTask('grok', 'grok task', context)

    expect(first).toBe('pane-task-1')
    expect(second).toBe('pane-task-2')
    expect(harness.runs()).toBe(2)
    expect($tasks.get().map(task => task.status)).toEqual(['running', 'running'])

    // The second run's emit is the one the executor kept; it drives Grok.
    harness.emit({ type: 'accepted' })
    harness.emit({ type: 'token', text: 'partial' })

    expect($avatars.get().grok.state).toBe('responding')

    cancelTasks()

    expect(harness.cancels()).toBe(2)
    expect($avatars.get().muse.state).toBe('idle')
    expect($avatars.get().grok.state).toBe('idle')
    expect($tasks.get().map(task => task.status)).toEqual(['cancelled', 'cancelled'])
  })

  it('keeps one running task per avatar', () => {
    const harness = manualExecutor()

    setTaskExecutor(harness.executor)
    perch('muse')

    const first = submitTask('muse', 'first', context)
    const second = submitTask('muse', 'second', context)

    expect(second).toBe(first)
    expect(harness.runs()).toBe(1)
    expect($tasks.get()).toHaveLength(1)
  })

  it('reports a missing executor as a task error instead of hanging', () => {
    perch('muse')
    submitTask('muse', 'build this', context)

    expect($avatars.get().muse.state).toBe('idle')
    expect($tasks.get()[0].status).toBe('error')
    expect(Object.values($taskCards.get())[0].kind).toBe('error')
  })

  it('collapses a settled card into the feed as a task entry', () => {
    const harness = manualExecutor()

    setTaskExecutor(harness.executor)
    perch('muse')
    submitTask('muse', 'build this', context)
    harness.emit({ type: 'done', result: { body: 'done', title: 'Built a landing page' } })

    const card = Object.values($taskCards.get())[0]

    dismissTaskCard(card.id)

    expect($taskCards.get()).toEqual({})
    expect($feed.get()[0]).toMatchObject({
      avatar: 'muse',
      kind: 'task',
      source: 'dev-harness',
      text: 'Built a landing page'
    })
  })

  it('drops a card whose avatar hides, and keeps the context it was given', () => {
    const harness = manualExecutor()

    setTaskExecutor(harness.executor)
    perch('muse')
    submitTask('muse', 'build this', context)
    harness.emit({ type: 'done', result: { body: 'done', title: 'Built a landing page' } })

    expect(Object.keys($taskCards.get())).toHaveLength(1)

    dispatch('muse', 'DISMISS')

    expect($taskCards.get()).toEqual({})
    expect($tasks.get()[0].context).toEqual(context)
  })

  it('survives an executor that throws synchronously', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    setTaskExecutor({
      isDevHarness: false,
      label: 'Broken',
      run: () => {
        throw new Error('nope')
      }
    })
    perch('muse')
    submitTask('muse', 'build this', context)

    expect($avatars.get().muse.state).toBe('idle')
    expect(Object.values($taskCards.get())[0].kind).toBe('error')
    error.mockRestore()
  })
})
