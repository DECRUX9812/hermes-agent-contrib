import { describe, expect, it } from 'vitest'

import { BACKDROP_SCENES, BACKDROP_STRENGTHS, backdropLayer, sceneFromLegacy, sceneSwatch } from './backdrop-scenes'

const MODES = ['dark', 'light'] as const
const asset = (file: string) => `/${file}`

describe('chat background scenes', () => {
  it('paints every scene in both modes, and nothing for off or a custom scene with no image', () => {
    for (const scene of BACKDROP_SCENES) {
      for (const mode of MODES) {
        const layer = backdropLayer(scene, 'balanced', mode, 'data:image/jpeg;base64,x', asset)

        if (scene === 'off') {
          expect(layer).toBeNull()
        } else {
          expect(layer?.background || layer?.image).toBeTruthy()
          expect(layer!.opacity).toBeGreaterThan(0)
        }
      }
    }

    expect(backdropLayer('custom', 'vivid', 'dark', null, asset)).toBeNull()
  })

  it('blends so text keeps its contrast: multiply on light surfaces, screen on dark ones', () => {
    for (const scene of BACKDROP_SCENES.filter(s => s !== 'off' && s !== 'statue')) {
      expect(backdropLayer(scene, 'vivid', 'light', 'data:x', asset)!.blend).toBe('multiply')
      expect(['screen', 'soft-light']).toContain(backdropLayer(scene, 'vivid', 'dark', 'data:x', asset)!.blend)
    }

    expect(backdropLayer('statue', 'balanced', 'light', null, asset)!.blend).toBe('difference')
  })

  it('strength only ever turns a scene up', () => {
    for (const scene of BACKDROP_SCENES.filter(s => s !== 'off')) {
      for (const mode of MODES) {
        const opacities = BACKDROP_STRENGTHS.map(
          strength => backdropLayer(scene, strength, mode, 'data:x', asset)!.opacity
        )

        expect([...opacities].sort((a, b) => a - b)).toEqual(opacities)
        expect(new Set(opacities).size).toBe(opacities.length)
      }
    }
  })

  it("keeps the v1 statue's look at the default strength and v1's boolean meaning", () => {
    expect(backdropLayer('statue', 'balanced', 'dark', null, asset)).toMatchObject({
      image: '/ds-assets/filler-bg0.jpg',
      opacity: 0.025
    })
    expect(sceneFromLegacy('true')).toBe('statue')
    expect(sceneFromLegacy('false')).toBe('off')
    expect(sceneFromLegacy(null)).toBe('off')
  })

  it('paints the shipped Nous art through the app asset resolver', () => {
    expect(backdropLayer('cyanotype', 'balanced', 'light', null, asset)!.background).toContain(
      '/ds-assets/filler-bg0.jpg'
    )
    expect(backdropLayer('ink', 'balanced', 'light', null, asset)!.background).toContain('/ds-assets/nous-ink.svg')
  })

  it('keeps the white ink line art visible under its blend in both modes', () => {
    // Multiply leaves white unchanged and screen leaves black unchanged: the lines
    // must reach a light surface dark and a dark surface light.
    for (const mode of ['dark', 'light'] as const) {
      const layer = backdropLayer('ink', 'balanced', mode, null, asset)!
      const lines = layer.invert ? 'black' : 'white'

      expect(layer.blend === 'multiply' ? lines : 'black').toBe('black')
      expect(layer.blend === 'screen' ? lines : 'white').toBe('white')
      expect(sceneSwatch('ink', mode, null, asset)!.invert).toBe(layer.invert)
    }
  })

  it('previews a scene tile with the same paint the chat gets', () => {
    expect(sceneSwatch('aurora', 'dark', null, asset)!.background).toBe(
      backdropLayer('aurora', 'vivid', 'dark', null, asset)!.background
    )
    expect(sceneSwatch('custom', 'dark', 'data:x', asset)!.background).toContain('data:x')
    expect(sceneSwatch('custom', 'dark', null, asset)).toBeNull()
  })
})
