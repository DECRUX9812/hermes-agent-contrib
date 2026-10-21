/**
 * Chart3D (architecture §8.9) — the interactive chart the avatar presents.
 *
 * One board of RoundedBox bars on a plinth with a grid plane behind them, a DOM
 * label layer, hover per column, and a slow ±20° turn. Every animated value is a
 * pure function of elapsed ms from `presentation.shownAt` (`chart-motion.ts`),
 * applied straight to the three objects in a priority -1 frame loop, so the
 * Projector (priority 0) always reads this frame's transform and no frame ever
 * re-renders React.
 */

import { useFrame } from '@react-three/fiber'
import { useCallback, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'

import { getAvatar } from '../avatars/registry'
import { type ChartPresentation, chartRuntime } from '../director/chart-state'

import {
  CHART_BOARD_OPACITY,
  CHART_GRID_OPACITY,
  CHART_PLINTH_OPACITY,
  ChartBoard,
  type ChartRefs
} from './chart-board'
import { ChartLabels } from './chart-labels'
import { CHART_BOARD_HEIGHT, chartBoardWidth } from './chart-layout'
import { barRise, CHART_HOVER_LIFT, chartReveal, chartYawDeg } from './chart-motion'
import { chartDomain, scaleBarHeights } from './chart-scale'
import { setChartRoot } from './projection'

export interface Chart3DProps {
  presentation: ChartPresentation
  /** Board centre in world units (the perch line + CHART_LIFT). */
  position: { x: number; y: number }
  /** Vertical fit, 0.62..1 — see `chartFit`. */
  fit: number
  /** Horizontal fit, 0.5..1 — see `chartPlacement`. */
  fitX: number
  reducedMotion: boolean
}

/** Hover lift ease (an ambient cue: no deadline, so an exponential approach). */
const LIFT_SMOOTH_S = 0.07

function setOpacity(mesh: THREE.Mesh | null, value: number): void {
  if (mesh) {
    ;(mesh.material as THREE.Material).opacity = value
  }
}

export function Chart3D({ fit, fitX, position, presentation, reducedMotion }: Chart3DProps) {
  const definition = getAvatar(presentation.avatar)
  const { spec } = presentation
  const count = spec.series.length
  const boardHeight = CHART_BOARD_HEIGHT * fit
  const boardWidth = chartBoardWidth(count)
  const values = useMemo(() => spec.series.map(point => point.value), [spec])
  const domain = useMemo(() => chartDomain(values), [values])
  // Bars are scaled against the AXIS, not the series peak: the ticks are drawn
  // against the same ceiling, so a bar can never misrepresent its own gridline.
  const barHeights = useMemo(() => scaleBarHeights(values, boardHeight, domain.max), [boardHeight, domain, values])
  const group = useRef<THREE.Group>(null)
  const refs = useRef<ChartRefs>({ bars: [], board: null, grid: null, plinth: null }).current
  const lift = useRef<number[]>(new Array(count).fill(0)).current
  const hoverRef = useRef<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const attachRoot = useCallback((object: THREE.Group | null) => {
    group.current = object
    setChartRoot(object)
  }, [])

  const onHover = useCallback((index: number | null) => {
    hoverRef.current = index
    setHoverIndex(index)
  }, [])

  useFrame((_, rawDelta) => {
    const object = group.current

    if (!object) {
      return
    }

    const dt = Math.min(rawDelta, 0.05)
    const elapsed = performance.now() - presentation.shownAt
    const yawDeg = chartYawDeg(elapsed, reducedMotion)

    object.rotation.y = (yawDeg * Math.PI) / 180
    chartRuntime.rotationDeg = yawDeg

    const reveal = chartReveal(elapsed, reducedMotion)

    setOpacity(refs.board, CHART_BOARD_OPACITY * reveal)
    setOpacity(refs.grid, CHART_GRID_OPACITY * reveal)
    setOpacity(refs.plinth, CHART_PLINTH_OPACITY * reveal)

    if (chartRuntime.panelElement) {
      chartRuntime.panelElement.style.opacity = `${reveal}`
    }

    const hovered = hoverRef.current

    barHeights.forEach((height, index) => {
      const mesh = refs.bars[index]

      if (!mesh) {
        return
      }

      const progress = barRise(elapsed, index, { reducedMotion })
      const target = index === hovered ? CHART_HOVER_LIFT : 0

      lift[index] = (lift[index] ?? 0) + (target - (lift[index] ?? 0)) * (1 - Math.exp(-dt / LIFT_SMOOTH_S))
      mesh.scale.y = Math.max(0.0001, progress)
      mesh.position.y = (height * progress) / 2 + lift[index]
    })
  }, -1)

  return (
    // `scale.x = fitX` squeezes the whole board — bars, plinth, grid, spacing —
    // as one unit when the pane is too narrow to fit the panel beside the row.
    // The label layer is positioned from the same factor, and the `<Html>` anchor
    // sits on x = 0, so the panel's own box never scales.
    <group position={[position.x, position.y, 0]} ref={attachRoot} scale={[fitX, 1, 1]}>
      <ChartBoard
        barHeights={barHeights}
        boardHeight={boardHeight}
        hoverIndex={hoverIndex}
        onHover={onHover}
        palette={definition.palette}
        refs={refs}
        spec={spec}
      />
      <ChartLabels
        boardHeight={boardHeight}
        boardWidth={boardWidth}
        domain={domain}
        fitX={fitX}
        hoverIndex={hoverIndex}
        source={presentation.source}
        spec={spec}
      />
    </group>
  )
}
