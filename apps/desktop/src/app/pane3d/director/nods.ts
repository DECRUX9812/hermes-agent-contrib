/**
 * Token-burst nod signals (architecture §8.4, §8.7).
 *
 * The rig must NOT schedule responding nods on a loop (pane3d-fix-rig-motion
 * removed exactly that): a nod is one small gesture per token BURST from the
 * task executor. This module is the seam — `director/tasks.ts` signals every
 * token, the rate limiter turns a burst into a single nod start, and the rig
 * reads that start and applies the pure `nodPitch` envelope. A stalled stream
 * signals nothing, so it produces no nods.
 *
 * The limiter is a pure function of the timestamps, so the ≤2/s bound is
 * unit-testable without a frame loop.
 */

import type { AvatarId } from '../protocol'

/** At most one nod per avatar per this window: two nods a second, never three. */
export const NOD_MIN_INTERVAL_MS = 500

export function shouldNod(lastNodAt: number | null, now: number, minIntervalMs: number = NOD_MIN_INTERVAL_MS): boolean {
  return lastNodAt === null || now - lastNodAt >= minIntervalMs
}

/** Per-avatar burst limiter: `signal` coalesces a burst, `start` feeds the rig. */
export class NodSignals {
  private readonly last = new Map<AvatarId, number>()
  private readonly starts = new Map<AvatarId, number>()

  /** True when this token starts a new nod; false when it belongs to the last one. */
  signal(id: AvatarId, now: number): boolean {
    if (!shouldNod(this.last.get(id) ?? null, now)) {
      return false
    }

    this.last.set(id, now)
    this.starts.set(id, now)

    return true
  }

  /** `performance.now()` of the newest nod, or null when the avatar never nodded. */
  start(id: AvatarId): number | null {
    return this.starts.get(id) ?? null
  }

  clear(id?: AvatarId): void {
    if (id) {
      this.last.delete(id)
      this.starts.delete(id)

      return
    }

    this.last.clear()
    this.starts.clear()
  }
}

const signals = new NodSignals()

/** Called once per streamed token; the limiter decides whether a nod starts. */
export function signalTokenBurst(id: AvatarId, now: number = performance.now()): void {
  signals.signal(id, now)
}

export function getNodStart(id: AvatarId): number | null {
  return signals.start(id)
}

export function clearNodSignals(id?: AvatarId): void {
  signals.clear(id)
}
