// Cyanotype — a Hermes desktop plugin. A Prussian-blue skin after the old sun prints;
// applied once when installed, then it's one more theme in Appearance.
import { requestTheme } from '@hermes/plugin-sdk'

const INK = '#0c2152', PAPER = '#f3efe2'

const PRINT = {
  background: INK,
  foreground: PAPER,
  card: '#10285f',
  cardForeground: PAPER,
  muted: '#15306c',
  mutedForeground: '#9fb3db',
  popover: '#10285f',
  popoverForeground: PAPER,
  primary: PAPER,
  primaryForeground: INK,
  secondary: '#1a3a7a',
  secondaryForeground: '#e3e9f8',
  accent: '#16336f',
  accentForeground: '#dfe8ff',
  border: '#22417f',
  input: '#22417f',
  ring: '#8fb6ff',
  midground: '#8fb6ff',
  destructive: '#e5484d',
  destructiveForeground: PAPER,
  sidebarBackground: '#091a43',
  sidebarBorder: '#173470',
  userBubble: '#16336f',
  userBubbleBorder: '#2a4c8e'
}

// A sun print is blue in any light: the same palette serves both modes.
const THEME = { name: 'cyanotype', label: 'Cyanotype', description: 'Prussian blue and paper — a sun print', colors: PRINT, darkColors: PRINT }

export default {
  id: 'cyanotype',
  name: 'Cyanotype',
  register(ctx) {
    ctx.register({ id: 'theme', area: 'themes', data: THEME })
    // Apply once on install; after that the person's own pick wins. The theme
    // resolves once the app has taken the registration, so retry briefly.
    if (!ctx.storage.get('applied', false)) {
      const apply = (tries = 0) => {
        if (requestTheme('cyanotype')) ctx.storage.set('applied', true)
        else if (tries < 40) setTimeout(() => apply(tries + 1), 250)
      }
      apply()
    }
  }
}
