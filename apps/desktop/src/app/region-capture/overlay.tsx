import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { requestComposerAttachImages, requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import {
  arrowHeadPoints,
  beginStroke,
  extendStroke,
  fitInside,
  MARKUP_COLORS,
  MARKUP_STROKE_WIDTH,
  type MarkupStroke,
  normalizeRegionDrag,
  type Point,
  type RegionRect
} from '@/lib/region-capture'
import { cn } from '@/lib/utils'
import { $regionCapture, closeRegionCapture } from '@/store/region-capture'

type Stage = 'annotate' | 'select'
type Tool = MarkupStroke['type']

/** Load the captured frame once per overlay mount. */
function useFrameImage(dataUrl: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    const el = new Image()
    el.src = dataUrl
    el.onload = () => setImage(el)

    return () => setImage(null)
  }, [dataUrl])

  return image
}

function paintStroke(ctx: CanvasRenderingContext2D, stroke: MarkupStroke, scale: number): void {
  const width = MARKUP_STROKE_WIDTH * scale
  ctx.strokeStyle = stroke.color
  ctx.fillStyle = stroke.color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (stroke.type === 'pen') {
    if (stroke.points.length === 0) {
      return
    }

    ctx.beginPath()
    ctx.moveTo(stroke.points[0][0] * scale, stroke.points[0][1] * scale)

    for (const [x, y] of stroke.points.slice(1)) {
      ctx.lineTo(x * scale, y * scale)
    }

    ctx.stroke()

    return
  }

  if (stroke.type === 'rect') {
    ctx.strokeRect(stroke.rect.x * scale, stroke.rect.y * scale, stroke.rect.width * scale, stroke.rect.height * scale)

    return
  }

  const head = arrowHeadPoints(stroke.from, stroke.to, 12)

  if (!head) {
    return
  }

  ctx.beginPath()
  ctx.moveTo(stroke.from[0] * scale, stroke.from[1] * scale)
  ctx.lineTo(stroke.to[0] * scale, stroke.to[1] * scale)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(head[0][0] * scale, head[0][1] * scale)
  ctx.lineTo(head[1][0] * scale, head[1][1] * scale)
  ctx.lineTo(head[2][0] * scale, head[2][1] * scale)
  ctx.closePath()
  ctx.fill()
}

/** Crop + markup at the frame's native pixels → PNG blob for the composer. */
async function compositeRegion(
  image: HTMLImageElement,
  region: RegionRect,
  strokes: readonly MarkupStroke[]
): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(region.width)
  canvas.height = Math.round(region.height)
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return null
  }

  ctx.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)

  for (const stroke of strokes) {
    paintStroke(ctx, stroke, 1)
  }

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

const TOOL_ICONS: Record<Tool, string> = { arrow: 'arrow-small-up', pen: 'edit', rect: 'primitive-square' }

