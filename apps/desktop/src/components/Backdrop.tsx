import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { backdropLayer, sceneForHour } from '@/lib/backdrop-scenes'
import { cn } from '@/lib/utils'
import {
  $backdropAutoTick,
  $backdropImage,
  $backdropScene,
  $backdropStrength,
  clearBackdropAutoTimer,
  startBackdropAutoTimer
} from '@/store/backdrop'
import { useTheme } from '@/themes/context'

/** Shipped backdrop art (public/ds-assets), resolved against the app's base URL. */
export const backdropAsset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

export function Backdrop() {
  const scene = useStore($backdropScene)
  const strength = useStore($backdropStrength)
  const image = useStore($backdropImage)
  // Re-evaluates when auto tick atom changes
  const autoTick = useStore($backdropAutoTick)

  useEffect(() => {
    if (scene !== 'auto') {
      clearBackdropAutoTimer()

      return
    }

    return startBackdropAutoTimer()
  }, [scene])

  // Surface-bound: the pigment a scene needs depends on the painted surface, not the toggle.
  const { renderedMode } = useTheme()
  const resolvedScene = scene === 'auto' ? sceneForHour(new Date().getHours()) : scene
  void autoTick
  const layer = backdropLayer(resolvedScene, strength, renderedMode, image, backdropAsset)

  if (!layer) {
    return null
  }

  if (layer.kind === 'statue') {
    // The v1 statue: a faint difference-blended etching OVER the transcript.
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-2 mix-blend-difference"
        style={{ opacity: layer.opacity }}
      >
        <img
          alt=""
          className="h-[160dvh] w-auto min-w-dvw object-cover object-left-top [filter:invert(var(--backdrop-invert-mul,1))]"
          fetchPriority="low"
          src={layer.image}
        />
      </div>
    )
  }

  // A wash OVER the conversation, blended so text keeps its contrast (see backdrop-scenes.ts).
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-2 overflow-hidden"
      data-backdrop-scene={resolvedScene}
      style={{ mixBlendMode: layer.blend }}
    >
      <div
        className={cn('absolute', layer.drift ? 'backdrop-drift -inset-[12%]' : 'inset-0')}
        style={{
          opacity: layer.opacity,
          background: layer.image ? `center / cover no-repeat url("${layer.image}")` : layer.background,
          filter: layer.invert ? 'invert(1)' : undefined
        }}
      />
    </div>
  )
}
