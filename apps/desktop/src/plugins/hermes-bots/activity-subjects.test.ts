/**
 * The async subject-upgrade layer's contract:
 *
 *  1. rows render their DERIVED subject immediately — a model subject is an
 *     upgrade, never a dependency;
 *  2. one batched `llm.oneshot` per mount covers every eligible VISIBLE row
 *     (settled, with a request, never asked) — running rows, collapsed rows
 *     and self-started work are not asked for;
 *  3. the reply is validated before it is trusted, and a refusal is recorded
 *     so the same bad answer is never paid for twice;
 *  4. every failure degrades to the derived subject with no console noise.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import type { ActivityTask, ChatMessage, PluginContext } from '@hermes/plugin-sdk'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const oneshot = vi.hoisted(() => vi.fn())

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: { ...sdk.host, request: oneshot }
  }
})

const {
  $activitySubjects,
  activitySubjectKey,
  ensureActivitySubjects,
  parseModelSubjects,
  resetActivitySubjects,
  requestTextFor,
  subjectPrompt,
  useActivitySubjects,
  validateModelSubject
} = await import('./activity-subjects')

const { setPluginCtx } = await import('./shared')

const message = (id: string, text: string): ChatMessage =>
  ({ id, parts: [{ text, type: 'text' }], role: 'user', timestamp: 1 }) as ChatMessage

function task(over: Partial<ActivityTask> = {}): ActivityTask {
  return {
    completedAt: 10,
    errorCount: 0,
    id: 'u1',
    outcome: '',
    startedAt: 1,
    status: 'done',
    steps: [],
    subject: 'Deploy the plugin',
    subjectSource: 'derived',
    title: 'Deploy the plugin',
    ...over
  }
}

const settled = task()
const other = task({ id: 'u2', subject: 'Check the build', title: 'Check the build' })
const running = task({ completedAt: null, id: 'u3', status: 'running', subject: 'Compare bots', title: 'Compare bots' })
const collapsed = task({ id: 'u4', subject: 'Read the roster', title: 'Read the roster' })

const TASKS = [settled, other, running, collapsed]

const MESSAGES = [
  message('u1', 'Hey, deploy the plugin'),
  message('u2', 'Check the build'),
  message('u3', 'Compare bots and modes'),
  message('u4', 'Read the roster code')
]

/** What the board shows: the collapsed Done row is NOT on screen. */
const VISIBLE = [settled, other, running]

const KEY_1 = activitySubjectKey(settled, 'Hey, deploy the plugin')

beforeEach(() => {
  oneshot.mockReset()
  resetActivitySubjects()
  setPluginCtx(null)
})

afterEach(() => {
  cleanup()
  setPluginCtx(null)
})

describe('validateModelSubject', () => {
  it('accepts a short, name-shaped subject', () => {
    expect(validateModelSubject('Deploy the plugin')).toBe('Deploy the plugin')
  })

  it('strips wrapping quotes and a Title: prefix', () => {
    expect(validateModelSubject('"Deploy the plugin"')).toBe('Deploy the plugin')
    expect(validateModelSubject('Title: Deploy the plugin')).toBe('Deploy the plugin')
    expect(validateModelSubject('Subject: Check the build')).toBe('Check the build')
  })

  it('refuses anything longer than a subject', () => {
    expect(validateModelSubject('one two three four five six seven eight nine ten eleven twelve thirteen')).toBeNull()
    expect(validateModelSubject('x'.repeat(300))).toBeNull()
  })

  it('refuses an answer instead of a name', () => {
    expect(validateModelSubject('Sure, here are the titles you asked for')).toBeNull()
    expect(validateModelSubject('I could not read the second request')).toBeNull()
    expect(validateModelSubject('Which plugin do you mean?')).toBeNull()
    expect(validateModelSubject('The subjects are:')).toBeNull()
    expect(validateModelSubject('')).toBeNull()
    expect(validateModelSubject(42)).toBeNull()
  })

  it('cuts an overlong name on a word boundary, never mid-word', () => {
    const subject = validateModelSubject('Get the Backdrops Plugin Live on the Desktop app for everyone')

    expect(subject?.endsWith('…')).toBe(true)
    expect(subject!.length).toBeLessThanOrEqual(60)
  })
})

