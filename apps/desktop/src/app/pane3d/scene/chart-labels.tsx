/**
 * The chart's DOM layer (architecture §8.9, §12): the title, the three Y ticks,
 * the eight X labels and the hover value — all real DOM through drei's `<Html>`,
 * at 11 px, so they stay crisp and selectable and never pay for a WebGL font.
 *
 * The panel is positioned at the board's top-left and is deliberately
 * `pointer-events: none` (except the close control): it must not steal the
 * hover that belongs to the bars underneath. It still carries `data-pane-chart`
 * and `data-pane-hit`, so its box joins the pane's hit regions and `setShape`
 * never clips it away.
 */

import { Html } from '@react-three/drei'
import { useCallback } from 'react'

import { PANE_COPY } from '../copy'
import { closeChart } from '../director/chart-live'
import { chartRuntime } from '../director/chart-state'
import type { ChartSpec } from '../protocol'
import { DevBadge } from '../ui/dev-badge'

import {
  barColumnX,
  CHART_LABEL_GUTTER_PX,
  CHART_PLINTH_HEIGHT,
  CHART_TITLE_GUTTER_PX,
  CHART_X_LABEL_BOX_PX,
  CHART_X_LABEL_GAP_PX,
  CHART_X_LABEL_GUTTER_PX,
  CHART_X_LABEL_STRIP_PX,
  chartXLabelBoxes
} from './chart-layout'
import { type ChartDomain, formatHoverValue, formatTickLabel } from './chart-scale'
import { PX_PER_UNIT } from './projection'

export interface ChartLabelsProps {
  spec: ChartSpec
  domain: ChartDomain
  hoverIndex: number | null
  boardWidth: number
  boardHeight: number
  /** Horizontal board fit (0.5..1) — the 3D group is scaled by the same factor. */
  fitX: number
  source?: 'live' | 'dev-harness'
}

