/**
 * The chart's grid plane (architecture §8.9).
 *
 * A hairline grid drawn in code — vertical column separators and the horizontal
 * tick lines — with the alpha profile the seam texture taught us to keep: the
 * texture is drawn near its on-screen size and mipmaps are OFF, because a
 * minified hairline averages into a flat, dirty band.
 *
 * The plane is vertical (behind the bars): the pane's camera looks straight down
 * -z, so a horizontal floor grid would be a single line.
 */

import * as THREE from 'three'

import { barColumnX, CHART_COLUMN_PITCH, chartBoardWidth } from './chart-layout'
import { PX_PER_UNIT } from './projection'

/** Drawn this much larger than its on-screen size, then minified a little. */
const TEXTURE_SUPERSAMPLE = 1.3
/** Deliberately faint: a reference grid, not a cage. */
const VERTICAL_ALPHA = 0.06
const HORIZONTAL_ALPHA = 0.12
/** Tick lines as a fraction of the axis (0 is the plinth edge, 1 the top tick). */
export const CHART_GRID_LINES = [0.5, 1]

const cache = new Map<string, THREE.CanvasTexture | null>()

/**
 * The texture's pixel size for a board of `columns` columns. It tracks the
 * board's real on-screen size on purpose: a hairline drawn in a texture much
 * larger than its on-screen size averages into a faint, blotchy band, and the
 * top tick line would land on the texture's own edge and alias into dashes.
 */
export function chartGridTextureSize(columns: number, boardHeight: number): { height: number; width: number } {
  return {
    height: Math.max(32, Math.round(boardHeight * PX_PER_UNIT * TEXTURE_SUPERSAMPLE)),
    width: Math.max(64, Math.round(chartBoardWidth(columns) * PX_PER_UNIT * TEXTURE_SUPERSAMPLE))
  }
}

function draw(columns: number, boardHeight: number): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null
  }

  const { height, width } = chartGridTextureSize(columns, boardHeight)
  const canvas = document.createElement('canvas')

  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')

  if (!context) {
    return null
  }

  const boardWidth = chartBoardWidth(columns)
  const toPx = (worldX: number) => ((worldX + boardWidth / 2) / boardWidth) * width
  // Lines are kept off the texture's own edge: a 1 px stroke centred on row 0
  // is half outside the texture, which is what turns the ceiling line into
  // dashes once the plane is drawn at fit scale.
  const toRow = (fraction: number) => Math.min(height - 1.5, Math.max(1.5, (1 - fraction) * height + 0.5))

  context.clearRect(0, 0, width, height)
  context.lineWidth = 1
  context.strokeStyle = `rgba(255,255,255,${VERTICAL_ALPHA})`

  for (let index = 1; index < columns; index += 1) {
    const x = Math.round(toPx(barColumnX(index, columns) - CHART_COLUMN_PITCH / 2)) + 0.5

    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, height)
    context.stroke()
  }

  context.strokeStyle = `rgba(255,255,255,${HORIZONTAL_ALPHA})`

  CHART_GRID_LINES.forEach(fraction => {
    const y = toRow(fraction)

    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(width, y)
    context.stroke()
  })

  const texture = new THREE.CanvasTexture(canvas)

  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter

  return texture
}

/** One grid texture per (columns, board height), shared for the pane's lifetime. */
export function getChartGridTexture(columns: number, boardHeight: number): THREE.CanvasTexture | null {
  const count = Math.max(1, Math.round(columns))
  const key = `${count}:${boardHeight.toFixed(3)}`

  if (!cache.has(key)) {
    cache.set(key, draw(count, boardHeight))
  }

  return cache.get(key) ?? null
}
