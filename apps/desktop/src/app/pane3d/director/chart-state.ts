/**
 * The chart presentation state (architecture §8.9, §12).
 *
 * The atom is what React reads (the Stage renders the chart from it); the
 * mutable runtime object is what the frame loop and the Projector write —
 * the same pattern as `avatarFrames`, so nothing here re-renders React while
 * the chart turns.
 */

import { atom } from 'nanostores'

import type { AvatarId, ChartSpec, ScreenRect } from '../protocol'

export interface ChartPresentation {
  avatar: AvatarId
  spec: ChartSpec
  /** Harness-sourced specs carry the Dev-harness badge (§11). */
  source?: 'live' | 'dev-harness'
  /** `performance.now()` when it was presented — the chart's motion clock (§8.9). */
  shownAt: number
}

export const $chartPresentation = atom<ChartPresentation | null>(null)

export const chartRuntime = {
  visible: false,
  /** The chart group's yaw in degrees, for `__pane3dDebug.snapshot().chart` (§12). */
  rotationDeg: 0,
  /** Board centre in world units; written by the Stage when the placement changes. */
  x: 0,
  y: 0,
  /** Which side of the avatar row the board was placed on. */
  side: 'left' as 'left' | 'right',
  /** Projected chart box in pane CSS px; written by the Projector each frame. */
  screenRect: null as ScreenRect | null,
  /** The projected chart geometry boxes — a hit-region source (§6). */
  hitRects: [] as ScreenRect[],
  /** The DOM label panel the frame loop fades in (it renders in drei's HTML root). */
  panelElement: null as HTMLElement | null
}

export function setChartPresentation(next: ChartPresentation | null): void {
  $chartPresentation.set(next)
  chartRuntime.visible = next !== null

  if (!next) {
    chartRuntime.hitRects = []
    chartRuntime.panelElement = null
    chartRuntime.rotationDeg = 0
    chartRuntime.screenRect = null
  }
}