describe('parseModelSubjects', () => {
  it('reads the instructed JSON array, in order', () => {
    expect(parseModelSubjects('["Deploy the plugin","Check the build"]', 2)).toEqual([
      'Deploy the plugin',
      'Check the build'
    ])
  })

  it('survives a fenced reply', () => {
    expect(parseModelSubjects('```json\n["Deploy the plugin"]\n```', 1)).toEqual(['Deploy the plugin'])
  })

  it('falls back to a line list when the model ignores the shape', () => {
    expect(parseModelSubjects('1. Deploy the plugin\n2. Check the build', 2)).toEqual([
      'Deploy the plugin',
      'Check the build'
    ])
  })

  it('comes back null where it cannot answer, so that row stays derived', () => {
    expect(parseModelSubjects('["Deploy the plugin"]', 3)).toEqual(['Deploy the plugin', null, null])
    // A prose reply is not a name: it is refused, not smuggled into a row.
    expect(parseModelSubjects('Sure, here are the subjects you asked for', 1)).toEqual([null])
    expect(parseModelSubjects('', 2)).toEqual([null, null])
  })
})

describe('subjectPrompt', () => {
  it('numbers the requests and demands a same-language JSON array', () => {
    const { input, instructions } = subjectPrompt(['Deploy the plugin', 'Check the build'])

    expect(input).toBe('1. Deploy the plugin\n2. Check the build')
    expect(instructions).toContain('each of these 2 requests')
    expect(instructions).toContain('ONLY a JSON array')
    expect(instructions).toContain('SAME language')
    // No language is detectable here, so no language is asserted.
    expect(instructions).not.toContain('is written in')
  })

  it('passes an explicit rule for a request it can name a language for', () => {
    const { instructions } = subjectPrompt(['プラグインをデプロイして', 'Deploy the plugin'])

    expect(instructions).toContain('Request 1 is written in Japanese: write its subject in Japanese.')
    expect(instructions).not.toContain('Request 2 is written in')
  })
})

describe('activitySubjectKey / requestTextFor', () => {
  it('is the task id plus a hash of the RAW request, so an edit re-opens the key', () => {
    expect(KEY_1).toBe(`${settled.id}:${KEY_1.split(':')[1]}`)
    expect(KEY_1).not.toBe(activitySubjectKey(settled, 'Deploy the plugin with the fix'))
    expect(KEY_1).toBe(activitySubjectKey(settled, 'Hey, deploy the plugin'))
  })

  it('reads the request back from the message the task opened on', () => {
    expect(requestTextFor(settled, MESSAGES)).toBe('Hey, deploy the plugin')
    // Work the agent started on its own has no request to name.
    expect(requestTextFor(task({ id: 'solo', title: '' }), MESSAGES)).toBe('')
  })
})

