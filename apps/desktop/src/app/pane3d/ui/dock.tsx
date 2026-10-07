import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Activity } from '@/lib/icons'

import { getAvatar, hasAvatar, listAvatars } from '../avatars/registry'
import { PANE_COPY } from '../copy'
import { dispatch } from '../director/director'
import { $avatars, $feedPanelOpen } from '../director/store'
import { dockRect } from '../scene/projection'

import { useViewport } from './use-viewport'

/**
 * The collapsed tray, bottom-right (architecture §Milestone 1). One button per
 * REGISTERED avatar — so a dock button can never summon a body that does not
 * exist — plus the activity-feed toggle.
 */
export function Dock() {
  const avatars = useStore($avatars)
  const feedOpen = useStore($feedPanelOpen)
  const viewport = useViewport()
  const definitions = useMemo(() => listAvatars(), [])
  const rect = dockRect(definitions.length, viewport)

  return (
    <div
      className="pointer-events-auto absolute flex items-center gap-2 rounded-(--control-radius)"
      data-pane-hit
      style={{ height: rect.height, left: rect.x, top: rect.y, width: rect.width }}
    >
      {definitions.map(definition => {
        const visible = avatars[definition.id].visible && hasAvatar(definition.id)

        return (
          <Button
            aria-label={visible ? PANE_COPY.dismiss(definition.displayName) : PANE_COPY.summon(definition.displayName)}
            aria-pressed={visible}
            data-dock-avatar={definition.id}
            data-pane-hit
            key={definition.id}
            onClick={() => dispatch(definition.id, visible ? 'DISMISS' : 'SUMMON')}
            size="icon-sm"
            type="button"
            variant={visible ? 'default' : 'floating'}
          >
            <span
              aria-hidden
              className="block size-3.5 rounded-full"
              style={{ background: getAvatar(definition.id).palette.primary }}
            />
          </Button>
        )
      })}
      <Button
        aria-label={PANE_COPY.feed}
        aria-pressed={feedOpen}
        data-pane-hit
        onClick={() => $feedPanelOpen.set(!feedOpen)}
        size="icon-sm"
        type="button"
        variant={feedOpen ? 'default' : 'floating'}
      >
        <Activity />
      </Button>
    </div>
  )
}
