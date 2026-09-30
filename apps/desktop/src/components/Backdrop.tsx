import { useStore } from '@nanostores/react'

import { backdropLayer } from '@/lib/backdrop-scenes'
import { cn } from '@/lib/utils'
import { $backdropImage, $backdropScene, $backdropStrength } from '@/store/backdrop'
import { useTheme } from '@/themes/context'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

export function Backdrop() {
  const scene = useStore($backdropScene)
  const strength = useStore($backdropStrength)
  const image = useStore($backdropImage)
  // Surface-bound: the pigment a scene needs depends on the painted surface, not the toggle.
  const { renderedMode } = useTheme()
  const layer = backdropLayer(scene, strength, renderedMode, image, assetPath('ds-assets/filler-bg0.jpg'))

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
      data-backdrop-scene={scene}
      style={{ mixBlendMode: layer.blend }}
    >
      <div
        className={cn('absolute', layer.drift ? 'backdrop-drift -inset-[12%]' : 'inset-0')}
        style={{
          opacity: layer.opacity,
          background: layer.image ? `center / cover no-repeat url("${layer.image}")` : layer.background
        }}
      />
    </div>
  )
}
