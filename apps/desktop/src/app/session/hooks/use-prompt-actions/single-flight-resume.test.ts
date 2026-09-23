import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearSingleFlightSessionResumeState,
  registerRecoveredRuntime,
  SESSION_RESUME_DEADLINE_MS,
  singleFlightSessionResume,
  takeRecoveredRuntime
} from './single-flight-resume'
import { resumeStoredRuntimeSession, SessionRecoveryAborted, withSessionNotFoundResume } from './utils'

afterEach(() => {
  clearSingleFlightSessionResumeState()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('singleFlightSessionResume', () => {
  it('two concurrent resume callers for the same stored id produce ONE session.resume RPC', async () => {
    const requestGateway = vi.fn(async (method: string) => {
      expect(method).toBe('session.resume')
      // Yield so both callers are in flight before either resolves.
      await new Promise(resolve => setTimeout(resolve, 10))

      return { session_id: 'rt-fresh' }
    })

    const deps = { requestGateway: requestGateway as never, resolveProfile: async () => undefined }

    const [a, b] = await Promise.all([
      resumeStoredRuntimeSession('stored-a', deps),
      resumeStoredRuntimeSession('stored-a', deps)
    ])

    expect(a).toBe('rt-fresh')
    expect(b).toBe('rt-fresh')
    expect(requestGateway).toHaveBeenCalledTimes(1)
  })

  it('different stored ids still resume independently', async () => {
    const requestGateway = vi.fn(async (_method: string, params?: Record<string, unknown>) => {
      await new Promise(resolve => setTimeout(resolve, 5))

      return { session_id: `rt-${String(params?.session_id)}` }
    })

    const deps = { requestGateway: requestGateway as never, resolveProfile: async () => undefined }

    const [a, b] = await Promise.all([
      resumeStoredRuntimeSession('stored-a', deps),
      resumeStoredRuntimeSession('stored-b', deps)
    ])

    expect(a).toBe('rt-stored-a')
    expect(b).toBe('rt-stored-b')
    expect(requestGateway).toHaveBeenCalledTimes(2)
  })

  it('a rejected flight is not cached: the next caller retries', async () => {
    const run = vi
      .fn<() => Promise<{ session_id: string }>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ session_id: 'rt-second' })

    await expect(singleFlightSessionResume('stored-a', run)).rejects.toThrow('boom')
    await expect(singleFlightSessionResume('stored-a', run)).resolves.toEqual({ session_id: 'rt-second' })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('an unsettled resume is cancelled at the deadline and the slot is released', async () => {
    vi.useFakeTimers()

    const signals: (AbortSignal | undefined)[] = []
    const requestGateway = vi.fn(
      (_method: string, _params?: Record<string, unknown>, _timeoutMs?: number, signal?: AbortSignal) => {
        signals.push(signal)

        // Never settles — the wedged-flight case.
        return new Promise<never>(() => {})
      }
    )

    const deps = { requestGateway: requestGateway as never, resolveProfile: async () => undefined }

    const wedged = resumeStoredRuntimeSession('stored-a', deps)
    const wedgedRejection = expect(wedged).rejects.toThrow(/timed out/i)

    await vi.advanceTimersByTimeAsync(SESSION_RESUME_DEADLINE_MS + 1)
    await wedgedRejection

    // A cancellation reached the in-flight resume's gateway request.
    expect(signals[0]?.aborted).toBe(true)

    // The slot is released: a subsequent resume for the same stored id is admitted.
    requestGateway.mockImplementation(async () => ({ session_id: 'rt-after' }) as never)

    await expect(resumeStoredRuntimeSession('stored-a', deps)).resolves.toBe('rt-after')
    expect(requestGateway).toHaveBeenCalledTimes(2)
  })

  it('a resume that settles after its deadline registers the minted runtime as adoptable', async () => {
    vi.useFakeTimers()

    let resolveResume: ((value: { session_id: string }) => void) | undefined
    const requestGateway = vi.fn(
      () =>
        new Promise<{ session_id: string }>(resolve => {
          resolveResume = resolve
        })
    )

    const deps = { requestGateway: requestGateway as never, resolveProfile: async () => undefined }

    const late = resumeStoredRuntimeSession('stored-a', deps)
    const lateRejection = expect(late).rejects.toThrow(/timed out/i)

    await vi.advanceTimersByTimeAsync(SESSION_RESUME_DEADLINE_MS + 1)
    await lateRejection

    // The gateway still finishes the resume and mints a real runtime; it must
    // land in the recovered-runtime cache, not strand for the orphan reaper.
    resolveResume?.({ session_id: 'rt-late' })
    await vi.advanceTimersByTimeAsync(0)

    expect(takeRecoveredRuntime('stored-a')).toBe('rt-late')
  })
})

describe('drift-abort recovered-runtime cache', () => {
  it('drift-abort does not strand the recovered runtime — it is registered in the cache', async () => {
    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        return { session_id: 'rt-recovered' }
      }

      throw new Error('unexpected call')
    })

    const call = vi.fn(async (liveId: string) => {
      if (liveId === 'rt-dead') {
        throw new Error('session not found: rt-dead')
      }

      return 'ok'
    })

    await expect(
      withSessionNotFoundResume('rt-dead', 'stored-a', call, {
        requestGateway: requestGateway as never,
        resolveProfile: async () => undefined,
        driftReason: () => 'user switched away'
      })
    ).rejects.toThrow(SessionRecoveryAborted)

    // The freshly-minted runtime is NOT abandoned: the next action reuses it.
    expect(takeRecoveredRuntime('stored-a')).toBe('rt-recovered')
    // Take-semantics: consumed exactly once.
    expect(takeRecoveredRuntime('stored-a')).toBeUndefined()
  })

  it('a later non-drifted recovery adopts the cached runtime instead of resuming again', async () => {
    registerRecoveredRuntime('stored-a', 'rt-cached')

    const requestGateway = vi.fn(async () => {
      throw new Error('session.resume must not be called when a cached runtime exists')
    })

    const onRecovered = vi.fn()

    const call = vi.fn(async (liveId: string) => {
      if (liveId === 'rt-dead') {
        throw new Error('session not found: rt-dead')
      }

      return `ran-on-${liveId}`
    })

    const outcome = await withSessionNotFoundResume('rt-dead', 'stored-a', call, {
      requestGateway: requestGateway as never,
      resolveProfile: async () => undefined,
      onRecovered
    })

    expect(outcome).toEqual({ recovered: true, result: 'ran-on-rt-cached', sessionId: 'rt-cached' })
    expect(onRecovered).toHaveBeenCalledWith('rt-cached')
    expect(requestGateway).not.toHaveBeenCalled()
  })

  it('takeRecoveredRuntime skips a cached id the caller already knows is dead', () => {
    registerRecoveredRuntime('stored-a', 'rt-dead')

    expect(takeRecoveredRuntime('stored-a', 'rt-dead')).toBeUndefined()
    expect(takeRecoveredRuntime('stored-a')).toBeUndefined()
  })
})
