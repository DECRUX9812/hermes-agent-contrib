/**
 * NOTIFICATION RULES (#39) — user-authored rules layered on top of the
 * existing notification surfaces: quiet hours (hold ambient notifications
 * overnight), digest mode (batch ambient notifications into a single hourly
 * summary), and the per-session mute set as a managed list.
 *
 * Scope is the *interruptive* surface only — native OS notifications. In-app
 * toasts and the Command Center history keep landing immediately; a held
 * notification is not lost, it arrives in the next digest.
 *
 * Blocking kinds always break through: `approval`, `input`, and `turnError`
 * are things already waiting on the user, so no rule defers them. Ambient
 * kinds (`turnDone`, `backgroundDone`, `credits`, `plugin`) are the digestible
 * ones — same distinction `ATTENTION_KINDS` draws for focus-state gating.
 *
 * Device-local, like the notification prefs it complements: these are "don't
 * interrupt THIS machine" rules, not per-profile identity.
 */

import { atom } from 'nanostores'

import { translateNow } from '@/i18n'
import { persistString, storedString } from '@/lib/storage'

import type { NativeNotificationInput, NativeNotificationKind } from './native-notifications'

export interface NotificationRules {
  /** Daily window during which ambient notifications are held for the next
   *  digest instead of firing. `start`/`end` are 'HH:MM' 24-hour strings; a
   *  start later than the end means the window wraps midnight (22:00 → 08:00). */
  quietHours: { enabled: boolean; end: string; start: string }
  /** Ambient notifications queue and ship as one hourly summary. */
  digest: boolean
}

/** Kinds the rules can defer. Everything else always breaks through. */
export const AMBIENT_RULE_KINDS: ReadonlySet<NativeNotificationKind> = new Set([
  'backgroundDone',
  'credits',
  'plugin',
  'turnDone'
])

const STORAGE_KEY = 'hermes:notification-rules'

const DEFAULT_RULES: NotificationRules = {
  quietHours: { enabled: false, end: '08:00', start: '22:00' },
  digest: false
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

const cleanTime = (value: unknown, fallback: string): string =>
  typeof value === 'string' && TIME_RE.test(value) ? value : fallback

function readRules(): NotificationRules {
  const raw = storedString(STORAGE_KEY)

  if (!raw) {
    return DEFAULT_RULES
  }

  try {
    const parsed = JSON.parse(raw) as Partial<NotificationRules>

    return {
      digest: parsed.digest === true,
      quietHours: {
        enabled: parsed.quietHours?.enabled === true,
        end: cleanTime(parsed.quietHours?.end, DEFAULT_RULES.quietHours.end),
        start: cleanTime(parsed.quietHours?.start, DEFAULT_RULES.quietHours.start)
      }
    }
  } catch {
    return DEFAULT_RULES
  }
}

export const $notificationRules = atom<NotificationRules>(readRules())

function writeRules(next: NotificationRules) {
  $notificationRules.set(next)
  persistString(STORAGE_KEY, JSON.stringify(next))
}

export function setQuietHoursEnabled(enabled: boolean) {
  const prev = $notificationRules.get()
  writeRules({ ...prev, quietHours: { ...prev.quietHours, enabled } })
  rescheduleDigest()
}

export function setQuietHoursWindow(start: string, end: string) {
  const prev = $notificationRules.get()
  writeRules({
    ...prev,
    quietHours: {
      ...prev.quietHours,
      end: cleanTime(end, prev.quietHours.end),
      start: cleanTime(start, prev.quietHours.start)
    }
  })
  rescheduleDigest()
}

export function setDigestEnabled(digest: boolean) {
  writeRules({ ...$notificationRules.get(), digest })
  rescheduleDigest()
}

const minutesOf = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number)

  return hours * 60 + minutes
}

/** True when `now` falls inside the quiet window. Wrap-aware: a 22:00 → 08:00
 *  window is "active" at both 23:00 and 07:30. A degenerate start == end
 *  window is treated as off rather than "always quiet". */
export function quietHoursActive(rules: NotificationRules, now: Date = new Date()): boolean {
  if (!rules.quietHours.enabled) {
    return false
  }

  const start = minutesOf(rules.quietHours.start)
  const end = minutesOf(rules.quietHours.end)

  if (start === end) {
    return false
  }

  const current = now.getHours() * 60 + now.getMinutes()

  return start < end ? current >= start && current < end : current >= start || current < end
}

/** Milliseconds from `now` until the quiet window's end. Only meaningful while
 *  quietHoursActive() is true — a same-day end is `end - now`, a wrapped end
 *  lands tomorrow morning. */
