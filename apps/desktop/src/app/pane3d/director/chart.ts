import { atom } from 'nanostores'

import type { AvatarId, ChartSpec } from '../protocol'

/**
 * The chart seam (architecture §8.7, §8.9).
 *
 * A task result may carry a `ChartSpec`. Rendering it is the Chart3D feature's
 * job, so the pane keeps a presenter registry here: the result card's "Show
 * chart" button exists ONLY while a presenter is registered, and the card hides
 * it otherwise (the spec still travels with the result either way).
 */
export type ChartPresenter = (avatar: AvatarId, spec: ChartSpec) => void

export const $chartPresenter = atom<ChartPresenter | null>(null)

export function setChartPresenter(next: ChartPresenter | null): void {
  $chartPresenter.set(next)
}

/** True when a presenter accepted the spec. */
export function presentChart(avatar: AvatarId, spec: ChartSpec): boolean {
  const presenter = $chartPresenter.get()

  if (!presenter) {
    return false
  }

  presenter(avatar, spec)

  return true
}
