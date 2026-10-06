/**
 * The live chart presentation (architecture §8.9).
 *
 * It installs the `ChartPresenter` the result card's "Show chart" button looks
 * for, presents a chart automatically when a launch-demo result carries one,
 * drops the chart when its avatar leaves the stage, and answers the Rig's
 * question "should this avatar turn toward the chart?".
 *
 * The presenter is registered at the single composition point
 * (`director/defaults.ts`), exactly like the task executor and the conversation
 * source — the chart feature never reaches into the director's seams.
 */

import type { AvatarId, ChartSpec } from '../protocol'
import { CHART_PRESENT_YAW_DEG } from '../scene/chart-layout'

import { setChartPresenter } from './chart'
import { $chartPresentation, chartRuntime, setChartPresentation } from './chart-state'
import { $avatars, $taskCards, type AvatarRuntime, pane3dRuntime, type TaskCard } from './store'
import { dismissTaskCard } from './tasks'

const PRESENT_YAW_RAD = (CHART_PRESENT_YAW_DEG * Math.PI) / 180

/** Show `spec` beside `avatar`, replacing whatever was on screen. */
export function presentChartFor(avatar: AvatarId, spec: ChartSpec, source?: 'live' | 'dev-harness'): void {
  setChartPresentation({ avatar, shownAt: performance.now(), source, spec })
}

/** The close control (and every dismissal path) removes the chart and its regions. */
export function closeChart(): void {
  setChartPresentation(null)
}

/**
 * The yaw the presenting avatar should hold, or null when this avatar is not
 * presenting. The direction comes from where the Stage actually placed the
 * board, so the avatar always turns the right way.
 */
export function getChartFacing(id: AvatarId, avatarX: number): number | null {
  const presentation = $chartPresentation.get()

  if (!presentation || presentation.avatar !== id || !chartRuntime.visible) {
    return null
  }

  return (chartRuntime.x >= avatarX ? 1 : -1) * PRESENT_YAW_RAD
}

/**
 * The launch demo's result presents its chart without a click (architecture
 * §8.9, §11): the demo's own task text carries no chart keyword, so
 * `lastDemo === 'launch'` is the signal, and the card collapses into the feed
 * exactly as it does when the user presses "Show chart".
 */
const autoPresented = new Set<string>()

function autoPresent(cards: Record<string, TaskCard>): void {
  if (pane3dRuntime.lastDemo !== 'launch') {
    return
  }

  Object.values(cards).forEach(card => {
    if (!card.chart || card.source !== 'dev-harness' || autoPresented.has(card.id)) {
      return
    }

    autoPresented.add(card.id)
    presentChartFor(card.avatar, card.chart, card.source)
    dismissTaskCard(card.id)
  })
}

/** A chart must never outlive its avatar (§8.7): hiding one removes the chart. */
function dropWhenOffStage(rows: Record<AvatarId, AvatarRuntime>): void {
  const presentation = $chartPresentation.get()

  if (!presentation) {
    return
  }

  const row = rows[presentation.avatar]

  if (!row || !row.visible || row.state === 'hiding' || row.state === 'hidden') {
    closeChart()
  }
}

export function installChartPresenter(): void {
  setChartPresenter((avatar, spec, source) => presentChartFor(avatar, spec, source))
  $taskCards.listen(autoPresent)
  $avatars.listen(dropWhenOffStage)
}
