/**
 * Single-flight guard for `session.resume`, keyed by STORED session id.
 *
 * After sleep/wake or a reconnect, many independent surfaces discover the same
 * dead runtime at once — submit recovery, slash/rewind recovery, tile resumes,
 * the route resolver — and each used to fire its own `session.resume` for the
 * same durable conversation. The gateway happily mints a runtime per call and
 * the losers become orphans for the reaper (#91276 storm).
 *
 * Module-level so EVERY call site in the window shares one in-flight promise
 * per stored id, no matter which hook instance it lives in. All participating
 * callers resolve to a `session.resume`-shaped response (an object carrying
 * `session_id`); joiners receive whatever the winning call returns.
 */

const _inFlightResumeByStoredSessionId = new Map<string, Promise<unknown>>()
const _resumeDeadlineTimers = new Set<ReturnType<typeof setTimeout>>()

// Bound on one shared resume flight. A session.resume that never settles
// (wedged backend event loop, a dial that hangs before the RPC is even sent)
// would otherwise hold the slot forever and force-break callers into minting
// orphans. Generous on purpose: a cold resume builds the agent (MCP discovery,
// prompt build) before answering, and the gateway channel applies its own
// tighter per-request timeout underneath.
export const SESSION_RESUME_DEADLINE_MS = 120_000

export function singleFlightSessionResume<T>(
  storedSessionId: string,
  run: (signal: AbortSignal) => Promise<T>,
  options?: { deadlineMs?: number }
): Promise<T> {
  const existing = _inFlightResumeByStoredSessionId.get(storedSessionId)

  if (existing) {
    return existing as Promise<T>
  }

  const deadlineMs = options?.deadlineMs ?? SESSION_RESUME_DEADLINE_MS
  const controller = new AbortController()
  let expired = false

  // Promise.resolve().then(run) tolerates run() being synchronous, returning a
  // bare value, or throwing synchronously (test doubles and legacy callers do
  // all three) — a raw run().finally() would crash on a non-promise return.
  const outcome = Promise.resolve().then(() => run(controller.signal))

  let timer!: ReturnType<typeof setTimeout>

  const flight = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      _resumeDeadlineTimers.delete(timer)
      expired = true
      // Cancel the in-flight resume: the abort drops the pending gateway
      // request, and rejecting the flight frees the slot so the next caller
      // is admitted instead of joining a dead one.
      controller.abort()
      reject(new Error(`request timed out after ${Math.round(deadlineMs / 1000)}s: session.resume`))
    }, deadlineMs)

    _resumeDeadlineTimers.add(timer)

    outcome.then(
      value => {
        if (expired) {
          // The cancelled resume still minted a real runtime on the gateway.
          // Park it in the recovered-runtime cache so the next resume-shaped
          // action adopts it instead of stranding it for the reaper.
          const runtimeId =
            typeof value === 'object' && value !== null ? (value as { session_id?: unknown }).session_id : undefined

          if (typeof runtimeId === 'string' && runtimeId) {
            registerRecoveredRuntime(storedSessionId, runtimeId)
          }

          return
        }

        resolve(value)
      },
      error => {
        if (!expired) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
    )
  })

  const tracked = flight.finally(() => {
    _resumeDeadlineTimers.delete(timer)
    clearTimeout(timer)

    if (_inFlightResumeByStoredSessionId.get(storedSessionId) === tracked) {
      _inFlightResumeByStoredSessionId.delete(storedSessionId)
    }
  })

  _inFlightResumeByStoredSessionId.set(storedSessionId, tracked)

  return tracked
}

/**
 * Adopt-or-reuse cache for recovered runtimes a drift-abort walked away from.
 *
 * A recovery resume can succeed while the caller's drift check says the user
 * moved on (SessionRecoveryAborted). The freshly-minted runtime is REAL and
 * registered on the gateway; abandoning the id client-side strands it for the
 * orphan reaper AND makes the next action for the same stored session mint yet
 * another runtime. When adoption (rebinding the caller's runtime ref via
 * onRecovered/onRuntimeRecovered) is wrong — the user is elsewhere — record it
 * here so the next resume-shaped action reuses it instead of re-minting.
 */
const _recoveredRuntimeByStoredSessionId = new Map<string, string>()

export function registerRecoveredRuntime(storedSessionId: string, runtimeId: string): void {
  if (storedSessionId && runtimeId) {
    _recoveredRuntimeByStoredSessionId.set(storedSessionId, runtimeId)
  }
}

/**
 * Consume a previously-abandoned recovered runtime for this stored session.
 * Take-semantics: the entry is removed so a dead cached id can only cost one
 * bounded retry, never a loop. `deadRuntimeId` skips (and drops) the entry
 * when the caller already knows that exact runtime is dead.
 */
export function takeRecoveredRuntime(storedSessionId: string, deadRuntimeId?: null | string): string | undefined {
  const cached = _recoveredRuntimeByStoredSessionId.get(storedSessionId)

  if (cached === undefined) {
    return undefined
  }

  _recoveredRuntimeByStoredSessionId.delete(storedSessionId)

  return deadRuntimeId && cached === deadRuntimeId ? undefined : cached
}

/** Test seam: reset all module-level single-flight/recovery state. */
export function clearSingleFlightSessionResumeState(): void {
  for (const timer of _resumeDeadlineTimers) {
    clearTimeout(timer)
  }

  _resumeDeadlineTimers.clear()
  _inFlightResumeByStoredSessionId.clear()
  _recoveredRuntimeByStoredSessionId.clear()
}
