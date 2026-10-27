/**
 * Inline live view for Bot Chat browser cards.
 *
 * While a browser run is live, its card carries a frame showing the newest
 * screenshot. New frames crossfade in over the old one (no blank flash on
 * update), the frame folds away when the run settles, and clicking it
 * opens the screenshot in the chat's preview pane. Where the browser supports
 * View Transitions, the frame morphs into the preview image instead of
 * jumping.
 */

import { cn, Codicon, Favicon, hostPathLabel, openPreview, useMediaImage } from '@hermes/plugin-sdk'
import { type JSX, useContext, useEffect, useRef, useState } from 'react'

import { useLiveViewText } from './live-view-i18n'
import { isPublicHost, type ToolCardGroup, type ToolCardView } from './tool-card-model'
import { PreviewSessionContext } from './tool-card-session'

const MORPH_NAME = 'hbp-shot-morph'
const FADE_MS = 180
/** How long the morph waits for the preview pane to paint its image. View
 *  Transitions hold rendering during the update, so this stays short. */
const TARGET_WAIT_MS = 450

interface Layer {
  id: number
  src: string
}

function ShotLayer({
  onReady,
  ready,
  src
}: {
  onReady: (src: string) => void
  ready: boolean
  src: string
}): JSX.Element | null {
  const image = useMediaImage(src, 16 / 9)

  if (!image.src || image.failed) {
    return null
  }

  return (
    <img
      alt=""
      aria-hidden
      className="hbp-lv-layer absolute inset-0 h-full w-full object-contain"
      data-ready={ready}
      data-shot-src={src}
      onError={image.onError}
      onLoad={event => {
        image.onLoad(event.currentTarget)
        onReady(src)
      }}
      src={image.src}
    />
  )
}

/** A screenshot that crossfades to each new `src`: the previous frame stays up
 *  until the next one has decoded, so a live view never blinks empty. */
export function CrossfadeShot({ src }: { src: string }): JSX.Element {
  const nextId = useRef(1)
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, src }])
  const [readySrc, setReadySrc] = useState<string>('')

  useEffect(() => {
    setLayers(current => {
      if (current[current.length - 1]?.src === src) {
        return current
      }

      const layer = { id: nextId.current++, src }

      // Keep at most the frame on screen plus the one coming in.
      return [...current.slice(-1), layer]
    })
  }, [src])

  useEffect(() => {
    if (readySrc !== src || layers.length < 2) {
      return
    }

    const timer = window.setTimeout(() => setLayers(current => current.slice(-1)), FADE_MS + 40)

    return () => window.clearTimeout(timer)
  }, [layers.length, readySrc, src])

  return (
    <span className="relative block h-full w-full">
      {layers.map((layer, index) => (
        <ShotLayer
          key={layer.id}
          onReady={setReadySrc}
          // The bottom layer is always shown; the top one fades in once decoded.
          ready={index === 0 || readySrc === layer.src}
          src={layer.src}
        />
      ))}
    </span>
  )
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

async function imageDataUrl(img: HTMLImageElement): Promise<string> {
  if (img.src.startsWith('data:')) {
    return img.src
  }

  const blob = await (await fetch(img.src)).blob()

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

function waitForElement<T extends Element>(find: () => T | null, timeoutMs: number): Promise<T | null> {
  return new Promise(resolve => {
    const started = performance.now()

    const tick = () => {
      const found = find()

      if (found || performance.now() - started > timeoutMs) {
        resolve(found)

        return
      }

      // Timers, not animation frames: a View Transition holds rendering while
      // its update runs, so frame callbacks would never fire here.
      window.setTimeout(tick, 16)
    }

    tick()
  })
}

/** A short stable key for a screenshot source (FNV-1a over the string). */
export function shotKey(src: string): string {
  let hash = 0x811c9dc5

  for (let index = 0; index < src.length; index += 1) {
    hash ^= src.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(36)
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> }
}

/** Open a screenshot from a frame in the chat's preview pane, morphing the
 *  frame into the preview image when the browser can. Returns once opened. */
export async function expandShot(
  frame: HTMLElement,
  shotSrc: string,
  label: string,
  session: { runtimeId: null | string; storedId: null | string }
): Promise<void> {
  const img = [...frame.querySelectorAll<HTMLImageElement>('img[data-shot-src]')]
    .reverse()
    .find(candidate => candidate.dataset.shotSrc === shotSrc && candidate.complete)

  if (!img) {
    return
  }

  // The pane renders an image target from its data URL; when the frame's
  // pixels cannot be read back, the pane loads the path itself.
  const dataUrl = await imageDataUrl(img).catch(() => '')
  const mimeType = (dataUrl && dataUrl.slice(5, dataUrl.indexOf(';'))) || 'image/png'

  // A data-URL screenshot has no file behind it: key the tab by a short hash
  // (the tab id embeds `url`) and mark it transient so it is not persisted.
  const inline = shotSrc.startsWith('data:')
  const key = inline ? `screenshot-${shotKey(shotSrc)}.${mimeType.split('/')[1] || 'png'}` : shotSrc

  const open = () =>
    openPreview(
      {
        ...(dataUrl ? { dataUrl } : {}),
        kind: 'file',
        label,
        mimeType,
        path: key,
        previewKind: 'image',
        source: key,
        ...(inline ? { transient: true } : {}),
        url: key
      },
      session.storedId ?? undefined,
      session.runtimeId
    )

  const doc = document as ViewTransitionDocument

  if (!doc.startViewTransition || prefersReducedMotion()) {
    open()

    return
  }

  let target: HTMLImageElement | null = null
  frame.style.setProperty('view-transition-name', MORPH_NAME)

  const transition = doc.startViewTransition(async () => {
    frame.style.removeProperty('view-transition-name')
    open()
    target = await waitForElement(
      () =>
        [...document.querySelectorAll<HTMLImageElement>('img')].find(
          candidate => candidate.alt === label && !frame.contains(candidate)
        ) ?? null,
      TARGET_WAIT_MS
    )
    target?.style.setProperty('view-transition-name', MORPH_NAME)
  })

  await transition.finished.catch(() => undefined)
  frame.style.removeProperty('view-transition-name')
  ;(target as HTMLImageElement | null)?.style.removeProperty('view-transition-name')
}

function latestShot(cards: readonly ToolCardView[]): { index: number; src: string } | null {
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const thumb = cards[index]?.thumb

    if (thumb?.kind === 'screenshot') {
      return { index, src: thumb.src }
    }
  }

  return null
}

