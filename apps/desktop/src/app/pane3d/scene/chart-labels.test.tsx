/**
 * Rendered contract for the chart's DOM label layer (architecture §8.9,
 * VAL-CHART-001/002).
 *
 * `Chart3D` squeezes the whole board — bars and column spacing included — by
 * `fitX` when the pane is too narrow for the full panel beside the avatar row.
 * The X labels must carry the SAME factor: with an unscaled offset every label
 * drifts off its bar and the outermost 40 px box lands past the pane edge, even
 * though the panel's own box is clamped inside. Round-2 fix; the DOM is the only
 * place this can be observed, so drei's `<Html>` is stubbed to a plain div.
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-three/drei', async () => {
  const React = await import('react')

  return { Html: (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children) }
})

import type { ChartSpec } from '../protocol'

import { ChartLabels } from './chart-labels'
import {
  barColumnX,
  CHART_BOARD_HEIGHT,
  CHART_LABEL_GUTTER_PX,
  CHART_X_LABEL_BOX_PX,
  chartBoardWidth,
  chartXLabelBoxes
} from './chart-layout'
import { chartDomain } from './chart-scale'
import { PX_PER_UNIT } from './projection'

const COUNT = 8
const VALUES = [1180, 1265, 1340, 1310, 1485, 1610, 1742, 1968]

const SPEC: ChartSpec = {
  series: VALUES.map((value, index) => ({ label: `W${index + 1}`, value })),
  title: 'Instagram followers — last 8 weeks'
}

const BOARD_WIDTH = chartBoardWidth(COUNT)

afterEach(cleanup)

/**
 * Each label's panel-local centre: the panel's Y gutter plus the label's
 * strip-local `left` plus half its fixed box. The strip is at the gutter, so
 * this is directly comparable with `chartXLabelBoxes`' panel-local output.
 */
function labelCenters(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>('[data-pane-chart-xlabel]')].map(element => {
    const left = Number.parseFloat(element.style.left)
    const width = Number.parseFloat(element.style.width)

    return CHART_LABEL_GUTTER_PX + left + width / 2
  })
}

function renderLabels(fitX: number) {
  const { container } = render(
    <ChartLabels
      boardHeight={CHART_BOARD_HEIGHT}
      boardWidth={BOARD_WIDTH}
      domain={chartDomain(VALUES)}
      fitX={fitX}
      hoverIndex={null}
      spec={SPEC}
    />
  )

  const panel = container.querySelector<HTMLElement>('[data-pane-chart]')!

  return { container, panel }
}

describe('ChartLabels — X labels follow the horizontal fit', () => {
  it('centres every label on its compressed bar at fitX < 1, inside the panel box', () => {
    const fitX = 0.5
    const { container, panel } = renderLabels(fitX)

    const centers = labelCenters(container)
    const expected = chartXLabelBoxes({ count: COUNT, fitX })
    const panelWidth = chartBoardWidth(COUNT) * PX_PER_UNIT * fitX + CHART_LABEL_GUTTER_PX

    expect(Number.parseFloat(panel.style.width)).toBeCloseTo(panelWidth, 6)
    expect(centers).toHaveLength(COUNT)

    centers.forEach((center, index) => {
      // The bar's panel-local x, from the same scaled column offset the 3D
      // board's bars and hover strips stand on.
      const barCenter =
        CHART_LABEL_GUTTER_PX + (BOARD_WIDTH * PX_PER_UNIT * fitX) / 2 + barColumnX(index, COUNT) * PX_PER_UNIT * fitX

      expect(Math.abs(center - barCenter)).toBeLessThanOrEqual(2)
      expect(Math.abs(center - expected[index].center)).toBeLessThanOrEqual(0.01)
      // The whole 40 px box stays inside the panel (and so inside the pane).
      expect(center - CHART_X_LABEL_BOX_PX / 2).toBeGreaterThanOrEqual(CHART_LABEL_GUTTER_PX)
      expect(center + CHART_X_LABEL_BOX_PX / 2).toBeLessThanOrEqual(panelWidth)
    })

    expect([...container.querySelectorAll('[data-pane-chart-xlabel]')].map(el => el.textContent)).toEqual(
      SPEC.series.map(point => point.label)
    )
  })

  it('leaves the fitX = 1 layout on the unscaled columns', () => {
    const { container } = renderLabels(1)

    const centers = labelCenters(container)
    const boardWpx = BOARD_WIDTH * PX_PER_UNIT

    centers.forEach((center, index) => {
      expect(center).toBeCloseTo(CHART_LABEL_GUTTER_PX + boardWpx / 2 + barColumnX(index, COUNT) * PX_PER_UNIT, 6)
    })
  })
})
