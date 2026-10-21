/**
 * The notification read timeout (architecture §8.5): 9 s after a card is shown,
 * unless the pointer is over it — hovering PAUSES the timer, and leaving resumes
 * with the remaining time rather than restarting it.
 *
 * `now` is injectable so the pause/resume contract is unit-testable; production
 * uses the real clock and `setTimeout`.
 */
export const NOTIFY_SETTLE_MS = 9_000

interface Entry {
  /** `now()` at which the card would settle while running. */
  deadline: number
  /** Non-null while armed; null while paused. */
  handle: ReturnType<typeof setTimeout> | null
  /** Time left when last paused. */
  remaining: number
}

export class SettleTimer {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly onSettle: (id: string) => void,
    private readonly duration: number = NOTIFY_SETTLE_MS,
    // Called per read, never captured: a fake clock installed after the timer
    // was constructed must still be observed.
    private readonly now: () => number = () => Date.now()
  ) {}

  start(id: string): void {
    this.arm(id, this.duration)
  }

  pause(id: string): void {
    const entry = this.entries.get(id)

    if (!entry || entry.handle === null) {
      return
    }

    clearTimeout(entry.handle)
    entry.remaining = Math.max(0, entry.deadline - this.now())
    entry.handle = null
  }

  resume(id: string): void {
    const entry = this.entries.get(id)

    if (!entry || entry.handle !== null) {
      return
    }

    this.arm(id, entry.remaining)
  }

  /** Drop the timer without firing the settle callback. */
  cancel(id: string): void {
    const entry = this.entries.get(id)

    if (!entry) {
      return
    }

    if (entry.handle !== null) {
      clearTimeout(entry.handle)
    }

    this.entries.delete(id)
  }

  isPaused(id: string): boolean {
    const entry = this.entries.get(id)

    return Boolean(entry && entry.handle === null)
  }

  remaining(id: string): number | null {
    const entry = this.entries.get(id)

    return entry ? Math.max(0, entry.deadline - this.now()) : null
  }

  clear(): void {
    this.entries.forEach(entry => {
      if (entry.handle !== null) {
        clearTimeout(entry.handle)
      }
    })
    this.entries.clear()
  }

  private arm(id: string, ms: number): void {
    const handle = setTimeout(() => {
      this.entries.delete(id)
      this.onSettle(id)
    }, ms)

    this.entries.set(id, { deadline: this.now() + ms, handle, remaining: ms })
  }
}
