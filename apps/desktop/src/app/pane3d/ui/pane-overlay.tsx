import { useStore } from '@nanostores/react'

import { getAvatar, hasAvatar } from '../avatars/registry'
import { $avatars } from '../director/store'
import { AVATAR_IDS } from '../protocol'

import { AvatarHandle } from './avatar-handle'
import { Dock } from './dock'

/**
 * The DOM layer above the canvas: one accessible handle per visible avatar and
 * the dock. The layer itself is click-through; only its children take pointer
 * events.
 */
export function PaneOverlay() {
  const avatars = useStore($avatars)
  const visibleIds = AVATAR_IDS.filter(id => avatars[id].visible && hasAvatar(id))

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 1 }}>
      {visibleIds.map(id => (
        <AvatarHandle definition={getAvatar(id)} key={id} state={avatars[id].state} />
      ))}
      <Dock />
    </div>
  )
}
