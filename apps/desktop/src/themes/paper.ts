/**
 * Warm Paper — "warm paper, quiet ink".
 *
 * A calm, flat, notebook-like skin: warm off-white paper, near-black ink, one
 * indigo accent used only where it means something (active row, links, focus,
 * send). No gradients, no glow, no wallpaper, no shadows on cards. The point is
 * that the conversation is the only thing with contrast; chrome recedes.
 *
 * Why a skin and not a stylesheet rewrite: every surface in the app reads
 * `--dt-*` / `--ui-*`, and `applyTheme` paints those from a `DesktopTheme`, so
 * a palette change restyles every component at once by construction. The small
 * `customCSS` payload below carries only the handful of decisions a palette
 * cannot express (leading, focus ring, caret/selection, heading weight).
 *
 * Contrast (WCAG, over `--dt-background` #f6f3ee): ink 14.1:1, secondary
 * 5.2:1, primary/accent 5.1:1, white-on-primary 5.7:1. The muted tiers are not
 * hardcoded — `text-ramp.ts` lifts them per skin until they clear their floors,
 * and `text-ramp.test.ts` holds this palette to that contract.
 */

import type { DesktopTerminalPalette, DesktopTheme } from './types'

const SYSTEM_SANS =
  '"Inter", "Segoe WPC", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif, ' +
  '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji'

const SYSTEM_MONO =
  '"JetBrains Mono", "Cascadia Code", "DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono", "SF Mono", ' +
  'ui-monospace, Menlo, Monaco, Consolas, monospace, ' +
  '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji'

/**
 * Ink, paper and one indigo.
 *
 * `primary` is deliberately a step deeper than the brand indigo (#5b6ee1): the
 * calm indigo only clears 4.0:1 as *text* on paper, which fails AA for links,
 * and white-on-#5b6ee1 is 4.41:1 — also a fail for the send button. #4a5bd0
 * keeps the hue and passes both (5.1:1 / 5.7:1). The lighter #5b6ee1 lives on
 * in `midground`, where it is only ever a stroke or a ring (non-text, 3:1 floor).
 */
const PAPER_LIGHT = {
  background: '#f6f3ee',
  foreground: '#26231e',
  card: '#fbfaf7',
  cardForeground: '#26231e',
  muted: '#efece4',
  mutedForeground: '#6b665c',
  popover: '#ffffff',
  popoverForeground: '#26231e',
  primary: '#4a5bd0',
  primaryForeground: '#ffffff',
  secondary: '#eae6dd',
  secondaryForeground: '#3a362e',
  // `accent` here means the SOFT accent surface (applyTheme paints it as
  // --theme-accent-soft), i.e. the active-row fill — not the loud brand colour.
  accent: '#e9ecfb',
  accentForeground: '#2c3560',
  border: '#e7e2d9',
  input: '#d6cfc2',
  ring: '#5b6ee1',
  midground: '#5b6ee1',
  composerRing: '#5b6ee1',
  destructive: '#bd4139',
  destructiveForeground: '#ffffff',
  sidebarBackground: '#fbfaf7',
  sidebarBorder: '#e7e2d9',
  userBubble: '#f0ece3',
  userBubbleBorder: '#e7e2d9'
} as const

const PAPER_DARK = {
  background: '#17161a',
  foreground: '#ece9e2',
  card: '#1c1b20',
  cardForeground: '#ece9e2',
  muted: '#232228',
  mutedForeground: '#a7a399',
  popover: '#232228',
  popoverForeground: '#ece9e2',
  primary: '#8d9bff',
  primaryForeground: '#17161a',
  secondary: '#2a2930',
  secondaryForeground: '#ece9e2',
  accent: '#2a2d4d',
  accentForeground: '#dfe3ff',
  border: '#2c2b32',
  input: '#3a3943',
  ring: '#8d9bff',
  midground: '#8d9bff',
  composerRing: '#8d9bff',
  destructive: '#e0776f',
  destructiveForeground: '#17161a',
  sidebarBackground: '#1c1b20',
  sidebarBorder: '#2c2b32',
  userBubble: '#26252b',
  userBubbleBorder: '#2c2b32'
} as const

/** Warm-neutral terminal: paper cream on ink, muted ANSI rather than neon. */
const PAPER_TERMINAL: DesktopTerminalPalette = {
  foreground: '#26231e',
  cursor: '#4a5bd0',
  selectionBackground: 'rgba(91, 110, 225, 0.18)',
  black: '#26231e',
  red: '#c2453d',
  green: '#3f8a5f',
  yellow: '#b7791f',
  blue: '#4a5bd0',
  magenta: '#8a5ba8',
  cyan: '#2f7f8f',
  white: '#efece4',
  brightBlack: '#6b665c',
  brightRed: '#d4614f',
  brightGreen: '#4f9d6d',
  brightYellow: '#c98f2b',
  brightBlue: '#5b6ee1',
  brightMagenta: '#a06fbd',
  brightCyan: '#3f95a5',
  brightWhite: '#ffffff'
}

