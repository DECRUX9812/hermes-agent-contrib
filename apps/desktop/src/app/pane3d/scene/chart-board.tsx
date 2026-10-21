/**
 * The Chart3D body (architecture §8.9): the bars, the grid plane behind them,
 * the plinth they stand on, and one invisible hover band per bar column.
 *
 * Pure geometry and materials — no frame loop, no DOM. The parent `<Chart3D>`
 * drives every animated value through `refs`, the same way the shared `<Rig>`
 * drives the avatar bodies, which also lets `scene/chart-prewarm.tsx` mount this
 * exact component off-screen to link its material programs before the pane says
 * `ready`.
 */

import { RoundedBox } from '@react-three/drei'
import { useCallback, useMemo } from 'react'
import * as THREE from 'three'

import type { AvatarPalette } from '../avatars/types'
import type { ChartSpec } from '../protocol'

import { getChartGridTexture } from './chart-grid-texture'
import {
  barColumnX,
  CHART_BAR_DEPTH,
  CHART_BAR_RADIUS,
  CHART_BAR_WIDTH,
  CHART_BOARD_DEPTH,
  CHART_BOARD_Z,
  CHART_COLUMN_PITCH,
  CHART_PLINTH_DEPTH,
  CHART_PLINTH_HEIGHT,
  CHART_PLINTH_Z,
  chartBoardWidth
} from './chart-layout'

/** Settled opacities; the frame loop multiplies them by the reveal. */
export const CHART_BOARD_OPACITY = 0.5
export const CHART_GRID_OPACITY = 0.85
export const CHART_PLINTH_OPACITY = 0.9

const BOARD_COLOR = '#0d0e15'
const PLINTH_COLOR = '#171922'
/** RoundedBox needs `radius < depth / 2` and `radius < height / 2`. */
const BOARD_RADIUS = 0.03
const PLINTH_RADIUS = 0.02
/** The shortest bar geometry we ever build, so the rounding never inverts. */
const MIN_BAR_GEOMETRY = CHART_BAR_RADIUS * 2.2

export interface ChartRefs {
  bars: (THREE.Mesh | null)[]
  board: THREE.Mesh | null
  grid: THREE.Mesh | null
  plinth: THREE.Mesh | null
}

export interface ChartBoardProps {
  spec: ChartSpec
  palette: AvatarPalette
  /** Filled by this component; the parent's frame loop reads it. */
  refs: ChartRefs
  /** Bar heights in world units (already fit-scaled). */
  barHeights: readonly number[]
  boardHeight: number
  /** Column under the pointer, for the hover highlight. */
  hoverIndex?: number | null
  /** The column under the pointer, or null when the pointer leaves the row. */
  onHover?: (index: number | null) => void
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** The bar's colour: the avatar's primary lerped toward its glow by value. */
function barColor(palette: AvatarPalette, value: number, peak: number): string {
  const ratio = peak > 0 ? clamp01(value / peak) : 0

  return `#${new THREE.Color(palette.primary).lerp(new THREE.Color(palette.glow), ratio).getHexString()}`
}

export function ChartBoard({
  barHeights,
  boardHeight,
  hoverIndex = null,
  onHover,
  palette,
  refs,
  spec
}: ChartBoardProps) {
  const count = spec.series.length
  const boardWidth = chartBoardWidth(count)
  const peak = spec.series.reduce((max, point) => Math.max(max, point.value), 0)
  const gridTexture = useMemo(() => getChartGridTexture(count, boardHeight), [boardHeight, count])

  // Stable ref callbacks: an inline arrow is re-created on every render (hover
  // re-renders), and React would detach and re-attach every bar each time.
  const barRefs = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => (mesh: THREE.Mesh | null) => {
        refs.bars[index] = mesh
      }),
    [count, refs]
  )

  const attachBoard = useCallback((mesh: THREE.Mesh | null) => void (refs.board = mesh), [refs])
  const attachGrid = useCallback((mesh: THREE.Mesh | null) => void (refs.grid = mesh), [refs])
  const attachPlinth = useCallback((mesh: THREE.Mesh | null) => void (refs.plinth = mesh), [refs])

  return (
    <>
      <RoundedBox
        args={[boardWidth, boardHeight, CHART_BOARD_DEPTH]}
        position={[0, boardHeight / 2, CHART_BOARD_Z]}
        radius={BOARD_RADIUS}
        ref={attachBoard}
        smoothness={3}
      >
        <meshStandardMaterial
          color={BOARD_COLOR}
          metalness={0.1}
          opacity={CHART_BOARD_OPACITY}
          roughness={0.75}
          transparent
        />
      </RoundedBox>

      <mesh position={[0, boardHeight / 2, CHART_BOARD_Z + CHART_BOARD_DEPTH / 2 + 0.005]} ref={attachGrid}>
        <planeGeometry args={[boardWidth, boardHeight]} />
        <meshBasicMaterial
          depthWrite={false}
          map={gridTexture}
          opacity={CHART_GRID_OPACITY}
          toneMapped={false}
          transparent
        />
      </mesh>

      <RoundedBox
        args={[boardWidth + 0.16, CHART_PLINTH_HEIGHT, CHART_PLINTH_DEPTH]}
        position={[0, -CHART_PLINTH_HEIGHT / 2, CHART_PLINTH_Z]}
        radius={PLINTH_RADIUS}
        ref={attachPlinth}
        smoothness={2}
      >
        <meshStandardMaterial
          color={PLINTH_COLOR}
          metalness={0.25}
          opacity={CHART_PLINTH_OPACITY}
          roughness={0.45}
          transparent
        />
      </RoundedBox>

      {spec.series.map((point, index) => {
        const height = Math.max(0, barHeights[index] ?? 0)
        const color = barColor(palette, point.value, peak)
        const active = hoverIndex === index

        return (
          <RoundedBox
            args={[CHART_BAR_WIDTH, Math.max(MIN_BAR_GEOMETRY, height), CHART_BAR_DEPTH]}
            key={`${point.label}-${index}`}
            position={[barColumnX(index, count), height / 2, 0]}
            radius={CHART_BAR_RADIUS}
            ref={barRefs[index]}
            smoothness={3}
          >
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={active ? 0.75 : 0.22 + 0.3 * (peak > 0 ? clamp01(point.value / peak) : 0)}
              metalness={0.05}
              roughness={0.35}
            />
          </RoundedBox>
        )
      })}

      {/* Hover bands: invisible strips that tile the bar row in front of the
          bars, so a column answers the pointer even when its bar is tiny. One
          band per column means the raycaster does the picking — no local-space
          math on an event payload. */}
      {spec.series.map((point, index) => (
        <mesh
          key={`hover-${point.label}-${index}`}
          onPointerMove={onHover ? () => onHover(index) : undefined}
          onPointerOut={onHover ? () => onHover(null) : undefined}
          position={[barColumnX(index, count), boardHeight / 2, CHART_BOARD_Z + 0.8]}
        >
          <planeGeometry args={[CHART_COLUMN_PITCH, boardHeight]} />
          <meshBasicMaterial depthWrite={false} opacity={0} side={THREE.DoubleSide} transparent />
        </mesh>
      ))}
    </>
  )
}
