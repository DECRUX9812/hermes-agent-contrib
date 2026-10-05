/**
 * The Activity tab's contract: requests read as tasks, newest first under a
 * day heading; a running task says what it is doing now; opening a task shows
 * every step and, for the selected one, the raw command and result.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import type { ActivityTask } from '@hermes/plugin-sdk'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { atom } = await import('nanostores')

  return {
    ...sdk,
    host: { ...sdk.host, state: { ...sdk.host.state, focusedActivity: atom<readonly ActivityTask[]>([]) } },
    usePluginI18n: () => translateBots
  }
})

const { host } = await import('@hermes/plugin-sdk')
const { activityDays, BotActivityFeed } = await import('./activity-feed')
const { activityNow } = await import('./activity-format')

const $activity = host.state.focusedActivity as unknown as { set: (tasks: readonly ActivityTask[]) => void }
const nowS = Date.now() / 1000

const step = (id: string, tool: string, verb: ActivityTask['steps'][number]['verb'], subject: string, extra = {}) => ({
  action: {
    completedAt: nowS - 50,
    exitCode: null,
    id,
    input: '',
    output: 'ok',
    startedAt: nowS - 60,
    status: 'ok' as const,
    target: subject,
    tool,
    ...extra
  },
  id,
  subject,
  verb
})

const finished: ActivityTask = {
  completedAt: nowS - 50,
  errorCount: 0,
  id: 'u1',
  outcome: 'Saved 3 screenshots for the preview.',
  startedAt: nowS - 120,
  status: 'done',
  steps: [
    step('t1', 'terminal', 'ran', 'git status', { exitCode: 0, output: 'clean', target: 'git status' }),
    step('t2', 'read_file', 'read', 'bot-card.tsx')
  ],
  title: 'Check UI build status'
}

const running: ActivityTask = {
  completedAt: null,
  errorCount: 0,
  id: 'u2',
  outcome: '',
  startedAt: nowS - 30,
  status: 'running',
  steps: [step('t3', 'read_file', 'read', 'routes.ts', { completedAt: null, output: '', status: 'running' })],
  title: 'Compare bots and modes'
}

beforeAll(() => {
  // jsdom has no layout; the timeline scrolls its selected step into view.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  act(() => $activity.set([]))
})

describe('BotActivityFeed', () => {
  it('invites the first request when the chat has no work yet', () => {
    render(<BotActivityFeed name="Muse" />)

    expect(screen.getByTestId('activity-empty').textContent).toContain('Muse')
  })

  it('lists tasks newest first under Today, the running one saying what it is doing', () => {
    act(() => $activity.set([finished, running]))
    render(<BotActivityFeed name="Muse" />)

    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy()
    const rows = screen.getAllByTestId('activity-row')

    expect(rows.map(row => row.dataset.taskStatus)).toEqual(['running', 'done'])
    expect(rows[0].textContent).toContain('Compare bots and modes')
    expect(rows[0].textContent).toContain('Reading routes.ts')
    expect(rows[1].textContent).toContain('Saved 3 screenshots for the preview.')
  })

  it('opens a task on its newest step, and shows the command and result of the one picked', () => {
    act(() => $activity.set([finished]))
    render(<BotActivityFeed name="Muse" />)

    fireEvent.click(screen.getByTestId('activity-row'))
    const dialog = screen.getByTestId('activity-detail')

    expect(within(dialog).getByText('Done')).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'Read bot-card.tsx' })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Ran git status' }))
    const detail = within(dialog).getByTestId('activity-step-detail')

    expect(within(detail).getByText('Command')).toBeTruthy()
    expect(within(detail).getByText('Exit code 0')).toBeTruthy()
    expect(within(detail).getByText('clean')).toBeTruthy()
  })
})

describe('activityNow', () => {
  it('names the step in flight, says Thinking between calls, and is silent when idle', () => {
    const a = translateBotsActivity()

    expect(activityNow([finished, running], a)).toBe('Reading routes.ts')
    expect(activityNow([{ ...running, steps: [] }], a)).toBe('Thinking')
    expect(activityNow([finished], a)).toBeNull()
  })
})

describe('activityDays', () => {
  it('buckets by local day, newest day first', () => {
    const day = 86_400

    const days = activityDays(
      [
        { ...finished, id: 'old', startedAt: nowS - 2 * day },
        { ...finished, id: 'yday', startedAt: nowS - day },
        { ...finished, id: 'now', startedAt: nowS }
      ],
      { today: 'Today', yesterday: 'Yesterday' }
    )

    expect(days.map(d => d.tasks.map(t => t.id))).toEqual([['now'], ['yday'], ['old']])
    expect(days.slice(0, 2).map(d => d.label)).toEqual(['Today', 'Yesterday'])
  })
})

function translateBotsActivity() {
  let captured: Parameters<typeof activityNow>[1] | undefined

  function Probe() {
    // useBots binds the plugin i18n to the message shape; read the block once.
    captured = useBotsHook().activity

    return null
  }

  render(<Probe />)
  cleanup()

  return captured!
}

const { useBots: useBotsHook } = await import('./i18n')
