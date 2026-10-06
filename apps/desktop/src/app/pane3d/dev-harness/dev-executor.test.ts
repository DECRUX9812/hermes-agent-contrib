import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AvatarTask, TaskEvent } from '../director/tasks'

import { DEMO_CHART } from './demo-data'
import { DEV_PROGRESS_STEPS, DevHarnessExecutor, devScript, shouldAttachChart } from './dev-executor'

const task: AvatarTask = {
  avatar: 'muse',
  context: {
    capturedAt: 42,
    selection: 'Look at this generative shader — it is all one fragment program',
    source: 'hermes-browser',
    title: 'Ada on X: "Look at this generative shader"',
    url: 'http://127.0.0.1:5181/x-post.html'
  },
  createdAt: 0,
  id: 'pane-task-1',
  text: 'this looks cool — can you build this for me?'
}

function events(script: { event: TaskEvent }[]): TaskEvent[] {
  return script.map(step => step.event)
}

describe('dev harness executor script', () => {
  it('runs the three deterministic progress steps in order', () => {
    const progress = events(devScript(task, false)).filter(
      (event): event is Extract<TaskEvent, { type: 'progress' }> => event.type === 'progress'
    )

    expect(progress.map(event => event.label)).toEqual([...DEV_PROGRESS_STEPS])
    expect(progress[0].pct).toBeLessThan(progress[2].pct as number)
  })

  it('streams tokens that reference the captured title and selection', () => {
    const stream = events(devScript(task, false))
      .filter((event): event is Extract<TaskEvent, { type: 'token' }> => event.type === 'token')
      .map(event => event.text)
      .join('')

    expect(stream).toContain('Ada on X')
    expect(stream).toContain('generative shader')
    expect(stream.trim().length).toBeGreaterThan(80)
  })

  it('attaches the demo chart only when the request or the launch demo asks for it', () => {
    expect(shouldAttachChart('can you show me the growth?')).toBe(true)
    expect(shouldAttachChart('add a chart please')).toBe(true)
    expect(shouldAttachChart('what do the stats look like')).toBe(true)
    expect(shouldAttachChart('build me a landing page')).toBe(false)
    expect(shouldAttachChart('build me a landing page', true)).toBe(true)

    const plain = events(devScript(task, false)).at(-1)
    const asked = events(devScript({ ...task, text: 'add a chart please' }, false)).at(-1)
    const demo = events(devScript({ ...task, text: 'growth please' }, false)).at(-1)
    const launch = events(devScript(task, true)).at(-1)

    expect(plain?.type).toBe('done')
    expect((plain as Extract<TaskEvent, { type: 'done' }>).result.chart).toBeUndefined()
    expect((asked as Extract<TaskEvent, { type: 'done' }>).result.chart).toEqual(DEMO_CHART)
    expect((demo as Extract<TaskEvent, { type: 'done' }>).result.chart).toEqual(DEMO_CHART)
    expect((launch as Extract<TaskEvent, { type: 'done' }>).result.chart).toEqual(DEMO_CHART)
  })

  it('results reference the captured page and stay ordered', () => {
    const script = devScript(task, false)
    const times = script.map(step => step.at)
    const done = events(script).at(-1)

    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(done?.type).toBe('done')

    const result = (done as Extract<TaskEvent, { type: 'done' }>).result

    expect(result.title).toContain('Ada on X')
    expect(result.title).not.toContain('“Ada')
    expect(result.body).toContain('generative shader')
    expect(result.links?.[0].url).toBe('http://127.0.0.1:5181/x-post.html')
  })

  it('emits the whole script on a timer and stops dead on cancel', () => {
    vi.useFakeTimers()

    const received: TaskEvent[] = []
    const executor = new DevHarnessExecutor()
    const cancel = executor.run(task, event => received.push(event))

    vi.runAllTimers()

    expect(received.map(event => event.type)).toContain('accepted')
    expect(received.at(-1)?.type).toBe('done')

    // A cancelled run never emits again — the pane-close path must be silent.
    const after: TaskEvent[] = []
    const cancelSecond = executor.run(task, event => after.push(event))

    vi.advanceTimersByTime(200)
    cancelSecond()
    vi.runAllTimers()

    expect(after.length).toBeGreaterThan(0)
    expect(after.some(event => event.type === 'done')).toBe(false)

    cancel()
    vi.useRealTimers()
  })

  it('is labelled as the dev harness', () => {
    const executor = new DevHarnessExecutor()

    expect(executor.label).toBe('Dev harness')
    expect(executor.isDevHarness).toBe(true)
  })
})

afterEach(() => {
  vi.useRealTimers()
})