export function ChartLabels({ boardHeight, boardWidth, domain, fitX, hoverIndex, source, spec }: ChartLabelsProps) {
  const count = spec.series.length
  const boardWpx = boardWidth * PX_PER_UNIT * fitX
  const boardHpx = boardHeight * PX_PER_UNIT
  const panelWidth = boardWpx + CHART_LABEL_GUTTER_PX
  const panelHeight = CHART_TITLE_GUTTER_PX + boardHpx + CHART_X_LABEL_GUTTER_PX
  const boardCenterPx = CHART_LABEL_GUTTER_PX + boardWpx / 2
  const columnPx = (index: number) => boardCenterPx + barColumnX(index, count) * PX_PER_UNIT * fitX
  const xLabels = chartXLabelBoxes({ count, fitX })
  const topFor = (value: number) => CHART_TITLE_GUTTER_PX + boardHpx * (1 - value / domain.max)

  // The frame loop fades this panel in with the board; a separate React root
  // (drei's HTML) cannot subscribe to the render loop, so it is registered here.
  const attachPanel = useCallback((element: HTMLDivElement | null) => {
    chartRuntime.panelElement = element
  }, [])

  const hovered = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < count ? spec.series[hoverIndex] : null

  return (
    // Anchored on the board's centre axis: a point on the chart's y axis does
    // not move as the chart turns, so the axis labels stay a stable HUD while
    // the bars swing behind them (the alternative — labels riding the ±20°
    // turn — reads as wobbling text).
    //
    // `style.pointerEvents: 'none'` is REQUIRED, not cosmetic: drei's wrapper
    // sizes itself from this panel's box measured rightward from the anchor and
    // inherits `pointer-events: auto`, so with the panel shifted left by a
    // negative margin that wrapper covers the bars to the right of the axis and
    // eats their hover. (drei's `pointerEvents` prop only applies in transform
    // mode, hence the style.) The close button re-enables `auto` for itself.
    <Html
      position={[0, boardHeight + CHART_TITLE_GUTTER_PX / PX_PER_UNIT, 0]}
      style={{ pointerEvents: 'none' }}
      zIndexRange={[40, 0]}
    >
      <div
        className="relative select-none"
        data-pane-chart
        data-pane-hit
        ref={attachPanel}
        style={{
          height: panelHeight,
          marginLeft: -(boardWpx / 2 + CHART_LABEL_GUTTER_PX),
          opacity: 0,
          pointerEvents: 'none',
          width: panelWidth
        }}
      >
        {/* The title rides a card header, and the X labels a matching footer
            strip. Both are real token surfaces, because the pane floats over
            whatever the user has on screen: axis text directly on the desktop
            is unreadable on a light background. The strips are narrow enough to
            leave the bars and the plot area completely clear. */}
        <div
          className="absolute top-0 left-0 flex w-full items-center gap-1.5 rounded-md border border-(--stroke-nous) bg-card px-1.5 shadow-nous"
          style={{ height: CHART_TITLE_GUTTER_PX - 4 }}
        >
          <span
            className="truncate text-[11px] leading-4 font-medium text-(--ui-text-primary)"
            data-pane-chart-title
            title={spec.title}
          >
            {spec.title}
          </span>
          {source === 'dev-harness' ? <DevBadge /> : null}
          <button
            aria-label={PANE_COPY.closeChart}
            className="pointer-events-auto ml-auto flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-[13px] leading-none text-(--ui-text-tertiary) outline-none hover:bg-(--ui-bg-quaternary) hover:text-(--ui-text-primary) focus-visible:ring-2 focus-visible:ring-white/60"
            data-pane-chart-close
            data-pane-hit
            onClick={() => closeChart()}
            type="button"
          >
            ×
          </button>
        </div>

        {domain.ticks.map(tick => (
          <span
            className="absolute left-0 flex items-center justify-end rounded-sm bg-card px-1 text-right text-[11px] leading-3 tabular-nums text-(--ui-text-secondary) shadow-nous"
            data-pane-chart-tick
            key={tick}
            style={{ height: 14, top: topFor(tick) - 7, width: CHART_LABEL_GUTTER_PX - 8 }}
          >
            {formatTickLabel(tick)}
          </span>
        ))}

        {/* The X labels ride one strip under the board (board width only, not the
            Y gutter) so eight labels read as one axis, not eight chips. It starts
            below the plinth's underside, never over it. */}
        <div
          className="absolute flex items-center rounded-md bg-card shadow-nous"
          style={{
            height: CHART_X_LABEL_STRIP_PX,
            left: CHART_LABEL_GUTTER_PX,
            top: CHART_TITLE_GUTTER_PX + boardHpx + CHART_PLINTH_HEIGHT * PX_PER_UNIT + CHART_X_LABEL_GAP_PX,
            width: boardWpx
          }}
        >
          {spec.series.map((point, index) => (
            <span
              className="absolute text-center text-[11px] leading-3 text-(--ui-text-secondary)"
              data-pane-chart-xlabel
              key={`${point.label}-${index}`}
              // Strip-local offset of the panel-local box: the labels carry the
              // SAME fitX as the board, or they drift off their compressed bars
              // and the outermost box leaves the pane (round-2 fix).
              style={{
                left: (xLabels[index]?.left ?? 0) - CHART_LABEL_GUTTER_PX,
                width: CHART_X_LABEL_BOX_PX
              }}
            >
              {point.label}
            </span>
          ))}
        </div>

        {hovered ? (
          <span
            className="absolute -translate-x-1/2 rounded-md border border-(--stroke-nous) bg-card px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap text-(--ui-text-primary) shadow-nous"
            data-pane-chart-value
            style={{ left: columnPx(hoverIndex ?? 0), top: topFor(hovered.value) - 26 }}
          >
            {formatHoverValue(hovered.value, spec.unit)}
          </span>
        ) : null}
      </div>
    </Html>
  )
}
