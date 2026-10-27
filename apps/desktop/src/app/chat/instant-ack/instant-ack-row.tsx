import type { FC } from 'react'

import { InstantAckLineView } from './instant-ack-line'
import { useInstantAck } from './use-instant-ack'
import { useInstantAckFeed } from './use-instant-ack-feed'

export interface InstantAckRowProps {
  sessionId: null | string | undefined
  /** Composer/queue scope the receipt was armed under. */
  sessionKey: null | string | undefined
  busy: boolean
  lastVisibleIsUser: boolean
  className?: string
}

/**
 * The mounted ack: one line above the composer, gone the moment the turn hands
 * over. Keeping the two hooks here (not in the chat surface) means the surface
 * re-renders only when the text it already reads changes.
 */
export const InstantAckRow: FC<InstantAckRowProps> = ({ busy, className, lastVisibleIsUser, sessionId, sessionKey }) => {
  useInstantAckFeed(sessionKey, { busy, lastVisibleIsUser, sessionId })

  const ack = useInstantAck(sessionKey)

  return ack ? <InstantAckLineView ack={ack} className={className} /> : null
}
