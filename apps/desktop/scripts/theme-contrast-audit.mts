/**
 * Contrast audit for a desktop skin — the "run the contrast checker" step.
 *
 *   node --import tsx apps/desktop/scripts/theme-contrast-audit.mts [skin...]
 *
 * Runs the same relationships `text-ramp.test.ts` asserts (tertiary/quaternary
 * clear their WCAG floors, or are as strong as the hierarchy cap allows), plus
 * the pairs the ramp cannot see because they are not mixed from the foreground:
 * body ink, secondary ink, links/accents and filled-button text. Exits non-zero
 * when any judged pair fails, so it works as a gate.
 *
 * Why a script and not just the test: `vitest` needs the whole Vite project
 * config, which pulls dev-only deps that a trimmed install can be missing. This
 * imports the two modules it needs and nothing else.
 */
import { contrastRatio, parseColor } from '@hermes/shared/color'

import { BUILTIN_THEMES } from '../src/themes/presets.ts'
import {
  resolveTextMix,
  TEXT_CONTRAST_FLOOR,
  TEXT_MIX_CAP,
  textInk,
  type TextTier
} from '../src/themes/text-ramp.ts'

type Mode = 'light' | 'dark'

// The script is run with `node --import tsx`, outside the app's tsconfig
// project, so Node's globals are not in scope for the language server.
declare const process: { argv: string[]; exitCode?: number }

interface Row {
  label: string
  fg: string
  bg: string
  floor: number
}

const names = process.argv.slice(2).filter(a => !a.startsWith('-'))

/** Pairs a palette makes by hand: text on each surface it is painted on. */
function namedPairs(skin: string, colors: (typeof BUILTIN_THEMES)[string]['colors']): Row[] {
  const surfaces: Array<[string, string]> = [
    ['background', colors.background],
    ['card', colors.card],
    ['popover', colors.popover],
    ['sidebar', colors.sidebarBackground ?? colors.background]
  ]

  const rows: Row[] = []

  for (const [name, bg] of surfaces) {
    if (!parseColor(bg)) continue

    rows.push({ label: `${skin} body ink on ${name}`, fg: colors.foreground, bg, floor: 4.5 })
    rows.push({ label: `${skin} secondary ink on ${name}`, fg: colors.mutedForeground, bg, floor: 4.5 })
    // Links / accent text / active-item ink.
    rows.push({ label: `${skin} accent ink on ${name}`, fg: colors.primary, bg, floor: 4.5 })
  }

  // Filled primary (send button, selected pill): its own foreground.
  rows.push({
    label: `${skin} primary-foreground on primary`,
    fg: colors.primaryForeground,
    bg: colors.primary,
    floor: 4.5
  })

  // Destructive text (errors shown as text, not just dots).
  rows.push({ label: `${skin} destructive on background`, fg: colors.destructive, bg: colors.background, floor: 4.5 })

  // Non-text strokes only need 3:1 — rings, focus, caret.
  rows.push({ label: `${skin} ring on background (non-text)`, fg: colors.ring, bg: colors.background, floor: 3 })

  return rows
}

let failures = 0
let checks = 0

for (const [name, theme] of Object.entries(BUILTIN_THEMES)) {
  if (names.length && !names.includes(name)) continue

  for (const mode of ['light', 'dark'] as Mode[]) {
    const colors = mode === 'dark' && theme.darkColors ? theme.darkColors : theme.colors
    const rendered: Mode = ((parseColor(colors.background)?.[0] ?? 255) < 128 ? 'dark' : 'light') as Mode
    const label = `${name}·${mode}`
    const lines: string[] = []

    // ── The ramp — what applyTheme mixes from the foreground.
    const surfaces = [colors.background, colors.sidebarBackground].filter(
      (c): c is string => Boolean(c) && parseColor(c!) !== null
    )

    for (const tier of ['tertiary', 'quaternary'] as TextTier[]) {
      for (const surface of surfaces) {
        const share = resolveTextMix(colors.foreground, surfaces, tier, rendered === 'dark')
        const ratio =
          contrastRatio(textInk(colors.foreground, surfaces, surface, tier, rendered === 'dark'), surface) ?? 0
        const atCap = share >= TEXT_MIX_CAP[tier] - 1e-9
        const ok = ratio >= TEXT_CONTRAST_FLOOR[tier] || atCap
        checks += 1
        if (!ok) failures += 1
        lines.push(
          `  ${ok ? 'ok  ' : 'FAIL'} ${tier.padEnd(10)} on ${surface}  ${ratio.toFixed(2)}:1 (floor ${TEXT_CONTRAST_FLOOR[tier]})`
        )
      }
    }

    // ── The hand-made pairs.
    for (const row of namedPairs(label, colors)) {
      const ratio = contrastRatio(row.fg, row.bg)
      if (ratio === null) continue
      const ok = ratio >= row.floor
      checks += 1
      if (!ok) failures += 1
      lines.push(`  ${ok ? 'ok  ' : 'FAIL'} ${row.label.replace(`${label} `, '').padEnd(34)} ${ratio.toFixed(2)}:1 (floor ${row.floor})`)
    }

    console.log(`\n${label}  (renders ${rendered})`)
    console.log(lines.join('\n'))
  }
}

console.log(`\n${checks} checks, ${failures} failing.`)

if (failures) {
  process.exitCode = 1
}
