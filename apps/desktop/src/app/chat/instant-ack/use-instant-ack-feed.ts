/**
 * Feeding the ack with real turn signals.
 *
 * The receipt is armed by the composer (see `armReceiptForSend`); everything
 * after it must come from something that actually happened. This hook is the
 * single place that decides what counts as a real event, so the DOM contract
 * (`data-ack-state`) can never claim a step that no tool ran and no model said.
 *
 * Order of authority:
 *   approval request  → `approval`   (the turn is parked on the user)
 *   drafting tool     → `working`    (a call really is being written)
 *   turn over / reply → hand-off     (nothing left to acknowledge)
 */

import { useStore } from '@nanostores/react'
import { useEffect, useMemo } from 'react'

import { toolPresentVerb } from '@/components/assistant-ui/tool/run-summary'
import { sessionApprovalRequest } from '@/store/prompts'
import { sessionDraftingTool } from '@/store/tool-drafting'

import { $instantAcks, noteInstantAck } from './store'

export interface InstantAckSignals {
  /** The turn is in flight (composer busy or awaiting the first frame). */
  busy: boolean
  /** The last visible transcript row is the user's own send. */
  lastVisibleIsUser: boolean
  sessionId: null | string | undefined
}

/**
 * Bind the ack to the turn. `key` is the composer/queue session key the receipt
 * was armed under.
 */
export function useInstantAckFeed(
  key: string | null | undefined,
  { busy, lastVisibleIsUser, sessionId }: InstantAckSignals
): void {
  const drafting = useStore(useMemo(() => sessionDraftingTool(sessionId ?? null), [sessionId]))
  const approval = useStore(useMemo(() => sessionApprovalRequest(sessionId ?? null), [sessionId]))
  const acks = useStore($instantAcks)

  const ack = key ? (acks[key] ?? null) : null
  const ackState = ack?.state
  const draftingName = drafting?.name
  const approvalPending = Boolean(approval)

  // A call being written is the first honest step the app can name. The verb is
  // the same one the tool card will use, so the line and the card agree.
  useEffect(() => {
    if (key && draftingName) {
      noteInstantAck(key, { at: Date.now(), detail: toolPresentVerb(draftingName), type: 'tool-start' })
    }
  }, [draftingName, key])

  useEffect(() => {
    if (key && approvalPending) {
      noteInstantAck(key, { at: Date.now(), type: 'approval' })
    }
  }, [approvalPending, key])

  // Hand-off. Three shapes, all derived from real turn state:
  //   - the bot's own row is now the last one (the reply landed in the thread);
  //   - the turn that had named work went idle (it finished or errored);
  //   - the send started nothing at all: after the receipt has already admitted
  //     it is waiting, an idle session means there is no turn to narrate.
  useEffect(() => {
    if (!key || !ackState) {
      return
    }

    const replyLanded = busy && !lastVisibleIsUser
    const workEnded = !busy && ackState === 'working'
    const neverStarted = !busy && ackState === 'waiting'

    if (replyLanded || workEnded || neverStarted) {
      noteInstantAck(key, { at: Date.now(), type: 'hand-off' })
    }
  }, [ackState, busy, key, lastVisibleIsUser])
}
