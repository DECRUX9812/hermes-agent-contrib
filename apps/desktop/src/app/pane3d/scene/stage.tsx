import { useStore } from '@nanostores/react'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'

import { getAvatar, hasAvatar, listAvatars } from '../avatars/registry'
import { dispatch } from '../director/director'
import { $anchor, $avatars } from '../director/store'
import type { AvatarId } from '../protocol'
import { AVATAR_IDS } from '../protocol'

import { clearEmergenceEdge, setEmergenceEdge } from './emergence'
import { computeSlotLayout, dockRect } from './projection'
import { $reducedMotion } from './reduced-motion'
import { Rig, type RigCompletionEvent } from './rig'

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

  const heights = useMemo(
    () =>
      Object.fromEntries(definitions.map(definition => [definition.id, definition.height])) as Record<AvatarId, number>,
    [definitions]
  )

  const visibleIds = AVATAR_IDS.filter(id => avatars[id].visible && hasAvatar(id))
  const viewport = { height: size.height, width: size.width }

  const slots = computeSlotLayout({
    anchor,
    dock: dockRect(definitions.length, viewport),
    heights,
    ids: visibleIds,
    viewport
  })

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
