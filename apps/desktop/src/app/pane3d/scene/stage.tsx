import { useStore } from '@nanostores/react'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'

import { getAvatar, hasAvatar, listAvatars } from '../avatars/registry'
import { $chartPresentation, chartRuntime } from '../director/chart-state'
import { dispatch } from '../director/director'
import { $anchor, $avatars } from '../director/store'
import { AVATAR_IDS } from '../protocol'

import { Chart3D } from './chart3d'
import { chartViewFor } from './chart-layout'
import { clearEmergenceEdge, setEmergenceEdge } from './emergence'
import { $reducedMotion } from './reduced-motion'
import { Rig, type RigCompletionEvent } from './rig'
import { visibleSlotLayout } from './slot-layout'

/**
 * Composes the visible avatars for the current anchor (architecture §8.4/§8.6).
 * One shared perch line: a real anchor puts it on the anchor's top edge, the
 * desktop anchor floats the row above the dock. The presented Chart3D rides in
 * the same scene, placed from the same slot row so it never covers a body.
 */
export function Stage() {
  const avatars = useStore($avatars)
  const anchor = useStore($anchor)
  const chartPresentation = useStore($chartPresentation)
  const reducedMotion = useStore($reducedMotion)
  const size = useThree(state => state.size)
  const definitions = useMemo(() => listAvatars(), [])

  const visibleIds = AVATAR_IDS.filter(id => avatars[id].visible && hasAvatar(id))
  const viewport = useMemo(() => ({ height: size.height, width: size.width }), [size.height, size.width])

  // The DOM layer derives the same row from the same source, so it can reserve
  // an emerging avatar's perch before the rig climbs into it (VAL-NOTIFY-007).
  const slots = useMemo(
    () =>
      visibleSlotLayout({
        anchor,
        avatars,
        silhouettes: definitions,
        viewport
      }),
    [anchor, avatars, definitions, viewport]
  )

  const perchY = visibleIds.length > 0 ? slots[visibleIds[0]].perchY : 0

  const chartView = useMemo(
    () =>
      chartViewFor({
        avatars,
        chart: chartPresentation
          ? { avatar: chartPresentation.avatar, series: chartPresentation.spec.series.length }
          : null,
        definitions,
        slots,
        viewport
      }),
    [avatars, chartPresentation, definitions, slots, viewport]
  )

  // The Rig reads this to turn the presenting avatar toward the board; it must
  // land before the next frame, not on the frame after the chart mounts.
  useEffect(() => {
    if (chartView) {
      chartRuntime.side = chartView.side
      chartRuntime.x = chartView.position.x
      chartRuntime.y = chartView.position.y
    }
  }, [chartView])

  useEffect(() => {
    if (reducedMotion) {
      clearEmergenceEdge()
    } else {
      setEmergenceEdge(perchY)
    }
  }, [perchY, reducedMotion])

  return (
    <>
      {visibleIds.map(id => (
        <Rig
          definition={getAvatar(id)}
          key={id}
          onAnimationEnd={(event: RigCompletionEvent) => dispatch(id, event)}
          reducedMotion={reducedMotion}
          startedAt={avatars[id].changedAt}
          state={avatars[id].state}
          target={slots[id]}
        />
      ))}
      {chartPresentation && chartView ? (
        <Chart3D
          fit={chartView.fit}
          key={`${chartPresentation.avatar}-${chartPresentation.shownAt}`}
          position={chartView.position}
          presentation={chartPresentation}
          reducedMotion={reducedMotion}
        />
      ) : null}
    </>
  )
}