export function msUntilQuietHoursEnd(rules: NotificationRules, now: Date = new Date()): number {
  const end = minutesOf(rules.quietHours.end)
  const current = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
  const wrapped = current >= end ? 24 * 60 - current + end : end - current

  return Math.max(1, Math.round(wrapped * 60 * 1000))
}

/** What the rules want done with a notification right now: `fire` through the
 *  ordinary gates, or `hold` into the digest queue (quiet hours or digest
 *  mode — either way it lands in the next batched summary). */
export function gateNativeByRules(kind: NativeNotificationKind, now: Date = new Date()): 'fire' | 'hold' {
  if (!AMBIENT_RULE_KINDS.has(kind)) {
    return 'fire'
  }

  const rules = $notificationRules.get()

  if (quietHoursActive(rules, now) || rules.digest) {
    return 'hold'
  }

  return 'fire'
}

// -- digest queue ------------------------------------------------------------

export interface DigestEntry {
  at: number
  body?: string
  kind: NativeNotificationKind
  sessionId?: null | string
  title: string
}

/** A held window is one hour wide from the first queued entry; quiet hours
 *  push the flush to the window's end instead. */
const DIGEST_INTERVAL_MS = 60 * 60 * 1000

let digestQueue: DigestEntry[] = []
let digestAnchor = 0
let digestTimer: number | null = null

/** Test/debug read of what's currently waiting for the next digest. */
export const pendingDigestEntries = (): readonly DigestEntry[] => digestQueue

/** Drop the queue without sending (rule teardown, tests). */
export function clearDigestQueue(): void {
  digestQueue = []
  digestAnchor = 0

  if (digestTimer !== null) {
    window.clearTimeout(digestTimer)
    digestTimer = null
  }
}

function scheduleDigestFlush(): void {
  if (digestTimer !== null || digestQueue.length === 0) {
    return
  }

  const rules = $notificationRules.get()
  const now = new Date()

  // Inside quiet hours the whole window's queue lands at its end; digest mode
  // rides the hourly anchor from the first held entry; a queue orphaned by a
  // rule flip (both off) flushes immediately rather than stranding entries.
  const delay = quietHoursActive(rules, now)
    ? msUntilQuietHoursEnd(rules, now)
    : rules.digest
      ? Math.max(1, digestAnchor + DIGEST_INTERVAL_MS - Date.now())
      : 1

  digestTimer = window.setTimeout(() => {
    digestTimer = null
    flushDigest()
  }, delay)
}

/** Recompute the flush after a rule change: a queue with no active rule
 *  flushes right away rather than stranding entries. */
function rescheduleDigest(): void {
  if (digestTimer !== null) {
    window.clearTimeout(digestTimer)
    digestTimer = null
  }

  if (digestQueue.length > 0) {
    scheduleDigestFlush()
  }
}

/** Hold an ambient notification for the next digest. Returns nothing — the
 *  caller treats this as "suppressed now" (plugin click handlers must not
 *  register for a notification that never surfaces individually). */
export function enqueueDigestEntry(input: NativeNotificationInput): void {
  digestQueue.push({
    at: Date.now(),
    body: input.body,
    kind: input.kind,
    sessionId: input.sessionId,
    title: input.title
  })

  if (digestAnchor === 0) {
    digestAnchor = Date.now()
  }

  scheduleDigestFlush()
}

/** Compose and fire the batched summary, then clear the queue. Respects the
 *  quiet window live at flush time (a rule flip can't smuggle a notification
 *  into the quiet window by pre-scheduling). Exported for tests. */
export function flushDigest(now: Date = new Date()): boolean {
  if (digestQueue.length === 0) {
    return false
  }

  const rules = $notificationRules.get()

  if (quietHoursActive(rules, now)) {
    // Still inside the window (the timer fired early or rules changed):
    // push the flush to the real end rather than pinging mid-quiet.
    scheduleDigestFlush()

    return false
  }

  const entries = digestQueue
  digestQueue = []
  digestAnchor = 0

  // Count by kind — the summary reads "2 × Response ready · 1 × Background
  // task finished", newest session named last for scent.
  const counts = new Map<NativeNotificationKind, number>()

  for (const entry of entries) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1)
  }

  const lines = [...counts].map(([kind, count]) =>
    translateNow('notifications.digest.line', count, translateNow(`settings.notifications.kinds.${kind}.label`))
  )

  const latest = entries[entries.length - 1]

  void window.hermesDesktop?.notify({
    body: [...lines, latest.title].join('\n'),
    kind: 'digest',
    sessionId: latest.sessionId ?? undefined,
    title: translateNow('notifications.digest.title', entries.length)
  })

  return true
}
