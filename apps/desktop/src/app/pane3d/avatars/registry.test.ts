import { describe, expect, it } from 'vitest'

import { muse } from './muse'
import { getAvatar, hasAvatar, listAvatars, registerAvatar } from './registry'

describe('avatar registry', () => {
  it('lists only registered avatars, with a Body and a distinct palette', () => {
    const avatars = listAvatars()

    expect(avatars.map(a => a.id)).toContain('muse')
    const found = avatars.find(a => a.id === 'muse')

    expect(found?.Body).toBeTypeOf('function')
    expect(found?.displayName).toBe('Muse')
    expect(found?.height).toBeGreaterThan(1)
    expect(new Set(Object.values(found?.palette ?? {})).size).toBe(4)
  })

  it('is idempotent by id so HMR cannot duplicate a body', () => {
    const before = listAvatars().length

    registerAvatar(muse)
    registerAvatar({ ...muse, displayName: 'Muse II' })

    expect(listAvatars().length).toBe(before)
    expect(getAvatar('muse').displayName).toBe('Muse II')
    // Restore the real definition for the other tests in this file.
    registerAvatar(muse)
  })

  it('resolves a registered avatar and rejects an unknown one', () => {
    expect(hasAvatar('muse')).toBe(true)
    expect(getAvatar('muse').id).toBe('muse')
    expect(() => getAvatar('grok')).toThrow(/grok/)
  })
})
