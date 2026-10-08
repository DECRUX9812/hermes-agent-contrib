/**
 * The Activity tab's contract, read as a board: Now is the running task (on
 * its approved plan's step when there is one), Next is the plan's remaining
 * steps then upcoming routines, Done lists finished tasks newest first and
 * opens each one's steps with the raw command and result.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import type { ActivityTask } from '@hermes/plugin-sdk'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'
import type * as RoutingModule from './routing'
import type { RosterRow, RoutineJob } from './types'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { atom } = await import('nanostores')

  return {
    ...sdk,
    host: {
      ...sdk.host,
      state: {
        ...sdk.host.state,
        focusedActivity: atom<readonly ActivityTask[]>([]),
        focusedMessages: atom<readonly HermesSdk.ChatMessage[]>([]),
        focusedSessionId: atom<null | string>(null)
      }
    },
    usePluginI18n: () => translateBots
  }
})

const requestForBot = vi.fn(async () => ({ status: 'interrupted' }))
vi.mock('./routing', async importOriginal => ({
  ...(await importOriginal<typeof RoutingModule>()),
  requestForBot
}))

const { host } = await import('@hermes/plugin-sdk')
const { WorkBoard } = await import('./work-board')
const { activityNow } = await import('./activity-format')
const { $activitySubjects, activitySubjectKey, resetActivitySubjects } = await import('./activity-subjects')

const $activity = host.state.focusedActivity as unknown as { set: (tasks: readonly ActivityTask[]) => void }
const $messages = host.state.focusedMessages as unknown as { set: (messages: readonly HermesSdk.ChatMessage[]) => void }

type Msg = HermesSdk.ChatMessage

const said = (id: string, role: 'assistant' | 'user', text: string): Msg =>
  ({ id, parts: [{ text, type: 'text' }], role }) as Msg

const routine = (job_id: string, name: string, next_run_at?: string, extra = {}): RoutineJob => ({
  job_id,
  name: `[bot:muse] ${name}`,
  next_run_at,
  ...extra
})

const owner = { name: 'muse', connectionId: 'local' } as RosterRow

function board(jobs: RoutineJob[] = [], onOpenRoutine = vi.fn()) {
  return render(
    <WorkBoard jobs={jobs} name="Muse" onAddRoutine={vi.fn()} onOpenRoutine={onOpenRoutine} owner={owner} />
  )
}

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
  subject: 'Check UI build status',
  subjectSource: 'derived',
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
  subject: 'Compare bots and modes',
  subjectSource: 'derived',
  title: 'Compare bots and modes'
}

/** Work the agent started on its own: no request, so the row names its steps. */
const selfStarted: ActivityTask = {
  completedAt: nowS - 10,
  errorCount: 0,
  id: 'u3',
  outcome: 'Build is green.',
  startedAt: nowS - 40,
  status: 'done',
  steps: [
    step('t4', 'terminal', 'ran', 'npm run build', { target: 'npm run build' }),
    step('t5', 'terminal', 'ran', 'npm test', { target: 'npm test' })
  ],
  subject: '',
  subjectSource: 'derived',
  title: ''
}

/** The same self-started work, still going: what the Now card reads. */
const selfStartedRunning: ActivityTask = {
  ...selfStarted,
  completedAt: null,
  id: 'u4',
  startedAt: nowS - 30,
  status: 'running'
}

beforeAll(() => {
  // jsdom has no layout; the timeline scrolls its selected step into view.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  act(() => {
    $activity.set([])
    $messages.set([])
    resetActivitySubjects()
  })
})

