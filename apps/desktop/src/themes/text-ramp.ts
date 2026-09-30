/**
 * The muted-text ramp — how much of the theme foreground the tertiary and quaternary text
 * tokens carry. Same idea as the surface `--theme-mix-*` knobs: styles.css holds the fallbacks,
 * `applyTheme` sets them inline, and this table is the one place the numbers live so a contract
 * test can hold every built-in skin to a legibility floor.
 *
 * Light needs more ink than dark for the same perceived weight: a mid-grey on white falls
 * under 4.5:1 long before its dark-mode mirror does, which is why one shared alpha left light
 * skins' meta text (timestamps, paths, hints) faint.
 */

import { contrastRatio, mix } from '@hermes/shared/color'

export type TextTier = 'quaternary' | 'tertiary'

/** Share of the foreground carried by each tier, per rendered mode. */
export const TEXT_MIX = {
  dark: { quaternary: 0.36, tertiary: 0.54 },
  light: { quaternary: 0.5, tertiary: 0.64 }
} as const

/** WCAG floors the ramp is held to: tertiary is body-adjacent meta text (AA); quaternary is
 *  incidental (placeholders, separators' labels) and only has to stay readable at 3:1. */
export const TEXT_CONTRAST_FLOOR: Record<TextTier, number> = { quaternary: 3, tertiary: 4.5 }

/** Tiers stay quieter than secondary text (74%) whatever a skin needs: past these caps the
 *  hierarchy collapses, so a skin whose own foreground is too faint to reach a floor gets the
 *  best the cap allows rather than a tertiary that shouts as loud as body copy. */
export const TEXT_MIX_CAP: Record<TextTier, number> = { quaternary: 0.62, tertiary: 0.72 }

const percent = (n: number) => `${Math.round(n * 100)}%`

/** The colour a tier renders as over `background` at share `t` of the foreground. */
const inkAt = (foreground: string, background: string, t: number): string => mix(background, foreground, t)

/**
 * The share of `foreground` a tier should carry on this skin: the mode's baseline, raised just
 * enough that the tier clears its contrast floor over every surface it sits on — never past
 * `TEXT_MIX_CAP`. Skins with a strong foreground keep the baseline; a low-contrast palette
 * (solarized, catppuccin-latte) gets exactly the lift it needs and no more.
 */
export function resolveTextMix(
  foreground: string,
  surfaces: readonly string[],
  tier: TextTier,
  isDark: boolean
): number {
  const base: number = TEXT_MIX[isDark ? 'dark' : 'light'][tier]
  const cap = TEXT_MIX_CAP[tier]
  const floor = TEXT_CONTRAST_FLOOR[tier]
  let need: number = base

  for (const surface of surfaces) {
    const ratioAt = (t: number) => contrastRatio(inkAt(foreground, surface, t), surface)

    if (ratioAt(1) === null) {
      continue // unparseable (expression-valued seed): the browser resolves it, we can't judge it
    }

    let lo: number = base
    let hi = cap

    if ((ratioAt(lo) ?? 0) >= floor) {
      continue
    }

    if ((ratioAt(hi) ?? 0) < floor) {
      need = Math.max(need, cap) // unreachable: best effort at the cap

      continue
    }

    for (let step = 0; step < 12; step += 1) {
      const midpoint = (lo + hi) / 2

      if ((ratioAt(midpoint) ?? 0) >= floor) {hi = midpoint}
      else {lo = midpoint}
    }

    need = Math.max(need, hi)
  }

  return Math.min(cap, need)
}

/** Inline CSS knobs for `mixesFor` in themes/context.tsx, resolved for one skin. */
export const textMixKnobs = (
  foreground: string,
  surfaces: readonly string[],
  isDark: boolean
): Record<string, string> => ({
  '--theme-mix-text-quaternary': percent(resolveTextMix(foreground, surfaces, 'quaternary', isDark)),
  '--theme-mix-text-tertiary': percent(resolveTextMix(foreground, surfaces, 'tertiary', isDark))
})

/** The colour a tier renders as over `background` for this skin (what
 *  `color-mix(fg N%, transparent)` paints). */
export const textInk = (foreground: string, surfaces: readonly string[], background: string, tier: TextTier, isDark: boolean): string =>
  inkAt(foreground, background, resolveTextMix(foreground, surfaces, tier, isDark))
