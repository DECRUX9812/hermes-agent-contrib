/**
 * DEV ONLY — paints the app's theme seeds on :root.
 *
 * The real ThemeProvider is a React provider whose `applyTheme` is private, so
 * a standalone preview page has to publish the same custom properties itself.
 * Reads the theme from `?theme=` (nous | github | classic) and `?dark=1`.
 */
import { classicTheme, DEFAULT_TYPOGRAPHY, githubTheme, nousTheme } from '@/themes/presets'

const THEMES = { classic: classicTheme, github: githubTheme, nous: nousTheme } as const

const SYSTEM_SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export function paintTheme() {
  const root = document.documentElement
  const params = new URLSearchParams(window.location.search)
  const theme = THEMES[(params.get('theme') as keyof typeof THEMES) || 'nous'] ?? nousTheme
  const dark = params.get('dark') === '1'
  const c = theme.colors
  const typo = { ...DEFAULT_TYPOGRAPHY, ...theme.typography }

  root.dataset.hermesTheme = theme.name
  root.dataset.hermesMode = dark ? 'dark' : 'light'
  root.style.setProperty('color-scheme', dark ? 'dark' : 'light')
  root.classList.toggle('dark', dark)

  const vars: Record<string, string> = {
    '--theme-foreground': c.foreground,
    '--theme-primary': c.primary,
    '--theme-secondary': c.secondary,
    '--theme-accent-soft': c.accent,
    '--theme-midground': c.midground ?? c.ring,
    '--theme-warm': c.primary,
    '--theme-background-seed': c.background,
    '--theme-sidebar-seed': c.sidebarBackground ?? c.background,
    '--theme-card-seed': c.card,
    '--theme-elevated-seed': c.popover,
    '--theme-bubble-seed': c.userBubble ?? c.popover,
    '--dt-primary-foreground': c.primaryForeground,
    '--dt-secondary-foreground': c.secondaryForeground,
    '--dt-accent-foreground': c.accentForeground,
    '--dt-border': c.border,
    '--dt-input': c.input,
    '--dt-ring': c.ring,
    '--dt-base-size': typo.baseSize ?? '15px',
    '--dt-line-height': String(typo.lineHeight ?? 1.55),
    '--dt-letter-spacing': typo.letterSpacing ?? '0em',
    '--dt-font-sans': typo.fontSans || SYSTEM_SANS,
    '--dt-font-mono': typo.fontMono
  }

  for (const [k, v] of Object.entries(vars)) {root.style.setProperty(k, v)}
}