const PAPER_DARK_TERMINAL: DesktopTerminalPalette = {
  foreground: '#ece9e2',
  cursor: '#8d9bff',
  selectionBackground: 'rgba(141, 155, 255, 0.22)',
  black: '#3a3943',
  red: '#e0776f',
  green: '#6bbf8a',
  yellow: '#d8a44e',
  blue: '#8d9bff',
  magenta: '#c39bd8',
  cyan: '#6fc0cf',
  white: '#ece9e2',
  brightBlack: '#767267',
  brightRed: '#f0908a',
  brightGreen: '#87d3a4',
  brightYellow: '#e8bd72',
  brightBlue: '#a8b4ff',
  brightMagenta: '#d6b4e8',
  brightCyan: '#8dd4e0',
  brightWhite: '#ffffff'
}

/**
 * The handful of decisions a palette cannot express.
 *
 * Everything is scoped to `[data-hermes-theme='paper']`, which `applyTheme`
 * sets from the skin name, so switching skins drops the whole block with the
 * palette instead of leaving half a look behind. Each selector below already
 * exists in styles.css — this only re-states a value, it does not invent
 * structure.
 */
const PAPER_CSS = `
/* ── Typography ────────────────────────────────────────────────────────────
   15px body at 1.6 leading (24px). The stock ramp runs tighter (1.375rem);
   paper wants air. Sentence case, headings at 500 — never 700. */
:root[data-hermes-theme='paper'] {
  --conversation-text-base-size: 0.9375rem;
  --conversation-base-line-height: 1.5rem;
  --conversation-caption-base-size: 0.8125rem;
  --conversation-caption-base-line-height: 1.25rem;
  --conversation-turn-gap: 1.5rem;
  --dt-letter-spacing: 0;
}

:root[data-hermes-theme='paper'] [data-chat-surface] :is(h1, h2, h3, h4, h5, h6),
:root[data-hermes-theme='paper'] [data-chat-surface] strong {
  font-weight: 500;
}

/* Assistant prose tops out near 72ch: the column is capped at 44rem and the
   body is 15px, so the measure lands there without touching the layout. */
:root[data-hermes-theme='paper'] [data-chat-surface] .aui-md {
  line-height: 1.6;
}

/* ── Ink behaviour ─────────────────────────────────────────────────────── */
:root[data-hermes-theme='paper'] ::selection {
  background: var(--dt-accent);
  color: var(--dt-accent-foreground);
}

:root[data-hermes-theme='paper'] :is(input, textarea, [contenteditable='true']) {
  caret-color: var(--dt-primary);
}

/* Scrollbars: thin, transparent track, line-strong thumb, quiet until hover. */
:root[data-hermes-theme='paper'] ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

:root[data-hermes-theme='paper'] ::-webkit-scrollbar-track {
  background: transparent;
}

:root[data-hermes-theme='paper'] ::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--dt-border) 90%, transparent);
  border-radius: 9999px;
}

:root[data-hermes-theme='paper'] :hover::-webkit-scrollbar-thumb {
  background: var(--dt-input);
}

/* ── Composer ────────────────────────────────────────────────────────────
   Raised surface, 1px line-strong, focus ring 2px brand at 35%. The ring is a
   box-shadow so it never shifts layout when it appears. */
:root[data-hermes-theme='paper'] [data-slot='composer-surface'] {
  border-color: var(--dt-input);
  box-shadow: none;
}

:root[data-hermes-theme='paper'] [data-slot='composer-root']:focus-within [data-slot='composer-surface'] {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dt-ring) 35%, transparent);
}

/* ── Chrome recedes ──────────────────────────────────────────────────────
   No frost behind text and no wallpaper: paper is opaque. Both are texture,
   never the legibility layer, so removing them costs no contrast.

   --theme-asset-bg is painted by the wallpaper plugins, not by the app, and it
   lands on :root as an INLINE custom property — so a plain declaration loses to
   it and the engraving keeps bleeding through the thread. !important on a
   custom property is the only thing that outranks an inline value; it is scoped
   to this skin, so every other skin keeps its wallpaper. */
:root[data-hermes-theme='paper'] {
  --theme-asset-bg: none !important;
  /* Chrome mixes 92% background with a cool neutral; all of it, and the rails
     read as paper instead of tinted aluminium. Also written inline by
     applyTheme's mixesFor(), hence !important. */
  --theme-mix-chrome: 100% !important;
}

:root[data-hermes-theme='paper'] [data-chat-surface],
:root[data-hermes-theme='paper'] [data-slot='composer-surface'] {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

:root[data-hermes-theme='paper'] .theme-default-filler {
  background-image: none;
}

/* Flat panels: a hairline reads as intentional, a drop shadow reads as 2016. */
:root[data-hermes-theme='paper'] [data-slot='sidebar-container'] {
  box-shadow: none;
  border-right: 1px solid var(--dt-sidebar-border);
  background: var(--dt-sidebar-bg);
}
`

export const paperTheme: DesktopTheme = {
  name: 'paper',
  label: 'Warm Paper',
  description: 'Warm paper, quiet ink — one calm indigo, nothing shouting',
  colors: PAPER_LIGHT,
  darkColors: PAPER_DARK,
  typography: {
    fontSans: SYSTEM_SANS,
    fontMono: SYSTEM_MONO,
    fontUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap'
  },
  terminal: PAPER_TERMINAL,
  darkTerminal: PAPER_DARK_TERMINAL,
  customCSS: PAPER_CSS
}