function latestPage(cards: readonly ToolCardView[]): string {
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const url = cards[index]?.thumb?.url

    if (url && /^https?:\/\//i.test(url)) {
      return url
    }
  }

  return ''
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** A clickable screenshot frame that opens into the preview pane. */
export function ExpandableShot({
  className,
  host,
  src,
  step
}: {
  className?: string
  host: string
  src: string
  step: number
}): JSX.Element {
  const text = useLiveViewText()
  const session = useContext(PreviewSessionContext)
  const frameRef = useRef<HTMLButtonElement>(null)

  return (
    <button
      aria-label={text.expand}
      className={cn('hbp-lv-frame relative block h-full w-full cursor-zoom-in', className)}
      data-live-shot=""
      onClick={event => {
        event.stopPropagation()

        if (frameRef.current) {
          void expandShot(frameRef.current, src, text.shotLabel(host, step), session)
        }
      }}
      onKeyDown={event => event.stopPropagation()}
      ref={frameRef}
      type="button"
    >
      <CrossfadeShot src={src} />
      <span className="hbp-lv-zoom absolute right-1.5 bottom-1.5 grid size-6 place-items-center hbp-tc-rc hbp-lv-badge">
        <Codicon name="screen-full" size={12} />
      </span>
    </button>
  )
}

/** The live frame under a running browser card. Mounted open when the run is
 *  live and folds shut (same grid-row collapse as the details panel) when it
 *  settles or when the details panel takes over. */
export function LiveFrame({ group, open }: { group: ToolCardGroup; open: boolean }): JSX.Element | null {
  const text = useLiveViewText()
  const shot = latestShot(group.cards)
  const pageUrl = latestPage(group.cards)
  const host = safeHost(shot ? (group.cards[shot.index]?.thumb?.url ?? pageUrl) : pageUrl)
  const running = group.state === 'running'

  return (
    <div className="hbp-tc-collapse" data-live-frame="" data-open={open} inert={!open}>
      <div>
        <div className="hbp-tc-pl12 pt-1.5">
          <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-card border border-line hbp-tc-sunken">
            {shot ? (
              <ExpandableShot host={host} src={shot.src} step={shot.index + 1} />
            ) : (
              <div className="hbp-tc-shimmer flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 text-ui-xs hbp-tc-subtle">
                {pageUrl && isPublicHost(host) ? (
                  <span className="inline-grid size-6 place-items-center">
                    <Favicon fallback={<Codicon name="globe" size={20} />} url={pageUrl} />
                  </span>
                ) : (
                  <Codicon name="globe" size={20} />
                )}
                {pageUrl ? (
                  <span className="max-w-full truncate text-ui-sm text-fg-secondary">{hostPathLabel(pageUrl)}</span>
                ) : null}
                <span>{text.waiting}</span>
              </div>
            )}
            {running ? (
              <span className="pointer-events-none absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full px-1.5 text-ui-2xs hbp-lv-badge">
                <span aria-hidden className="hbp-lv-dot size-1.5 rounded-full" />
                {text.live}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