describe('useActivitySubjects', () => {
  it('renders the derived subject first — the model is an upgrade, not a wait', () => {
    const { result } = renderHook(() => useActivitySubjects(TASKS, MESSAGES, VISIBLE))

    expect(result.current[0].subject).toBe('Deploy the plugin')
    expect(result.current[0].subjectSource).toBe('derived')
    expect(result.current[1].subject).toBe('Check the build')
  })

  it('merges a cached model subject into the slot rows read', () => {
    act(() => {
      $activitySubjects.set({
        entries: { [KEY_1]: { at: Date.now(), source: 'model', subject: 'Ship the plugin' } },
        ready: true
      })
    })

    const { result } = renderHook(() => useActivitySubjects(TASKS, MESSAGES, VISIBLE))

    expect(result.current[0].subject).toBe('Ship the plugin')
    expect(result.current[0].subjectSource).toBe('model')
    // Untouched tasks keep their identity (and their derivation).
    expect(result.current[1]).toBe(other)
  })

  it('asks ONCE, in one batch, for the settled visible rows only', async () => {
    oneshot.mockResolvedValue({ text: '["Ship the plugin","Audit the build"]' })

    const { result } = renderHook(() => useActivitySubjects(TASKS, MESSAGES, VISIBLE))

    await waitFor(() => expect(oneshot).toHaveBeenCalledTimes(1))

    const [method, params] = oneshot.mock.calls[0]

    expect(method).toBe('llm.oneshot')
    expect(params.task).toBe('title_generation')
    expect(params.temperature).toBe(0)
    expect(params.max_tokens).toBe(48 * 2)
    // No session: the cheap aux tier answers, never the live conversation.
    expect(params.session_id).toBeUndefined()
    expect(params.input).toContain('1. Hey, deploy the plugin')
    expect(params.input).toContain('2. Check the build')
    // The running row and the collapsed row are not asked for.
    expect(params.input).not.toContain('Compare bots and modes')
    expect(params.input).not.toContain('Read the roster code')

    await waitFor(() => expect(result.current[0].subject).toBe('Ship the plugin'))
    expect(result.current[0].subjectSource).toBe('model')
    expect(result.current[1].subject).toBe('Audit the build')
  })

  it('never asks twice: an in-flight batch survives re-renders with new identities', async () => {
    oneshot.mockReturnValue(new Promise(() => undefined))

    const { rerender } = renderHook(({ tasks }) => useActivitySubjects(tasks, MESSAGES, VISIBLE), {
      initialProps: { tasks: TASKS }
    })

    await waitFor(() => expect(oneshot).toHaveBeenCalledTimes(1))

    // Every streamed token re-derives the tasks: same content, new objects.
    rerender({ tasks: TASKS.map(item => ({ ...item })) })
    rerender({ tasks: TASKS.map(item => ({ ...item })) })

    expect(oneshot).toHaveBeenCalledTimes(1)
  })

  it('keeps the derived subject when the call fails, and says nothing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    oneshot.mockRejectedValue(new Error('Hermes gateway unavailable'))

    const { result } = renderHook(() => useActivitySubjects(TASKS, MESSAGES, VISIBLE))

    await waitFor(() => expect(oneshot).toHaveBeenCalledTimes(1))
    await act(async () => undefined)

    expect(result.current[0].subject).toBe('Deploy the plugin')
    expect(result.current[0].subjectSource).toBe('derived')
    expect(errors).not.toHaveBeenCalled()
    expect(warns).not.toHaveBeenCalled()

    errors.mockRestore()
    warns.mockRestore()
  })

  it('records a refused answer so the same bad reply is never bought again', async () => {
    oneshot.mockResolvedValue({ text: '["Sure, here are the subjects you asked me for"]' })

    const { unmount, result } = renderHook(() => useActivitySubjects(TASKS, MESSAGES, VISIBLE))

    await waitFor(() => expect(oneshot).toHaveBeenCalledTimes(1))
    await waitFor(() => expect($activitySubjects.get().ready).toBe(true))

    expect($activitySubjects.get().entries[KEY_1]?.source).toBe('rejected')
    expect(result.current[0].subject).toBe('Deploy the plugin')

    // A fresh mount (a reload) still does not pay for it.
    unmount()
    renderHook(() => useActivitySubjects(TASKS, MESSAGES, VISIBLE))
    await act(async () => undefined)

    expect(oneshot).toHaveBeenCalledTimes(1)
  })

  it('hydrates the persisted cache before asking, and writes accepted subjects back', async () => {
    const storage = {
      get: vi.fn(async (_key: string, _fallback: unknown) => ({
        [KEY_1]: { at: Date.now(), source: 'model', subject: 'Ship the plugin' }
      })),
      set: vi.fn(
        async (
          _key: string,
          _entries: Record<string, { at: number; source: string; subject: string }>
        ) => undefined
      )
    }

    setPluginCtx({ storage } as unknown as PluginContext)
    oneshot.mockResolvedValue({ text: '["Audit the build"]' })

    const { result } = renderHook(() => useActivitySubjects(TASKS, MESSAGES, VISIBLE))

    // Already paid for: the cache wins and that row is never re-asked.
    await waitFor(() => expect(result.current[0].subject).toBe('Ship the plugin'))
    expect(storage.get).toHaveBeenCalledWith('activity-subjects-v1', {})

    await waitFor(() => expect(storage.set).toHaveBeenCalled())
    const [key, written] = storage.set.mock.calls.at(-1)!

    expect(key).toBe('activity-subjects-v1')
    expect(written[KEY_1]).toEqual({ at: expect.any(Number), source: 'model', subject: 'Ship the plugin' })
    expect(written[activitySubjectKey(other, 'Check the build')].source).toBe('model')
    // One batch, one row still to buy: only the second row was asked for.
    expect(oneshot).toHaveBeenCalledTimes(1)
    expect(oneshot.mock.calls[0][1].input).not.toContain('Hey, deploy the plugin')
  })

  it('starts from an empty cache when the plugin has no storage at all', async () => {
    ensureActivitySubjects()

    expect($activitySubjects.get()).toEqual({ entries: {}, ready: true })
  })
})