describe('WorkBoard', () => {
  it('invites the first request when there is no work and nothing scheduled', () => {
    board()

    expect(screen.getByTestId('activity-empty').textContent).toContain('Muse')
  })

  it('puts the running task in Now and finished ones in Done, newest first', () => {
    const older = {
      ...finished,
      id: 'u0',
      outcome: 'Older outcome.',
      subject: 'Older task',
      title: 'Older task'
    }

    act(() => $activity.set([older, finished, running]))
    board()

    const now = screen.getByTestId('work-now')
    expect(now.textContent).toContain('Compare bots and modes')
    expect(now.textContent).toContain('Reading routes.ts')

    const done = screen.getAllByTestId('activity-row')
    expect(done.map(row => row.textContent?.includes('Check UI build status'))).toEqual([true, false])

    // The row IS its subject: one line, then status · time · receipts. The
    // reply's first sentence is not on the row — it lives in the dialog.
    expect(done[0].querySelector('[data-testid="activity-subject"]')?.textContent).toBe('Check UI build status')
    expect(done[0].textContent).toContain('Done')
    expect(done[0].textContent).not.toContain('Saved 3 screenshots for the preview.')

    fireEvent.click(done[0])
    expect(screen.getByTestId('activity-detail').textContent).toContain('Saved 3 screenshots for the preview.')
  })

  it('says the bot is free when nothing is running', () => {
    act(() => $activity.set([finished]))
    board()

    expect(screen.queryByTestId('work-now')).toBeNull()
    expect(screen.getByTestId('work-idle').textContent).toContain('Muse')
  })

  it('follows an approved plan: Now names the step in progress, Next the steps after it', () => {
    act(() => {
      $activity.set([running])
      $messages.set([
        said('u0', 'user', '/plan ship it'),
        said('p1', 'assistant', '1. Audit the parser\n2. Add the flag\n3. Update the tests\n\n::botplan'),
        said('u1', 'user', 'Execute this plan:\n\n1. Audit the parser'),
        said('a1', 'assistant', 'DONE: step 1')
      ])
    })
    board()

    const now = screen.getByTestId('work-now')
    expect(now.textContent).toContain('Step 2 of 3')
    expect(now.textContent).toContain('Add the flag')
    expect(within(now).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1')
    expect(screen.getByText('Update the tests')).toBeTruthy()
    expect(screen.getByText('After this step')).toBeTruthy()
  })

  it('lists active routines soonest first under Next, and opens one on click', () => {
    const onOpen = vi.fn()
    board(
      [
        routine('late', 'Weekly review', '2099-01-02T00:00:00Z'),
        routine('paused', 'Paused job', '2099-01-01T00:00:00Z', { state: 'paused' }),
        routine('soon', 'Morning brief', '2099-01-01T00:00:00Z')
      ],
      onOpen
    )

    const titles = screen.getAllByRole('button').map(button => button.textContent ?? '')
    const brief = titles.findIndex(text => text.includes('Morning brief'))
    const review = titles.findIndex(text => text.includes('Weekly review'))
    expect(brief).toBeGreaterThan(-1)
    expect(brief).toBeLessThan(review)
    expect(screen.queryByText('Paused job')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Morning brief/ }))
    expect(onOpen).toHaveBeenCalledWith('soon')
  })

  it('opens a finished task on its newest step, and shows the command and result of the one picked', () => {
    act(() => $activity.set([finished]))
    board()

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

  it("stops the focused chat's turn, not a guessed canonical one", () => {
    ;(host.state.focusedSessionId as unknown as { set: (id: string) => void }).set('runtime-side-chat')
    act(() => $activity.set([running]))
    board()

    fireEvent.click(within(screen.getByTestId('work-now')).getByRole('button', { name: /Stop run/ }))

    expect(requestForBot).toHaveBeenCalledWith(
      owner,
      'session.interrupt',
      { session_id: 'runtime-side-chat' },
      { spawnPriority: 'foreground' }
    )
  })

  it('tallies what a finished task touched on its receipt', () => {
    const busy = {
      ...finished,
      steps: [
        ...finished.steps,
        step('t4', 'terminal', 'ran', 'npm test', { target: 'npm test' }),
        step('t5', 'patch', 'edited', 'a.ts')
      ]
    }

    act(() => $activity.set([busy]))
    board()

    const verbs = screen.getAllByTestId('receipt-verb').map(chip => chip.textContent)
    // The count reads as a WORD plus its number — "Ran 2", not an icon and a 2.
    expect(verbs[0]).toBe('Ran 2')
    expect(verbs).toHaveLength(3)
  })

  it('names self-started work by what it DID, in Now and in Done', () => {
    act(() => $activity.set([selfStarted, selfStartedRunning]))
    board()

    // Now's headline is the work, not the literal "Started on its own" —
    // which stays as the tooltip for a reader who wants the provenance.
    const now = screen.getByTestId('work-now')
    expect(within(now).getByTestId('work-now-subject').textContent).toBe('Ran npm run build')
    expect(within(now).getByTestId('work-now-subject').getAttribute('title')).toBe('Started on its own')

    expect(screen.getByTestId('activity-subject').textContent).toBe('Ran npm run build')
  })

  it('renders a cached model subject in place of the derived one', () => {
    act(() => {
      $activitySubjects.set({
        entries: {
          [activitySubjectKey(finished)]: {
            at: Date.now(),
            source: 'model',
            subject: 'Skia UI build receipts'
          }
        },
        ready: true
      })
      $activity.set([finished])
    })
    board()

    expect(screen.getByTestId('activity-subject').textContent).toBe('Skia UI build receipts')
  })

  it('flags a routine whose last run failed', () => {
    board([routine('broken', 'Inbox sweep', '2099-01-01T00:00:00Z', { last_fire_error: 'model timeout' })])

    expect(screen.getByRole('button', { name: /Inbox sweep/ }).textContent).toContain('Last run failed')
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
