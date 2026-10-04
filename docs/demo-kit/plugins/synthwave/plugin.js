// Synthwave — a Hermes desktop plugin. One ask reskins the whole app: a neon palette,
// drifting light, and a horizon grid that scrolls under the conversation.
import { requestTheme } from '@hermes/plugin-sdk'

const NIGHT = {
  background: '#0d0221', foreground: '#f8e9ff', card: '#160536', cardForeground: '#f8e9ff',
  muted: '#1f0a45', mutedForeground: '#b9a3e3', popover: '#160536', popoverForeground: '#f8e9ff',
  primary: '#ff2bd6', primaryForeground: '#0d0221', secondary: '#25105a', secondaryForeground: '#f1dcff',
  accent: '#2a0f63', accentForeground: '#ffd6fb', border: '#3a1782', input: '#3a1782',
  ring: '#00e5ff', midground: '#ff2bd6', destructive: '#ff4d6d', destructiveForeground: '#0d0221',
  sidebarBackground: '#08011a', sidebarBorder: '#2a0f63', userBubble: '#2a0f63', userBubbleBorder: '#ff2bd6'
}

// Light that floats over the app (screen blend keeps text crisp) and a grid on the horizon.
const MOTION = `
@keyframes sw-drift { 0%,100% { transform: translate3d(0,0,0) } 50% { transform: translate3d(-5%,4%,0) } }
@keyframes sw-grid { from { background-position: 0 0, 0 0 } to { background-position: 0 56px, 0 0 } }
body::before { content: ''; position: fixed; inset: -20%; pointer-events: none; z-index: 2147483000;
  mix-blend-mode: screen; opacity: .6; animation: sw-drift 16s ease-in-out infinite;
  background: radial-gradient(38% 32% at 18% 22%, rgba(255,43,214,.32), transparent 70%),
              radial-gradient(34% 30% at 82% 68%, rgba(0,229,255,.24), transparent 70%),
              radial-gradient(30% 24% at 58% 12%, rgba(140,82,255,.30), transparent 70%); }
body::after { content: ''; position: fixed; left: -10%; right: -10%; bottom: 0; height: 30vh; pointer-events: none;
  z-index: 2147483001; mix-blend-mode: screen; opacity: .32; transform: perspective(420px) rotateX(62deg); transform-origin: bottom;
  background-image: linear-gradient(rgba(255,43,214,.55) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,.45) 1px, transparent 1px);
  background-size: 56px 56px, 56px 56px; animation: sw-grid 2s linear infinite;
  -webkit-mask-image: linear-gradient(to top, #000 0%, transparent 92%); mask-image: linear-gradient(to top, #000 0%, transparent 92%); }
@media (prefers-reduced-motion: reduce) { body::before, body::after { animation: none } }`

const THEME = { name: 'synthwave', label: 'Synthwave', description: 'Neon night drive', colors: NIGHT, darkColors: NIGHT, customCSS: MOTION }

export default {
  id: 'synthwave',
  name: 'Synthwave',
  register(ctx) {
    ctx.register({ id: 'theme', area: 'themes', data: THEME })
    if (!ctx.storage.get('applied', false)) {
      const apply = (tries = 0) => {
        if (requestTheme('synthwave')) ctx.storage.set('applied', true)
        else if (tries < 40) setTimeout(() => apply(tries + 1), 250)
      }
      apply()
    }
  }
}
