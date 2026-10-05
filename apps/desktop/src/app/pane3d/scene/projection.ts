import type * as THREE from 'three'

import type { AvatarId, PaneAnchor, ScreenRect } from '../protocol'
import { AVATAR_IDS } from '../protocol'

/**
 * Pane geometry (architecture §8.3, §12) — pure and three-free so it can be
 * unit-tested without a WebGL context.
 *
 * Coordinate spaces:
 * - "px"    pane-local CSS pixels (what the DOM layer and the canvas use).
 * - "world" three world units; the camera is placed so 1 unit ≈ 120 px at the
 *           perch line, which is what the art direction sizes avatars against.
 *
 * The snapshot's `screenRect` is reported in pane-local CSS px (the same space
 * the handle DOM is positioned in). Main converts CSS px → DIP with the window
 * zoom factor when it publishes hit regions (§6); the anchor feature does the
 * inverse for rects it pushes down.
 */
export interface Viewport {
  width: number
  height: number
}

export interface WorldPoint {
  x: number
  y: number
}

export interface SlotTarget {
  x: number
  y: number
  /** World-space y of the perch line the avatar's feet rest on. */
  perchY: number
}

export const PX_PER_UNIT = 120
export const CAMERA_FOV = 30
/** Muse's pearl is r 0.42 → a width of ~0.84 at height 1.1. */
export const AVATAR_WIDTH_RATIO = 0.82
export const SLOT_SPACING_RATIO = 1.5
/** Gap between the row of avatars and the dock / the edge. */
export const PERCH_INSET = 12
export const SLOT_START_RATIO = 0.8

export function cameraDistance(viewportHeight: number): number {
  const worldHeight = viewportHeight / PX_PER_UNIT

  return worldHeight / (2 * Math.tan((CAMERA_FOV * Math.PI) / 360))
}

export function screenToWorld(point: { x: number; y: number }, viewport: Viewport): WorldPoint {
  return { x: (point.x - viewport.width / 2) / PX_PER_UNIT, y: (viewport.height / 2 - point.y) / PX_PER_UNIT }
}

export function worldToScreen(point: WorldPoint, viewport: Viewport): { x: number; y: number } {
  return { x: point.x * PX_PER_UNIT + viewport.width / 2, y: viewport.height / 2 - point.y * PX_PER_UNIT }
}

/** The collapsed dock's rect in pane CSS px, bottom-right of the work area. */
export const DOCK_MARGIN = 16
/** Matches the shared Button `icon-sm` (size-8) so the DOM and the perch math agree. */
export const DOCK_BUTTON = 32
export const DOCK_GAP = 8
/** The dock always carries the feed toggle beside the avatar buttons. */
export const DOCK_EXTRA_BUTTONS = 1

export function dockRect(avatarCount: number, viewport: Viewport): ScreenRect {
  const count = Math.max(1, avatarCount) + DOCK_EXTRA_BUTTONS
  const width = count * DOCK_BUTTON + (count - 1) * DOCK_GAP
  const height = DOCK_BUTTON

  return { height, width, x: viewport.width - DOCK_MARGIN - width, y: viewport.height - DOCK_MARGIN - height }
}

export interface SlotLayoutInput {
  ids: AvatarId[]
  heights: Record<AvatarId, number>
  anchor: PaneAnchor
  viewport: Viewport
  /** Dock rect when the anchor is `desktop` (avatars float above it). */
  dock: ScreenRect | null
}

/**
 * Slot targets for a row of avatars, filled right-to-left from 80% of the
 * perch edge (architecture §8.6). A real anchor puts the perch line on the
 * anchor's top edge; the desktop anchor floats the row above the dock.
 */
export function computeSlotLayout(input: SlotLayoutInput): Record<AvatarId, SlotTarget> {
  const { anchor, dock, heights, ids, viewport } = input
  const out = {} as Record<AvatarId, SlotTarget>

  const edge =
    anchor.kind === 'desktop' || anchor.rect.width <= 0
      ? { left: 0, width: viewport.width }
      : { left: anchor.rect.x, width: anchor.rect.width }

  const perchPx =
    anchor.kind === 'desktop' || anchor.rect.height <= 0
      ? (dock?.y ?? viewport.height * 0.8) - PERCH_INSET
      : anchor.rect.y

  const perchY = screenToWorld({ x: 0, y: perchPx }, viewport).y
  let cursorPx = edge.left + SLOT_START_RATIO * edge.width

  ids.forEach(id => {
    const height = heights[id] ?? 1.1
    const widthPx = height * AVATAR_WIDTH_RATIO * PX_PER_UNIT
    const minCenter = PERCH_INSET + widthPx / 2
    const maxCenter = viewport.width - PERCH_INSET - widthPx / 2
    const centerPx = Math.min(maxCenter, Math.max(minCenter, cursorPx - widthPx / 2))

    out[id] = {
      perchY,
      x: screenToWorld({ x: centerPx, y: 0 }, viewport).x,
      y: perchY + height / 2
    }
    // Center-to-center pitch = 1.5 avatar widths (gap = half a width).
    cursorPx = centerPx - widthPx / 2 - (SLOT_SPACING_RATIO - 1) * widthPx
  })

  return out
}

