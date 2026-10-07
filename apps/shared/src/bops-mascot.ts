/**
 * The Bops mascot system, ported from bops.bot's own `lib/mascot.ts` (OrgoAI/bops-oss):
 * plush blobs in the bot's colour, each wearing headphones. Idle, a bot vibes with its
 * eyes closed; at work, it opens them — each bot with its own expression, fixed by id.
 * Plain TypeScript: no imports, safe inside a content-script bundle.
 */

export type BopMood = 'idle' | 'awake'

const BLOB =
  'M20 4c7.5 0 13.5 4.5 15.5 11 2.8 2.4 3.8 6 2.8 9.6C36.6 32.5 29.6 37 20 37S3.4 32.5 1.7 24.6C.7 21 1.7 17.4 4.5 15 6.5 8.5 12.5 4 20 4z'

const INK = '#1C1C1B'
const HIGHLIGHTER = '#E9FF3B'

/** The workspace's main bot wears the highlighter headphones; the rest wear ink. */
const isMainBotId = (botId: string) => /^(boppy|hermes|main|default)(-\d+)?$/.test(botId)

/** Perceptual luminance — ink details flip to white on dark bodies (Hermes bot
 *  colours can be dark; the bops palette is always pastel). */
const isDark = (hex: string) => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)

  if (!isFinite(n) || hex.replace('#', '').length < 6) {return false}

  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 100
}

const FACES = ['open', 'happy', 'wink'] as const

export function bopFaceOf(botId: string): (typeof FACES)[number] {
  if (isMainBotId(botId)) {return 'open'}
  let h = 0

  for (const ch of botId.replace(/-\d+$/, '')) {h = (h * 31 + ch.charCodeAt(0)) >>> 0}

  return FACES[h % FACES.length]!
}

const eyes = (face: 'vibe' | (typeof FACES)[number], c: string) => {
  const arc = (d: string) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`

  if (face === 'vibe') {return arc('M13.6 22.2q1.9 1.8 3.8 0M22.6 22.2q1.9 1.8 3.8 0')}

  if (face === 'happy') {return arc('M13.6 23.3q1.9-2.1 3.8 0M22.6 23.3q1.9-2.1 3.8 0')}
  const dot = (cx: number) => `<ellipse cx="${cx}" cy="22.3" rx="1.9" ry="2.6" fill="${c}"/>`

  if (face === 'wink') {return dot(15.5) + arc('M22.6 22.5q1.9 1.7 3.8 0')}

  return dot(15.5) + dot(24.5)
}

const headphones = (band: string, pad: string) =>
  `<path d="M6.3 21.5C6.3 8.9 12.4 3.6 20 3.6s13.7 5.3 13.7 17.9" fill="none" stroke="${band}" stroke-width="2.1" stroke-linecap="round"/>` +
  `<rect x="2.4" y="17" width="6.4" height="11" rx="3" fill="${band}"/><rect x="31.2" y="17" width="6.4" height="11" rx="3" fill="${band}"/>` +
  `<rect x="7.4" y="18.6" width="1.6" height="7.8" rx=".8" fill="${pad}"/><rect x="31" y="18.6" width="1.6" height="7.8" rx=".8" fill="${pad}"/>`

const body = (inner: string) => `<g transform="translate(20 23) scale(.8) translate(-20 -21)">${inner}</g>`

/**
 * A bot's mascot markup (inner SVG, 0 0 40 40). `accent: false` draws the main bot's
 * headphones in ink instead of the highlighter (for spots where the highlighter would clash).
 */
export function bopMascotMarkup(botId: string, color: string, opts: { mood?: BopMood; accent?: boolean } = {}) {
  const mood = opts.mood ?? 'idle'
  const face = mood === 'idle' ? 'vibe' : bopFaceOf(botId)

  if (isMainBotId(botId)) {
    const lime = opts.accent !== false

    return body(`<path d="${BLOB}" fill="#0A0A0A"/>${eyes(face, '#fff')}`) + headphones(lime ? HIGHLIGHTER : '#3A3A38', lime ? '#0A0A0A' : '#1C1C1B')
  }

  const shine = `<ellipse cx="14" cy="11.5" rx="4" ry="2.2" fill="#fff" opacity=".28" transform="rotate(-18 14 11.5)"/>`
  const blush = `<ellipse cx="11.6" cy="26" rx="2" ry="1.1" fill="#fff" opacity=".45"/><ellipse cx="28.4" cy="26" rx="2" ry="1.1" fill="#fff" opacity=".45"/>`
  const ink = isDark(color) ? '#fff' : INK
  const inner = `<path d="${BLOB}" fill="${color}"/>${shine}${eyes(face, ink)}${blush}`

  return body(inner) + headphones(INK, '#3A3A38')
}

/** A complete standalone SVG document for a bot's mascot. */
export const bopMascotSvg = (botId: string, color: string, mood: BopMood = 'idle') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${bopMascotMarkup(botId, color, { mood })}</svg>`

/** Data-URI form for <img> slots (panel avatars, room faces). */
export const bopAvatarUrl = (botId: string, color: string, mood: BopMood = 'idle') =>
  `data:image/svg+xml,${encodeURIComponent(bopMascotSvg(botId, color, mood))}`

/** Their palette — the colours the blob mascots are drawn in. */
export const BOP_COLORS = ['#FF9F43', '#2EC4B6', '#A78BFA', '#F87171', '#60A5FA', '#34D399', '#E9FF3B', '#FF6FB5', '#47C46B', '#5B8CFF']
