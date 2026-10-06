import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AvatarTask, TaskEvent, TaskResult } from '../director/tasks'

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

/** The script's last event must be the result; anything else is a broken script. */
function resultOf(event: TaskEvent | undefined): TaskResult {
  if (event?.type !== 'done') {
    throw new Error(`expected a done event, got ${event?.type ?? 'nothing'}`)
  }

  return event.result
}

describe('dev harness executor script', () => {
  it('runs the three deterministic progress steps in order', () => {
    const progress = events(devScript(task)).filter(
      (event): event is Extract<TaskEvent, { type: 'progress' }> => event.type === 'progress'
    )

    expect(progress.map(event => event.label)).toEqual([...DEV_PROGRESS_STEPS])
    expect(progress[0].pct).toBeLessThan(progress[2].pct as number)
  })

  it('streams tokens that reference the captured title and selection', () => {
    const stream = events(devScript(task))
      .filter((event): event is Extract<TaskEvent, { type: 'token' }> => event.type === 'token')
      .map(event => event.text)
      .join('')

    expect(stream).toContain('Ada on X')
    expect(stream).toContain('generative shader')
    expect(stream.trim().length).toBeGreaterThan(80)
  })

  it('attaches the demo chart only when the request or the demo task asks for it', () => {
    expect(shouldAttachChart('can you show me the growth?')).toBe(true)
    expect(shouldAttachChart('add a chart please')).toBe(true)
    expect(shouldAttachChart('what do the stats look like')).toBe(true)
    expect(shouldAttachChart('build me a landing page')).toBe(false)
    expect(shouldAttachChart('build me a landing page', true)).toBe(true)

    const plain = events(devScript(task)).at(-1)
    const asked = events(devScript({ ...task, text: 'add a chart please' })).at(-1)
    const stats = events(devScript({ ...task, text: 'what do the stats look like' })).at(-1)
    const launch = events(devScript({ ...task, demo: 'launch' })).at(-1)

    expect(plain?.type).toBe('done')
    expect(resultOf(plain).chart).toBeUndefined()
    expect(resultOf(asked).chart).toEqual(DEMO_CHART)
    expect(resultOf(stats).chart).toEqual(DEMO_CHART)
    // The demo's pre-filled line carries no chart word: its task marker is what
    // attaches the chart (§11).
    expect(resultOf(launch).chart).toEqual(DEMO_CHART)
  })

  it('asks for the chart to be presented only on the demo\u2019s own task', () => {
    const plain = events(devScript(task)).at(-1)
    const asked = events(devScript({ ...task, text: 'add a chart please' })).at(-1)
    const launch = events(devScript({ ...task, demo: 'launch' })).at(-1)

    // An ordinary request keeps its card and reaches the chart by click (§8.9).
    expect(resultOf(plain).presentChart).toBeUndefined()
    expect(resultOf(asked).presentChart).toBeUndefined()
    expect(resultOf(launch).presentChart).toBe(true)
  })

  it('results reference the captured page and stay ordered', () => {
    const script = devScript(task)
    const times = script.map(step => step.at)
    const done = events(script).at(-1)

    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(done?.type).toBe('done')

    const result = resultOf(done)

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

  it('carries the task\u2019s demo marker through the timer script', () => {
    vi.useFakeTimers()

    const run = (subject: AvatarTask): TaskEvent | undefined => {
      const received: TaskEvent[] = []
      const cancel = new DevHarnessExecutor().run(subject, event => received.push(event))

      vi.runAllTimers()
      cancel()

      return received.at(-1)
    }

    expect(resultOf(run(task)).presentChart).toBeUndefined()
    expect(resultOf(run({ ...task, demo: 'launch' })).presentChart).toBe(true)
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
