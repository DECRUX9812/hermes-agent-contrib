import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $notificationRules,
  AMBIENT_RULE_KINDS,
  clearDigestQueue,
  enqueueDigestEntry,
  flushDigest,
  gateNativeByRules,
  pendingDigestEntries,
  quietHoursActive,
  setDigestEnabled,
  setQuietHoursEnabled,
  setQuietHoursWindow
} from './notification-rules'

const desktopWindow = window as unknown as { hermesDesktop?: Window['hermesDesktop'] }
const initialHermesDesktop = desktopWindow.hermesDesktop
const notify = vi.fn().mockResolvedValue(true)

const RULES_KEY = 'hermes:notification-rules'

const at = (hours: number, minutes = 0): Date => new Date(2026, 0, 15, hours, minutes)

const resetRules = (): void => {
  $notificationRules.set({ digest: false, quietHours: { enabled: false, end: '08:00', start: '22:00' } })
}

beforeEach(() => {
  localStorage.removeItem(RULES_KEY)
  resetRules()
  desktopWindow.hermesDesktop = { notify } as unknown as Window['hermesDesktop']
  notify.mockClear()
  clearDigestQueue()
})

afterEach(() => {
  vi.useRealTimers()
  clearDigestQueue()
  resetRules()
  localStorage.removeItem(RULES_KEY)

  if (initialHermesDesktop === undefined) {
    delete desktopWindow.hermesDesktop
  } else {
    desktopWindow.hermesDesktop = initialHermesDesktop
  }
})

describe('quietHoursActive', () => {
  it('is off while disabled, whatever the clock says', () => {
    expect(quietHoursActive($notificationRules.get(), at(23))).toBe(false)
  })

  it('wraps midnight: late evening and early morning are both quiet', () => {
    setQuietHoursEnabled(true)
    const rules = $notificationRules.get()

    expect(quietHoursActive(rules, at(22))).toBe(true)
    expect(quietHoursActive(rules, at(23, 59))).toBe(true)
    expect(quietHoursActive(rules, at(0, 30))).toBe(true)
    expect(quietHoursActive(rules, at(7, 59))).toBe(true)
    expect(quietHoursActive(rules, at(8))).toBe(false)
    expect(quietHoursActive(rules, at(12))).toBe(false)
  })

  it('handles a same-day window', () => {
    setQuietHoursWindow('09:00', '17:00')
    setQuietHoursEnabled(true)
    const rules = $notificationRules.get()

    expect(quietHoursActive(rules, at(9))).toBe(true)
    expect(quietHoursActive(rules, at(16, 59))).toBe(true)
    expect(quietHoursActive(rules, at(17))).toBe(false)
    expect(quietHoursActive(rules, at(8))).toBe(false)
  })

  it('treats start == end as off rather than always-quiet', () => {
    setQuietHoursWindow('10:00', '10:00')
    setQuietHoursEnabled(true)

    expect(quietHoursActive($notificationRules.get(), at(10))).toBe(false)
    expect(quietHoursActive($notificationRules.get(), at(22))).toBe(false)
  })
})

describe('setQuietHoursWindow', () => {
  it('rejects malformed times and keeps the previous value', () => {
    setQuietHoursWindow('25:99', 'morning')
    expect($notificationRules.get().quietHours.start).toBe('22:00')
    expect($notificationRules.get().quietHours.end).toBe('08:00')

    setQuietHoursWindow('21:30', '06:15')
    expect($notificationRules.get().quietHours).toMatchObject({ end: '06:15', start: '21:30' })
  })

  it('persists rules so a restart keeps them', () => {
    setQuietHoursEnabled(true)
    setDigestEnabled(true)

    const stored = JSON.parse(localStorage.getItem(RULES_KEY) ?? '{}')
    expect(stored.quietHours.enabled).toBe(true)
    expect(stored.digest).toBe(true)
  })
})

describe('gateNativeByRules', () => {
  it('always fires kinds that are already waiting on the user', () => {
    setQuietHoursEnabled(true)
    setDigestEnabled(true)

    for (const kind of ['approval', 'input', 'turnError'] as const) {
      expect(AMBIENT_RULE_KINDS.has(kind)).toBe(false)
      expect(gateNativeByRules(kind, at(23))).toBe('fire')
    }
  })

  it('holds ambient kinds during quiet hours', () => {
    setQuietHoursEnabled(true)

    for (const kind of AMBIENT_RULE_KINDS) {
      expect(gateNativeByRules(kind, at(23))).toBe('hold')
      expect(gateNativeByRules(kind, at(12))).toBe('fire')
    }
  })

  it('holds ambient kinds around the clock in digest mode', () => {
    setDigestEnabled(true)

    expect(gateNativeByRules('turnDone', at(12))).toBe('hold')
    expect(gateNativeByRules('credits', at(12))).toBe('hold')
  })

  it('fires ambient kinds when no rule applies', () => {
    expect(gateNativeByRules('turnDone', at(23))).toBe('fire')
  })
})

describe('digest queue', () => {
  const entry = (kind: 'credits' | 'turnDone', title: string, sessionId?: string) =>
    enqueueDigestEntry({ body: `body-${title}`, kind, sessionId: sessionId ?? null, title })

  it('batches held entries into a single digest notification', () => {
    setDigestEnabled(true)
    entry('credits', 'third')
    entry('turnDone', 'first', 's-1')
    entry('turnDone', 'second', 's-2')

    expect(pendingDigestEntries()).toHaveLength(3)
    expect(flushDigest(at(12))).toBe(true)

    expect(pendingDigestEntries()).toHaveLength(0)
    expect(notify).toHaveBeenCalledTimes(1)
    const arg = notify.mock.calls[0][0]
    expect(arg.kind).toBe('digest')
    expect(arg.sessionId).toBe('s-2')
    expect(arg.title).toContain('3')
    expect(arg.body).toContain('2 ×')
    expect(arg.body).toContain('second')
  })

  it('never flushes inside the quiet window', () => {
    setQuietHoursEnabled(true)
    entry('turnDone', 'held', 's-1')

    expect(flushDigest(at(23))).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(pendingDigestEntries()).toHaveLength(1)
  })

  it('flushes an orphaned queue right away when its rule is switched off', () => {
    vi.useFakeTimers()
    setDigestEnabled(true)
    entry('turnDone', 'queued', 's-1')
    expect(pendingDigestEntries()).toHaveLength(1)

    setDigestEnabled(false)
    vi.advanceTimersByTime(10)

    expect(notify).toHaveBeenCalledTimes(1)
    expect(pendingDigestEntries()).toHaveLength(0)
  })

  it('clearDigestQueue drops pending entries without notifying', () => {
    setDigestEnabled(true)
    entry('turnDone', 'gone')

    clearDigestQueue()
    expect(pendingDigestEntries()).toHaveLength(0)
    expect(flushDigest(at(12))).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })
})
