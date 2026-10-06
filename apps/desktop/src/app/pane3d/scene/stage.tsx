import { useStore } from '@nanostores/react'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'

import { getAvatar, hasAvatar, listAvatars } from '../avatars/registry'
import { dispatch } from '../director/director'
import { $anchor, $avatars } from '../director/store'
import { AVATAR_IDS } from '../protocol'

import { clearEmergenceEdge, setEmergenceEdge } from './emergence'
import { $reducedMotion } from './reduced-motion'
import { Rig, type RigCompletionEvent } from './rig'
import { visibleSlotLayout } from './slot-layout'

/**
 * Composes the visible avatars for the current anchor (architecture §8.4/§8.6).
 * One shared perch line: a real anchor puts it on the anchor's top edge, the
 * desktop anchor floats the row above the dock.
 */
export function Stage() {
  const avatars = useStore($avatars)
  const anchor = useStore($anchor)
  const reducedMotion = useStore($reducedMotion)
  const size = useThree(state => state.size)
  const definitions = useMemo(() => listAvatars(), [])

  const visibleIds = AVATAR_IDS.filter(id => avatars[id].visible && hasAvatar(id))

  // The DOM layer derives the same row from the same source, so it can reserve
  // an emerging avatar's perch before the rig climbs into it (VAL-NOTIFY-007).
  const slots = useMemo(
    () =>
      visibleSlotLayout({
        anchor,
        avatars,
        silhouettes: definitions,
        viewport: { height: size.height, width: size.width }
      }),
    [anchor, avatars, definitions, size.height, size.width]
  )

  const perchY = visibleIds.length > 0 ? slots[visibleIds[0]].perchY : 0

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
    </>
  )
}
