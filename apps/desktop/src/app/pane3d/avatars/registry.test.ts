import { describe, expect, it } from 'vitest'

import { claude } from './claude'
import { grok } from './grok'
import { hermes } from './hermes'
import { muse } from './muse'
import { opencode } from './opencode'
import { getAvatar, hasAvatar, listAvatars, registerAvatar } from './registry'
import type { AvatarDefinition } from './types'

const CAST = [muse, hermes, grok, opencode, claude]

/** The four palette colors, order-independent, as one comparable signature. */
const paletteSignature = (definition: AvatarDefinition) => Object.values(definition.palette).slice().sort().join('|')

describe('avatar registry', () => {
  it('lists the whole cast, each with a Body, a sane height and a distinct palette', () => {
    const avatars = listAvatars()

    for (const definition of CAST) {
      const found = avatars.find(avatar => avatar.id === definition.id)

      expect(found, `${definition.id} is registered`).toBeDefined()
      expect(found?.Body).toBeTypeOf('function')
      expect(found?.displayName.length).toBeGreaterThan(0)
      // 1 world unit ≈ 120 px; the art direction keeps every avatar 0.8–1.3.
      expect(found?.height).toBeGreaterThanOrEqual(0.8)
      expect(found?.height).toBeLessThanOrEqual(1.3)
      // The perch layout needs each silhouette's real width to avoid overlap.
      expect(found?.width, `${definition.id} width`).toBeGreaterThan(0.5)
      // Four distinct colors within a palette (no copy-paste palette).
      expect(new Set(Object.values(found?.palette ?? {})).size).toBe(4)
    }

    // Every pair of avatars is visually distinct by palette.
    const signatures = CAST.map(paletteSignature)

    expect(new Set(signatures).size).toBe(CAST.length)
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
    expect(() => getAvatar('nobody' as never)).toThrow(/nobody/)
  })
})
