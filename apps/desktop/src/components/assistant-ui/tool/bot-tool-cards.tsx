'use client'

import { type ToolCallMessagePartProps, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { type FC, type PropsWithChildren, useCallback, useMemo, useRef } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import {
  coveredByToolCards,
  type CoveredToolPart,
  ToolActivityStack,
  type ToolCardGroup,
  toolCardsFromParts,
  ToolCardStackContext
} from '@/components/assistant-ui/tool-cards'
import { scrollToSessionApproval } from '@/lib/approval-anchor'
import { sessionApprovalRequest } from '@/store/prompts'

import { isApprovalActivity, isCurrentTurnMessage } from './approval-activity'
import { selectMessageRunning } from './fallback-model'

function thumbKey(group: ToolCardGroup): string {
  const thumb = group.thumb

  return thumb ? (thumb.kind === 'screenshot' ? thumb.src : thumb.url) : ''
}

function sameCard(left: ToolCardGroup['cards'][number], right: ToolCardGroup['cards'][number]): boolean {
  return (
    left.id === right.id &&
    left.state === right.state &&
    left.status === right.status &&
    left.reason === right.reason &&
    left.durationLabel === right.durationLabel &&
    left.durationMs === right.durationMs &&
    left.output === right.output &&
    left.interrupted === right.interrupted &&
    left.step.args === right.step.args &&
    left.step.result === right.step.result &&
    left.step.thumbnailId === right.step.thumbnailId &&
    left.args.length === right.args.length &&
    left.args.every((arg, index) => arg.label === right.args[index]?.label && arg.value === right.args[index]?.value)
  )
}

function sameGroups(left: readonly ToolCardGroup[], right: readonly ToolCardGroup[]): boolean {
  return (
    left.length === right.length &&
    left.every((group, index) => {
      const next = right[index]

      return Boolean(
        next &&
          group.key === next.key &&
          group.family === next.family &&
          group.name === next.name &&
          group.state === next.state &&
          thumbKey(group) === thumbKey(next) &&
          group.cards.length === next.cards.length &&
          group.cards.every((card, cardIndex) => {
            const nextCard = next.cards[cardIndex]

            return Boolean(nextCard && sameCard(card, nextCard))
          })
      )
    })
  )
}

/**
 * Bot Chat tool activity cards: replaces BotActivityPill in a Bot Chat transcript.
 * Renders tool calls as live ToolActivityStack cards and suppresses redundant
 * quiet rows in children via ToolCardStackContext.
 */
export const BotToolCards: FC<PropsWithChildren<{ endIndex: number; revision: string; startIndex: number }>> = ({
  children,
  endIndex,
  revision,
  startIndex
}) => {
  const parts = useAuiState(state => state.message.parts)
  const currentTurn = useAuiState(state => isCurrentTurnMessage(state.thread.messages, state.message.id))
  const live = useAuiState(selectMessageRunning)
  const sessionId = useStore(useSessionView().$runtimeId)
  const approval = useStore(useMemo(() => sessionApprovalRequest(sessionId), [sessionId]))

  const coveredParts = useMemo(() => {
    const slice = parts.slice(Math.max(0, startIndex), endIndex + 1)

    return slice.filter(
      (part): part is ToolCallMessagePartProps =>
        part.type === 'tool-call' &&
        typeof (part as { toolName?: unknown }).toolName === 'string' &&
        coveredByToolCards(part as unknown as CoveredToolPart)
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the parts array keeps its identity across in-place part updates; revision is the parent's change signal.
  }, [parts, revision, startIndex, endIndex])

  const approvalCallId = useMemo(() => {
    if (!approval || !currentTurn) {
      return undefined
    }

    for (let index = coveredParts.length - 1; index >= 0; index--) {
      const part = coveredParts[index] as unknown as {
        completedAt?: number
        interrupted?: boolean
        result?: unknown
        toolCallId?: string
        toolName: string
      }

      if (
        isApprovalActivity(part) &&
        part.result === undefined &&
        part.completedAt === undefined &&
        !part.interrupted
      ) {
        return part.toolCallId
      }
    }

    return undefined
  }, [approval, currentTurn, coveredParts])

  const freshGroups = useMemo(
    () => toolCardsFromParts(coveredParts, { approvalCallId }),
    [coveredParts, approvalCallId]
  )

  const cacheRef = useRef<ToolCardGroup[]>([])

  if (!sameGroups(cacheRef.current, freshGroups)) {
    cacheRef.current = freshGroups
  }

  const groups = cacheRef.current

  const handleReviewApproval = useCallback(() => {
    scrollToSessionApproval(sessionId)
  }, [sessionId])

  return (
    <>
      <ToolActivityStack
        groups={groups}
        live={live}
        onReviewApproval={handleReviewApproval}
        sessionId={sessionId ?? undefined}
      />
      <ToolCardStackContext.Provider value={true}>{children}</ToolCardStackContext.Provider>
    </>
  )
}
