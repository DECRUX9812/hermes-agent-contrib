import { describe, expect, it } from 'vitest'

import { BACKDROP_SCENES, BACKDROP_STRENGTHS, backdropLayer, sceneFromLegacy, sceneSwatch } from './backdrop-scenes'

const MODES = ['dark', 'light'] as const

describe('chat background scenes', () => {
  it('paints every scene in both modes, and nothing for off or a custom scene with no image', () => {
    for (const scene of BACKDROP_SCENES) {
      for (const mode of MODES) {
        const layer = backdropLayer(scene, 'balanced', mode, 'data:image/jpeg;base64,x', '/statue.jpg')

        if (scene === 'off') {
          expect(layer).toBeNull()
        } else {
          expect(layer?.background || layer?.image).toBeTruthy()
          expect(layer!.opacity).toBeGreaterThan(0)
        }
      }
    }

    expect(backdropLayer('custom', 'vivid', 'dark', null, '/statue.jpg')).toBeNull()
  })

  it('blends so text keeps its contrast: multiply on light surfaces, screen on dark ones', () => {
    for (const scene of BACKDROP_SCENES.filter(s => s !== 'off' && s !== 'statue')) {
      expect(backdropLayer(scene, 'vivid', 'light', 'data:x', '')!.blend).toBe('multiply')
      expect(backdropLayer(scene, 'vivid', 'dark', 'data:x', '')!.blend).toBe('screen')
    }

    expect(backdropLayer('statue', 'balanced', 'light', null, '/s.jpg')!.blend).toBe('difference')
  })

  it('strength only ever turns a scene up', () => {
    for (const scene of BACKDROP_SCENES.filter(s => s !== 'off')) {
      for (const mode of MODES) {
        const opacities = BACKDROP_STRENGTHS.map(
          strength => backdropLayer(scene, strength, mode, 'data:x', '/statue.jpg')!.opacity
        )

        expect([...opacities].sort((a, b) => a - b)).toEqual(opacities)
        expect(new Set(opacities).size).toBe(opacities.length)
      }
    }
  })

  it("keeps the v1 statue's look at the default strength and v1's boolean meaning", () => {
    expect(backdropLayer('statue', 'balanced', 'dark', null, '/s.jpg')).toMatchObject({
      image: '/s.jpg',
      opacity: 0.025
    })
    expect(sceneFromLegacy('true')).toBe('statue')
    expect(sceneFromLegacy('false')).toBe('off')
    expect(sceneFromLegacy(null)).toBe('off')
  })

  it('previews a scene tile with the same paint the chat gets', () => {
    expect(sceneSwatch('aurora', 'dark', null)).toBe(backdropLayer('aurora', 'vivid', 'dark', null, '')!.background)
    expect(sceneSwatch('custom', 'dark', 'data:x')).toContain('data:x')
    expect(sceneSwatch('custom', 'dark', null)).toBe('none')
  })
})
