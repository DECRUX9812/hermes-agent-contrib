import { expect, it } from 'vitest'

import { roomDayBucket, roomDayLabel } from './group-day-separators'

const LABELS = { today: 'Today', yesterday: 'Yesterday' }

/** A fixed local afternoon, so the assertions don't depend on the wall clock. */
const afternoon = (year: number, month: number, day: number) => new Date(year, month, day, 15, 30).getTime()

it('buckets an entry into its local midnight', () => {
  expect(roomDayBucket(afternoon(2026, 9, 9))).toBe(new Date(2026, 9, 9).getTime())
})

it('treats a missing timestamp as the epoch bucket instead of crashing', () => {
  // The local calendar day the epoch instant falls in — the host's zone
  // decides which side of UTC that is, so derive it instead of hardcoding.
  const epoch = new Date(0)

  expect(roomDayBucket(Number.NaN)).toBe(roomDayBucket(0))
  expect(roomDayBucket(0)).toBe(new Date(epoch.getFullYear(), epoch.getMonth(), epoch.getDate()).getTime())
})

it('labels today and yesterday by name, and older days by date', () => {
  const now = afternoon(2026, 9, 9)

  expect(roomDayLabel(roomDayBucket(now), LABELS, now)).toBe('Today')
  expect(roomDayLabel(roomDayBucket(afternoon(2026, 9, 8)), LABELS, now)).toBe('Yesterday')

  // Older: a calendar date. The exact rendering is the locale's, so assert
  // the shape (day + month), not a literal.
  const older = roomDayLabel(roomDayBucket(afternoon(2026, 8, 21)), LABELS, now)
  expect(older).toMatch(/21/)
  expect(older).not.toContain('2026')
})

it('names the year for older days that are not this year', () => {
  const now = afternoon(2026, 9, 9)
  const lastYear = roomDayLabel(roomDayBucket(afternoon(2025, 11, 31)), LABELS, now)

  expect(lastYear).toContain('2025')
})

it('counts a 23-hour DST day as one day, not two', () => {
  // US spring-forward 2026: the local day starting Mar 8 is 23h long, so the
  // bucket gap to Mar 9 midnight is 23h. Floored that rounds to 0 ("Today");
  // the rounded delta keeps the label at Yesterday.
  const before = new Date(2026, 2, 8, 23, 30).getTime()
  const now = new Date(2026, 2, 9, 0, 30).getTime()

  expect(roomDayLabel(roomDayBucket(before), LABELS, now)).toBe('Yesterday')
})
