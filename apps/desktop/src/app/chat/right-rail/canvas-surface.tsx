import '@excalidraw/excalidraw/index.css'

import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw'
import { useEffect, useRef, useState } from 'react'

import { useIsDark } from '@/components/assistant-ui/embeds/use-is-dark'
import { parseCanvas, sceneKey } from '@/lib/canvas-file'
import { writeDesktopFileText } from '@/lib/desktop-fs'
import { notifyError } from '@/store/notifications'

type Api = Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['excalidrawAPI']>>[0]

/** How long a quiet canvas waits before writing itself to disk. */
const SAVE_DEBOUNCE_MS = 700

/**
 * An `.excalidraw` file as a live canvas (lazy chunk — see canvas-viewer.tsx).
 *
 * The FILE is the shared surface: your strokes save back to it (debounced,
 * only when the scene actually changed — opening never rewrites it), and when
 * the agent rewrites it with its file tools the preview re-reads and the new
 * scene merges in here without remounting, so you both work on one drawing.
 */
export default function CanvasSurface({ filePath, text }: { filePath: string; text: string }) {
  const dark = useIsDark()
  const api = useRef<Api | null>(null)
  // First load only; later disk changes merge in through the effect below.
  const [initial] = useState(() => parseCanvas(text))
  /** Scene identity last written by us or loaded from disk. */
  const knownKey = useRef(sceneKey(initial.elements))
  const lastText = useRef(text)
  const timer = useRef<number | null>(null)

  // External edits (the agent, another window): merge the new scene in place.
  // Pushes a prop into Excalidraw's imperative API; nothing here mirrors an atom.
  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    if (text === lastText.current || !api.current) {
      return
    }

    lastText.current = text
    const next = parseCanvas(text)
    const key = sceneKey(next.elements)

    if (key === knownKey.current) {
      return
    }

    knownKey.current = key

    if (next.files.length) {
      api.current.addFiles(next.files)
    }

    api.current.updateScene({ elements: next.elements })
  }, [text])

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
      }
    },
    []
  )

  return (
    <div
      className="h-full w-full"
      // Single-key tools (R, O, T…) are this surface's shortcuts: type-to-
      // compose stands down while focus is inside (composer-focus-keys.ts).
      data-keyboard-surface=""
      data-slot="canvas-surface"
      // Excalidraw's shortcuts (R, O, T, Delete…) listen on its focusable
      // container, but pointer-down on the canvas doesn't move focus off the
      // chat composer — so "R" typed into the message instead of picking the
      // rectangle. Hand focus to the canvas when a press lands in it.
      onPointerDownCapture={event => {
        const host = event.currentTarget.querySelector<HTMLElement>('[tabindex="0"]')

        if (host && !host.contains(document.activeElement)) {
          host.focus({ preventScroll: true })
        }
      }}
    >
      <Excalidraw
        excalidrawAPI={instance => {
          api.current = instance
        }}
        initialData={{
          appState: { ...initial.appState, viewBackgroundColor: 'transparent' },
          elements: initial.elements,
          files: initial.filesById,
          scrollToContent: true
        }}
        onChange={(elements, appState, files) => {
          const key = sceneKey(elements)

          if (key === knownKey.current) {
            return
          }

          if (timer.current !== null) {
            window.clearTimeout(timer.current)
          }

          timer.current = window.setTimeout(() => {
            timer.current = null
            const json = serializeAsJSON(elements, appState, files, 'local')
            knownKey.current = key
            lastText.current = json
            writeDesktopFileText(filePath, json).catch(error => notifyError(error, 'Could not save the canvas'))
          }, SAVE_DEBOUNCE_MS)
        }}
        theme={dark ? 'dark' : 'light'}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false } }}
      />
    </div>
  )
}
