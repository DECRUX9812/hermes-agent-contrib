/**
 * Chat background scenes — what paints behind the conversation.
 *
 * A scene is a wash laid OVER the conversation (the thread repaints an opaque
 * surface, so nothing behind it would show), blended so text keeps its
 * contrast: `multiply` on a light surface (white takes the tint, dark text
 * stays dark), `screen` on a dark one (the dark glows, light text stays light).
 * Every gradient scene is transparent blobs, so a scene tints any theme
 * instead of replacing it. Strength is one opacity per (kind, mode).
 */

export const BACKDROP_SCENES = ['off', 'aurora', 'dusk', 'ocean', 'meadow', 'grid', 'statue', 'custom'] as const
export const BACKDROP_STRENGTHS = ['subtle', 'balanced', 'vivid'] as const

export type BackdropScene = (typeof BACKDROP_SCENES)[number]
export type BackdropStrength = (typeof BACKDROP_STRENGTHS)[number]
export type BackdropMode = 'dark' | 'light'

export const isBackdropScene = (value: unknown): value is BackdropScene =>
  typeof value === 'string' && (BACKDROP_SCENES as readonly string[]).includes(value)

export const isBackdropStrength = (value: unknown): value is BackdropStrength =>
  typeof value === 'string' && (BACKDROP_STRENGTHS as readonly string[]).includes(value)

type Kind = 'glow' | 'pattern' | 'image' | 'statue'

const blob = (x: number, y: number, color: string, size = 55) =>
  `radial-gradient(circle at ${x}% ${y}%, ${color} 0%, transparent ${size}%)`

/** The gradient scenes: three soft blobs each, sized to overlap into a wash. */
const GLOWS: Record<'aurora' | 'dusk' | 'meadow' | 'ocean', string> = {
  aurora: [blob(18, 22, '#7c5cff'), blob(82, 30, '#22d3a6', 50), blob(55, 88, '#3b82f6', 60)].join(','),
  dusk: [blob(15, 80, '#ff7a59', 55), blob(85, 70, '#ff4d8d', 50), blob(50, 10, '#7c5cff', 60)].join(','),
  ocean: [blob(20, 15, '#0ea5e9'), blob(80, 60, '#2563eb', 55), blob(35, 95, '#14b8a6', 50)].join(','),
  meadow: [blob(12, 30, '#84cc16', 50), blob(75, 20, '#facc15', 45), blob(60, 90, '#10b981', 60)].join(',')
}

const KIND: Record<Exclude<BackdropScene, 'off'>, Kind> = {
  aurora: 'glow',
  dusk: 'glow',
  ocean: 'glow',
  meadow: 'glow',
  grid: 'pattern',
  statue: 'statue',
  custom: 'image'
}

// [subtle, balanced, vivid] per kind and mode.
const OPACITY: Record<Kind, Record<BackdropMode, readonly [number, number, number]>> = {
  glow: { dark: [0.2, 0.34, 0.55], light: [0.12, 0.22, 0.38] },
  pattern: { dark: [0.45, 0.7, 1], light: [0.45, 0.7, 1] },
  image: { dark: [0.12, 0.22, 0.38], light: [0.1, 0.18, 0.32] },
  // The statue's historical look (2.5% difference blend) is 'balanced'.
  statue: { dark: [0.015, 0.025, 0.05], light: [0.015, 0.025, 0.05] }
}

export interface BackdropLayer {
  kind: Kind
  /** CSS `background` for glow/pattern scenes; the image URL for image/statue. */
  background?: string
  image?: string
  opacity: number
  blend: 'difference' | 'multiply' | 'screen'
  /** Glow scenes drift slowly (disabled under reduced motion by the stylesheet). */
  drift: boolean
}

/** What to paint, or null for nothing (off, or a custom scene with no image yet). */
export function backdropLayer(
  scene: BackdropScene,
  strength: BackdropStrength,
  mode: BackdropMode,
  customImage: null | string,
  statueUrl: string
): BackdropLayer | null {
  if (scene === 'off') {
    return null
  }

  const kind = KIND[scene]
  const opacity = OPACITY[kind][mode][BACKDROP_STRENGTHS.indexOf(strength)]
  const blend = mode === 'dark' ? 'screen' : 'multiply'

  if (kind === 'glow') {
    return { kind, background: GLOWS[scene as keyof typeof GLOWS], opacity, blend, drift: true }
  }

  if (kind === 'pattern') {
    const dot = mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.12)'

    return {
      kind,
      background: `radial-gradient(${dot} 1px, transparent 1.4px) 0 0 / 22px 22px`,
      opacity,
      blend,
      drift: false
    }
  }

  if (kind === 'image') {
    return customImage ? { kind, image: customImage, opacity, blend, drift: false } : null
  }

  return { kind, image: statueUrl, opacity, blend: 'difference', drift: false }
}

/** The pre-picker setting was one boolean: on meant the statue. */
export function sceneFromLegacy(stored: null | string): BackdropScene {
  return stored === 'true' ? 'statue' : 'off'
}

/** A preview swatch for a scene tile — the same layer at full strength on a neutral card. */
export function sceneSwatch(scene: BackdropScene, mode: BackdropMode, customImage: null | string): string {
  if (scene === 'off' || scene === 'statue') {
    return 'none'
  }

  if (scene === 'custom') {
    return customImage ? `center / cover no-repeat url("${customImage}")` : 'none'
  }

  return backdropLayer(scene, 'vivid', mode, null, '')?.background ?? 'none'
}
