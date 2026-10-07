import { useStore } from '@nanostores/react'

import { getAvatar, hasAvatar } from '../avatars/registry'
import { $avatars } from '../director/store'
import { AVATAR_IDS } from '../protocol'

import { AvatarHandle } from './avatar-handle'
import { Composer } from './composer'
import { Dock } from './dock'
import { FeedPanel } from './feed-panel'
import { NotificationCards } from './notification-card'
import { TaskCards } from './result-card'
import { SpeechBubbles } from './speech-bubble'
import { TaskPill } from './task-pill'

/**
 * The DOM layer above the canvas: one accessible handle per visible avatar, the
 * open notification cards, the activity feed panel and the dock. The layer
 * itself is click-through; only its children take pointer events — each carries
 * `data-pane-hit` so the hit-region publisher keeps it interactive (§6, §12).
 */
export function PaneOverlay() {
  const avatars = useStore($avatars)
  const visibleIds = AVATAR_IDS.filter(id => avatars[id].visible && hasAvatar(id))

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 1 }}>
      {visibleIds.map(id => (
        <AvatarHandle definition={getAvatar(id)} key={id} state={avatars[id].state} />
      ))}
      <NotificationCards />
      <SpeechBubbles />
      <TaskCards />
      <TaskPill />
      <Composer />
      <FeedPanel />
      <Dock />
    </div>
  )
}