function RegionCaptureEditor({ dataUrl, height, width }: { dataUrl: string; height: number; width: number }) {
  const { t } = useI18n()
  const c = t.regionCapture
  const image = useFrameImage(dataUrl)

  const [stage, setStage] = useState<Stage>('select')
  const [region, setRegion] = useState<RegionRect | null>(null)
  const [strokes, setStrokes] = useState<MarkupStroke[]>([])
  const [active, setActive] = useState<MarkupStroke | null>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<string>(MARKUP_COLORS[0])
  const [note, setNote] = useState('')
  const [attaching, setAttaching] = useState(false)

  const selectBoxRef = useRef<HTMLDivElement>(null)
  const markupCanvasRef = useRef<HTMLCanvasElement>(null)
  const markupBoxRef = useRef<HTMLDivElement>(null)
  const dragOrigin = useRef<Point | null>(null)
  const [dragRect, setDragRect] = useState<RegionRect | null>(null)

  const frameBox = fitInside(width, height, window.innerWidth * 0.92, window.innerHeight * 0.92)
  const regionBox = region
    ? fitInside(region.width, region.height, window.innerWidth * 0.8, window.innerHeight * 0.72)
    : null

  // Redraw the markup layer whenever strokes change. One canvas pass: crop +
  // every stroke in CSS space.
  useEffect(() => {
    if (stage !== 'annotate' || !region || !regionBox || !image) {
      return
    }

    const canvas = markupCanvasRef.current

    if (!canvas) {
      return
    }

    canvas.width = Math.max(1, Math.round(regionBox.width))
    canvas.height = Math.max(1, Math.round(regionBox.height))
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      return
    }

    const scale = regionBox.width / region.width
    ctx.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, regionBox.width, regionBox.height)

    for (const stroke of active ? [...strokes, active] : strokes) {
      paintStroke(ctx, stroke, scale)
    }
  }, [active, image, region, regionBox, stage, strokes])

  const imagePoint = (event: ReactPointerEvent, box: HTMLElement, scale: number): Point => {
    const rect = box.getBoundingClientRect()

    return [(event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale]
  }

  const onSelectDown = (event: ReactPointerEvent) => {
    if (stage !== 'select' || !selectBoxRef.current) {
      return
    }

    selectBoxRef.current.setPointerCapture(event.pointerId)
    dragOrigin.current = imagePoint(event, selectBoxRef.current, frameBox.scale)
    setDragRect(null)
  }

  const onSelectMove = (event: ReactPointerEvent) => {
    const origin = dragOrigin.current

    if (!origin || !selectBoxRef.current) {
      return
    }

    const point = imagePoint(event, selectBoxRef.current, frameBox.scale)
    setDragRect(normalizeRegionDrag(origin[0], origin[1], point[0], point[1], width, height))
  }

  const onSelectUp = () => {
    const origin = dragOrigin.current
    dragOrigin.current = null

    if (origin && dragRect) {
      setRegion(dragRect)
      setStage('annotate')
      setDragRect(null)
    }
  }

  const onMarkupDown = (event: ReactPointerEvent) => {
    if (stage !== 'annotate' || !region || !regionBox || !markupBoxRef.current) {
      return
    }

    markupBoxRef.current.setPointerCapture(event.pointerId)
    setActive(beginStroke(tool, imagePoint(event, markupBoxRef.current, regionBox.width / region.width), color))
  }

  const onMarkupMove = (event: ReactPointerEvent) => {
    if (!active || !region || !regionBox || !markupBoxRef.current) {
      return
    }

    setActive(extendStroke(active, imagePoint(event, markupBoxRef.current, regionBox.width / region.width), region))
  }

  const onMarkupUp = () => {
    if (!active) {
      return
    }

    // Zero-size drags (a click) leave a dot for pen, nothing for shapes.
    const keep =
      active.type === 'pen' ||
      (active.type === 'rect' && active.rect.width > 1) ||
      (active.type === 'arrow' && arrowHeadPoints(active.from, active.to, 12))

    if (keep) {
      setStrokes(current => [...current, active])
    }

    setActive(null)
  }

  const reset = () => {
    setStrokes([])
    setActive(null)
    setRegion(null)
    setNote('')
    setStage('select')
  }

  const attach = async () => {
    if (!image || !region || attaching) {
      return
    }

    setAttaching(true)

    try {
      const blob = await compositeRegion(image, region, strokes)

      if (blob) {
        requestComposerAttachImages([blob])
      }

      const text = note.trim()

      if (text) {
        requestComposerInsert(text, { mode: 'inline' })
      }

      requestComposerFocus()
      closeRegionCapture()
    } finally {
      setAttaching(false)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRegionCapture()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ToolButton = ({ kind }: { kind: Tool }) => (
    <Tip label={c.toolTips[kind]} placement="control">
      <Button
        aria-label={c.toolTips[kind]}
        className={cn('size-7', tool === kind && 'bg-(--ui-control-hover-background) text-foreground')}
        onClick={() => setTool(kind)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Codicon name={TOOL_ICONS[kind]} size="0.9rem" />
      </Button>
    </Tip>
  )

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/60"
      data-slot="region-capture-overlay"
      role="dialog"
    >
      {stage === 'select' && (
        <>
          <div
            className="relative cursor-crosshair select-none"
            onPointerCancel={onSelectUp}
            onPointerDown={onSelectDown}
            onPointerMove={onSelectMove}
            onPointerUp={onSelectUp}
            ref={selectBoxRef}
            style={{ height: frameBox.height, width: frameBox.width }}
          >
            {image && (
              <img
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full"
                draggable={false}
                src={dataUrl}
              />
            )}
            {dragRect && (
              <div
                className="pointer-events-none absolute border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                style={{
                  height: dragRect.height * frameBox.scale,
                  left: dragRect.x * frameBox.scale,
                  top: dragRect.y * frameBox.scale,
                  width: dragRect.width * frameBox.scale
                }}
              />
            )}
          </div>
          <div className="mt-3 rounded-md bg-black/60 px-3 py-1.5 text-[0.75rem] text-white/85">{c.selectHint}</div>
        </>
      )}

      {stage === 'annotate' && region && regionBox && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-(--ui-panel-border) bg-(--ui-bg-primary) px-2 py-1">
            <ToolButton kind="pen" />
            <ToolButton kind="rect" />
            <ToolButton kind="arrow" />
            <span className="mx-1 h-4 w-px bg-(--ui-panel-border)" />
            {MARKUP_COLORS.map(swatch => (
              <button
                aria-label={swatch}
                className={cn('size-4 rounded-full border', color === swatch ? 'border-white' : 'border-transparent')}
                key={swatch}
                onClick={() => setColor(swatch)}
                style={{ backgroundColor: swatch }}
                type="button"
              />
            ))}
            <span className="mx-1 h-4 w-px bg-(--ui-panel-border)" />
            <Tip label={c.undo} placement="control">
              <Button
                aria-label={c.undo}
                className="size-7"
                disabled={strokes.length === 0}
                onClick={() => setStrokes(current => current.slice(0, -1))}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Codicon name="discard" size="0.9rem" />
              </Button>
            </Tip>
            <Tip label={c.clear} placement="control">
              <Button aria-label={c.clear} className="size-7" onClick={reset} size="icon" type="button" variant="ghost">
                <Codicon name="trash" size="0.9rem" />
              </Button>
            </Tip>
          </div>

          <div
            className="relative cursor-crosshair overflow-hidden rounded-md border border-(--ui-panel-border) shadow-xl"
            onPointerCancel={onMarkupUp}
            onPointerDown={onMarkupDown}
            onPointerMove={onMarkupMove}
            onPointerUp={onMarkupUp}
            ref={markupBoxRef}
            style={{ height: regionBox.height, width: regionBox.width }}
          >
            <canvas className="absolute inset-0" ref={markupCanvasRef} />
          </div>

          <div className="flex w-full max-w-[640px] items-center gap-2">
            <input
              autoFocus
              className="h-8 min-w-0 flex-1 rounded-md border border-(--ui-panel-border) bg-(--ui-bg-primary) px-2.5 text-[0.78rem] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-(--ui-accent-secondary)"
              onChange={event => setNote(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  void attach()
                }
              }}
              placeholder={c.notePlaceholder}
              value={note}
            />
            <Button onClick={closeRegionCapture} type="button" variant="ghost">
              {c.cancel}
            </Button>
            <Button disabled={attaching} onClick={() => void attach()} type="button">
              {c.attach}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Mounted once per window; reads $regionCapture, so the composer menu and any
 *  other entry point share one overlay. */
export function RegionCaptureOverlay() {
  const capture = useStore($regionCapture)
  const { t } = useI18n()

  if (capture.status === 'idle') {
    return null
  }

  if (capture.status === 'capturing') {
    return (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60"
        data-slot="region-capture-overlay"
      >
        <GlyphSpinner ariaLabel={t.regionCapture.capturing} className="text-[1.2rem] text-white/80" spinner="braille" />
      </div>
    )
  }

  return (
    <RegionCaptureEditor dataUrl={capture.frame.dataUrl} height={capture.frame.height} width={capture.frame.width} />
  )
}
