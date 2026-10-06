import { type KeyboardEvent, type PointerEvent, useCallback, useState } from 'react'

import type { AvatarDefinition } from '../avatars/types'
import { closeComposer, openComposer } from '../director/composer'
import { dispatch } from '../director/director'
import type { AvatarState } from '../director/store'
import { clearPointerGaze, setPointerGaze } from '../scene/pointer-gaze'
import { setHandleElement } from '../scene/projection'

import { HoverChips } from './hover-chips'

export interface AvatarHandleProps {
  definition: AvatarDefinition
  state: AvatarState
}

/**
 * The accessible DOM handle over a visible avatar (architecture §12).
 *
 * It is the keyboard entry point (Enter = Ask, Esc = close) and the source of
 * pointer gaze: while the pointer is over it, the avatar looks toward the half
 * it is on. The projector moves it each frame via `setHandleElement`, so it
 * never re-renders while the avatar moves.
 */
export function AvatarHandle({ definition, state }: AvatarHandleProps) {
  const [hovered, setHovered] = useState(false)
  const id = definition.id
  // Stable, or React detaches the old callback on every render and the
  // projector loses the element it positions each frame.
  const attachElement = useCallback((element: HTMLDivElement | null) => setHandleElement(id, element), [id])

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()

    if (rect.width <= 0 || rect.height <= 0) {
      return
    }

    // -1..1, positive toward screen-right / up.
    setPointerGaze(
      id,
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeComposer(id)
    }
  }

  return (
    <div
      className="absolute left-0 top-0"
      data-pane-hit
      onKeyDown={onKeyDown}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false)
        clearPointerGaze(id)
      }}
      onPointerMove={onPointerMove}
      ref={attachElement}
      style={{ opacity: 0, pointerEvents: 'none', willChange: 'transform' }}
    >
      <button
        aria-label={`${definition.displayName} — ${state}`}
        className="absolute inset-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        data-avatar-id={id}
        data-avatar-state={state}
        data-pane-hit
        onClick={() => void openComposer(id)}
        type="button"
      />
      {hovered ? <HoverChips onAsk={() => void openComposer(id)} onHide={() => dispatch(id, 'DISMISS')} /> : null}
    </div>
  )
}
