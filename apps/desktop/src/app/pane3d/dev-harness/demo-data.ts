import type { ChartSpec } from '../protocol'

/**
 * The demo chart a dev-harness result can carry (architecture §8.9).
 *
 * LABELLED scaffolding: the spec travels with the result card's "Show chart"
 * action and is rendered by the Chart3D feature. Eight weekly points, so the
 * chart's 8-bar layout and X labels have real data to show.
 */
export const DEMO_CHART: ChartSpec = {
  series: [
    { label: 'W1', value: 1180 },
    { label: 'W2', value: 1265 },
    { label: 'W3', value: 1340 },
    { label: 'W4', value: 1310 },
    { label: 'W5', value: 1485 },
    { label: 'W6', value: 1610 },
    { label: 'W7', value: 1742 },
    { label: 'W8', value: 1968 }
  ],
  title: 'Instagram followers — last 8 weeks',
  unit: 'followers'
}
