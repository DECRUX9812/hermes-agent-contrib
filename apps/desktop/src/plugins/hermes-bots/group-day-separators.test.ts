import { describe, expect, it } from 'vitest'

import { roomDayBucket, roomDayLabel } from './group-day-separators'

describe('room day separators', () => {
  it('labels local days across a month boundary', () => {
    const now = new Date(2026, 2, 1, 12).getTime()
    const labels = { today: 'Today', yesterday: 'Yesterday' }

    expect(roomDayLabel(roomDayBucket(now), labels, now)).toBe('Today')
    expect(roomDayLabel(roomDayBucket(new Date(2026, 1, 28, 23).getTime()), labels, now)).toBe('Yesterday')
    expect(roomDayBucket(new Date(2026, 2, 1, 1).getTime())).toBe(roomDayBucket(now))
  })
})
