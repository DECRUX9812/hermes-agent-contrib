import type { FC } from 'react'
import { useMemo } from 'react'

import { useContributions } from '@/contrib'
import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import type { ChatHeaderSlotContribution, ChatHeaderSlotProps } from '@/lib/chat-header-slots'

/**
 * One header-decoration slot for the chat in view. Mounts every registration
 * and lets each decide — it renders its decoration, or nothing at all for
 * headers it doesn't own. Same mounting contract as the session-row slots:
 * all contributions mount (not first-wins), so a plugin declining a header
 * must not suppress the one that owns it.
 */
const ChatHeaderSlotEntry: FC<ChatHeaderSlotProps & { id: string; render: ChatHeaderSlotContribution['render'] }> = ({
  id,
  render,
  ...props
}) => {
  // Stable component identity: ContribRender mounts this AS a component, so a
  // fresh closure per render would remount the decoration on every tick.
  const renderSlot = useMemo(
    () => () => render({ profile: props.profile, sessionId: props.sessionId, title: props.title }),
    [render, props.profile, props.sessionId, props.title]
  )

  return (
    <ContribBoundary id={id} variant="chip">
      <ContribRender render={renderSlot} />
    </ContribBoundary>
  )
}

export const ChatHeaderSlot: FC<ChatHeaderSlotProps & { area: string }> = ({ area, ...props }) => {
  const contributions = useContributions(area)

  if (contributions.length === 0) {
    return null
  }

  return (
    <>
      {contributions.map(contribution => {
        const render = (contribution.data as ChatHeaderSlotContribution | undefined)?.render

        return render ? (
          <ChatHeaderSlotEntry
            id={contribution.id}
            key={`${contribution.source ?? 'core'}:${contribution.id}`}
            render={render}
            {...props}
          />
        ) : null
      })}
    </>
  )
}
