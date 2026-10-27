import { browserStyleSheet } from './browser/styles'
import { toolCardStyleSheet } from './tool-card-styles'

/** Status tones for Bot Mode, painted from the host theme's status tokens.
 *
 *  Bot Mode used raw Tailwind palette classes (amber/emerald/red/violet with
 *  `dark:` twins). Those ignored the active theme and only rendered when the
 *  host stylesheet happened to contain the exact class. These helpers resolve
 *  every tone from the theme (`--color-warning|success|danger`, `--ui-accent`)
 *  so a theme or dark mode switch repaints them; `color-mix` gives the soft
 *  fills/borders/rings at the same alpha steps the old classes used.
 *
 *  Classes: `hbp-fg-<tone>`, `hbp-bg-<tone>[-<pct>]`, `hbp-bd-<tone>-<pct>`,
 *  `hbp-ring-<tone>-<pct>` (sets the ring colour; pair with a host `ring-*`
 *  width class). They live in `@layer utilities` so host state variants
 *  (`hover:`, `focus-visible:`) still win, as they did over the old classes. */

const TONES: Record<string, string> = {
  warn: 'var(--color-warning, var(--ui-yellow))',
  ok: 'var(--color-success, var(--ui-green))',
  danger: 'var(--color-danger, var(--ui-red))',
  accent: 'var(--ui-accent)'
}

const STEPS = [5, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40, 50, 70, 80]

const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

export function toneStyleSheet(): string {
  const rules: string[] = []

  for (const [tone, color] of Object.entries(TONES)) {
    rules.push(`.hbp-fg-${tone}{color:${color}}`, `.hbp-bg-${tone}{background-color:${color}}`)

    for (const pct of STEPS) {
      rules.push(
        `.hbp-bg-${tone}-${pct}{background-color:${mix(color, pct)}}`,
        `.hbp-bd-${tone}-${pct}{border-color:${mix(color, pct)}}`,
        `.hbp-ring-${tone}-${pct}{--tw-ring-color:${mix(color, pct)}}`
      )
    }
  }

  // One quiet entrance for content that appears on its own (tab panels, the
  // live line changing state, a new approval or delivered file). Short, a
  // 2px rise, and off entirely for reduced motion.
  rules.push(
    '@keyframes hbp-enter{from{opacity:0;transform:translateY(2px)}}',
    '.hbp-enter{animation:hbp-enter 160ms ease-out both}',
    '@media (prefers-reduced-motion: reduce){.hbp-enter{animation:none}}'
  )

  // The same easing for things that grow in place: a meter's fill and a
  // section that folds open (grid rows 0fr → 1fr, so no height is measured).
  rules.push(
    '.hbp-fill{transition:width 240ms ease-out,background-color 240ms ease-out}',
    '.hbp-fold{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows 200ms ease-out,opacity 160ms ease-out}',
    '.hbp-fold[data-state=open]{grid-template-rows:1fr;opacity:1}',
    '@media (prefers-reduced-motion: reduce){.hbp-fill,.hbp-fold{transition:none}}'
  )

  return `@layer utilities{${rules.join('')}}`
}

const STYLE_ID = 'hermes-bots-plus-styles'

/** Mount the tone sheet plus the build's plugin-only utilities (build.mjs →
 *  `virtual:plugin-utilities`) once; returns the disposer for plugin unload. */
export function mountPluginStyles(utilities = ''): () => void {
  if (typeof document === 'undefined') {
    return () => {}
  }

  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null

  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }

  el.textContent = toneStyleSheet() + toolCardStyleSheet() + browserStyleSheet() + utilities

  return () => el?.remove()
}
