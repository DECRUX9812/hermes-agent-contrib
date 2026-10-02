/**
 * Legibility contract for the muted text ramp: on every built-in skin, in the mode it renders,
 * tertiary and quaternary text clear their contrast floors over the surfaces they sit on.
 * A relationship between the ramp table and the skins — not a snapshot of either — so adding a
 * skin, or nudging a palette, is checked automatically.
 */

import { contrastRatio, parseColor } from '@hermes/shared/color'
import { describe, expect, it } from 'vitest'

import { BUILTIN_THEME_LIST } from './presets'
import {
  resolveTextMix,
  TEXT_CONTRAST_FLOOR,
  TEXT_MIX,
  TEXT_MIX_CAP,
  textInk,
  textMixKnobs,
  type TextTier
} from './text-ramp'

const modes = ['light', 'dark'] as const

const cases = BUILTIN_THEME_LIST.flatMap(theme =>
  modes.map(mode => {
    // A skin without a hand-tuned dark palette reuses its light one for dark mode.
    const colors = mode === 'dark' && theme.darkColors ? theme.darkColors : theme.colors
    // `renderedMode`: a light-only skin is still light in "dark" mode — judge what it paints.
    const rendered = (parseColor(colors.background)?.[0] ?? 255) < 128 ? 'dark' : 'light'

    return { colors, label: `${theme.name} (${mode})`, rendered }
  })
)

const surfacesOf = (colors: (typeof cases)[number]['colors']) =>
  [colors.background, colors.sidebarBackground].filter((c): c is string => Boolean(c) && parseColor(c!) !== null)

describe('muted text ramp', () => {
  it.each(cases)(
    '$label: tertiary and quaternary clear their floors, or are as strong as the cap allows',
    ({ colors, rendered }) => {
      if (!parseColor(colors.foreground)) {
        return // expression-valued foreground: resolved by the browser, not judged here
      }

      const surfaces = surfacesOf(colors)

      for (const tier of ['tertiary', 'quaternary'] as TextTier[]) {
        for (const surface of surfaces) {
          const share = resolveTextMix(colors.foreground, surfaces, tier, rendered === 'dark')
          const ratio =
            contrastRatio(textInk(colors.foreground, surfaces, surface, tier, rendered === 'dark'), surface) ?? 0
          const atCap = share >= TEXT_MIX_CAP[tier] - 1e-9

          expect(
            ratio >= TEXT_CONTRAST_FLOOR[tier] || atCap,
            `${tier} on ${surface}: ${ratio.toFixed(2)}:1 at ${share.toFixed(2)}`
          ).toBe(true)
        }
      }
    }
  )

  it.each(cases)(
    '$label keeps the hierarchy: quaternary quieter than tertiary, tertiary quieter than secondary text',
    ({ colors, rendered }) => {
      if (!parseColor(colors.foreground)) {
        return
      }

      const surfaces = surfacesOf(colors)
      const dark = rendered === 'dark'
      const tertiary = resolveTextMix(colors.foreground, surfaces, 'tertiary', dark)
      const quaternary = resolveTextMix(colors.foreground, surfaces, 'quaternary', dark)
      expect(quaternary).toBeLessThanOrEqual(tertiary)
      expect(tertiary).toBeLessThan(0.74) // --ui-text-secondary
    }
  )

  it('a strong palette keeps the baseline (the lift is only as large as needed)', () => {
    expect(resolveTextMix('#000000', ['#ffffff'], 'tertiary', false)).toBe(TEXT_MIX.light.tertiary)
  })

  it('exports the knobs as percentages applyTheme can set inline', () => {
    expect(textMixKnobs('#111111', ['#ffffff'], false)['--theme-mix-text-tertiary']).toMatch(/^\d+%$/)
    expect(textMixKnobs('#eeeeee', ['#101010'], true)['--theme-mix-text-quaternary']).toMatch(/^\d+%$/)
  })
})
