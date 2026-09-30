import { useStore } from '@nanostores/react'
import { useRef } from 'react'

import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { BACKDROP_SCENES, BACKDROP_STRENGTHS, type BackdropScene, sceneSwatch } from '@/lib/backdrop-scenes'
import { triggerHaptic } from '@/lib/haptics'
import { FileImage, X } from '@/lib/icons'
import { selectableCardClass } from '@/lib/selectable-card'
import { cn } from '@/lib/utils'
import {
  $backdropImage,
  $backdropScene,
  $backdropStrength,
  setBackdropImage,
  setBackdropScene,
  setBackdropStrength
} from '@/store/backdrop'
import { notifyError } from '@/store/notifications'
import { useTheme } from '@/themes/context'

// Stored in localStorage as a data URL: a 1920px JPEG keeps any photo to a few hundred KB.
const MAX_EDGE = 1920

async function downscaled(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  return canvas.toDataURL('image/jpeg', 0.82)
}

/** The Chat Background picker: scene tiles (live swatches), your own image, and strength. */
export function BackdropSetting() {
  const { t } = useI18n()
  const a = t.settings.appearance
  const scene = useStore($backdropScene)
  const strength = useStore($backdropStrength)
  const image = useStore($backdropImage)
  const { renderedMode } = useTheme()
  const input = useRef<HTMLInputElement>(null)

  const pick = (next: BackdropScene) => {
    triggerHaptic('crisp')

    if (next === 'custom' && !image) {
      input.current?.click()

      return
    }

    setBackdropScene(next)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) {
      return
    }

    try {
      setBackdropImage(await downscaled(file))
    } catch (error) {
      notifyError(error, a.backdropImageError)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {BACKDROP_SCENES.map(id => {
          const active = scene === id
          const swatch = sceneSwatch(id, renderedMode, image)

          return (
            <div className="group relative" key={id}>
              <button
                aria-pressed={active}
                className={cn('w-full p-1.5 text-left', selectableCardClass({ active, prominent: true }))}
                data-backdrop-tile={id}
                onClick={() => pick(id)}
                type="button"
              >
                <div
                  className="grid h-14 place-items-center overflow-hidden rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background) text-(--ui-text-quaternary)"
                  style={swatch === 'none' ? undefined : { background: `${swatch}, var(--ui-chat-surface-background)` }}
                >
                  {id === 'off' ? <X className="size-4" /> : null}
                  {id === 'statue' ? <span className="font-serif text-lg italic opacity-60">Ω</span> : null}
                  {id === 'custom' && !image ? <FileImage className="size-4" /> : null}
                </div>
                <div className="mt-1.5 truncate px-0.5 text-[length:var(--conversation-caption-font-size)] font-medium">
                  {id === 'custom' && !image ? a.backdropUpload : a.backdropScenes[id]}
                </div>
              </button>
              {id === 'custom' && image ? (
                <button
                  aria-label={a.backdropRemoveImage}
                  className="absolute right-2.5 top-2.5 grid size-5 place-items-center rounded-md bg-(--ui-bg-elevated)/85 text-(--ui-text-tertiary) opacity-0 backdrop-blur-sm transition hover:text-(--ui-red) focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => {
                    triggerHaptic('crisp')
                    setBackdropImage(null)
                  }}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
      <input
        accept="image/*"
        className="hidden"
        onChange={event => {
          void onFile(event.target.files?.[0])
          event.target.value = ''
        }}
        ref={input}
        type="file"
      />
      <SegmentedControl
        disabled={scene === 'off'}
        onChange={id => {
          triggerHaptic('selection')
          setBackdropStrength(id)
        }}
        options={BACKDROP_STRENGTHS.map(id => ({ id, label: a.backdropStrengths[id] }))}
        value={strength}
      />
    </div>
  )
}