export interface AvatarFrame {
  screenRect: ScreenRect | null
  /**
   * Projected world boxes of the avatar's hit parts plus its emergence edge
   * (seam + contact shadow), pane CSS px, UNPADDED. The publisher pads and
   * merges these into the regions main applies — one rect per part, so the
   * clickable shape follows the silhouette instead of one fat box (§6).
   */
  hitRects: ScreenRect[]
  yawDeg: number
  gaze: { x: number; y: number }
  meshCount: number
  materialTypes: string[]
}

function emptyFrame(): AvatarFrame {
  return { gaze: { x: 0, y: 0 }, hitRects: [], materialTypes: [], meshCount: 0, screenRect: null, yawDeg: 0 }
}

/**
 * Per-frame avatar facts the snapshot reads. A plain mutable object: writing it
 * each frame must never trigger a React render (architecture §12).
 */
export const avatarFrames = {} as Record<AvatarId, AvatarFrame>

AVATAR_IDS.forEach(id => {
  avatarFrames[id] = emptyFrame()
})

export function resetAvatarFrame(id: AvatarId): void {
  avatarFrames[id] = emptyFrame()
}

const handleElements = new Map<AvatarId, HTMLElement>()
const avatarRoots = new Map<AvatarId, THREE.Object3D>()

/**
 * The rigs register their root group here; the projector reads it each frame.
 * Module-level and mutable on purpose: a per-frame map through React props
 * would re-render the whole overlay.
 */
export function setAvatarRoot(id: AvatarId, object: THREE.Object3D | null): void {
  if (object) {
    avatarRoots.set(id, object)

    return
  }

  avatarRoots.delete(id)
  resetAvatarFrame(id)
  writeHandleRect(id, null)
}

export function getAvatarRoots(): Map<AvatarId, THREE.Object3D> {
  return avatarRoots
}

/**
 * The rig's emergence-edge group (seam + contact shadow) per avatar. It is a
 * sibling of the body root, so it registers separately: the body root's box
 * drives the handle and the perch math and must NOT grow by the shadow hanging
 * below the perch line — but the seam and shadow still have to sit inside the
 * input shape, or `setShape` clips them off.
 */
const edgeObjects = new Map<AvatarId, THREE.Object3D>()

export function setEdgeObject(id: AvatarId, object: THREE.Object3D | null): void {
  if (object) {
    edgeObjects.set(id, object)

    return
  }

  edgeObjects.delete(id)
}

export function getEdgeObjects(): Map<AvatarId, THREE.Object3D> {
  return edgeObjects
}

/** Duck-typed, so the traversal tests without a three runtime. */
export interface HitPartNode {
  userData: { hitPart?: unknown }
  children: HitPartNode[]
}

/**
 * The outermost objects flagged `userData.hitPart`. A flagged object ends the
 * descent, so flagging a group covers its whole subtree without counting a
 * child twice — and flagging every top-level part of a body makes the union of
 * their boxes equal the body's own box, which is what VAL-HIT-003 compares.
 */
export function collectHitParts<T extends HitPartNode>(root: T): T[] {
  const out: T[] = []

  const walk = (node: HitPartNode) => {
    node.children.forEach(child => {
      if (child.userData?.hitPart) {
        out.push(child as T)
      } else {
        walk(child)
      }
    })
  }

  walk(root)

  return out
}

export function setHandleElement(id: AvatarId, element: HTMLElement | null): void {
  if (element) {
    handleElements.set(id, element)
  } else {
    handleElements.delete(id)
  }
}

/** Move a handle over its avatar; called from the frame loop, never React. */
export function writeHandleRect(id: AvatarId, rect: ScreenRect | null): void {
  const element = handleElements.get(id)

  if (!element) {
    return
  }

  if (!rect) {
    element.style.opacity = '0'
    element.style.pointerEvents = 'none'

    return
  }

  element.style.opacity = '1'
  element.style.pointerEvents = 'auto'
  element.style.transform = `translate3d(${Math.round(rect.x)}px, ${Math.round(rect.y)}px, 0)`
  element.style.width = `${Math.round(rect.width)}px`
  element.style.height = `${Math.round(rect.height)}px`
}

/** Union of projected points, or null when nothing projected in front. */
export function boundingScreenRect(points: { x: number; y: number }[]): ScreenRect | null {
  if (points.length === 0) {
    return null
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  points.forEach(point => {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  })

  return { height: Math.max(1, maxY - minY), width: Math.max(1, maxX - minX), x: minX, y: minY }
}
