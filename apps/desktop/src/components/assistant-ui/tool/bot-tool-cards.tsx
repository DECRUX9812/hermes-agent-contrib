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

function cardSignature(card: ToolCardGroup['cards'][number]): string {
  return `${card.id}:${card.state}:${card.status}:${card.reason ?? ''}:${card.durationLabel ?? ''}:${card.output?.length ?? 0}`
}

function groupSignature(group: ToolCardGroup): string {
  const thumbUrl = group.thumb ? (group.thumb.kind === 'screenshot' ? group.thumb.src : group.thumb.url) : ''

  return `${group.key}|${group.state}|${thumbUrl}|${group.cards.map(cardSignature).join(',')}`
}

function groupsSignature(groups: readonly ToolCardGroup[]): string {
  return groups.map(groupSignature).join(';')
}

/**
 * Bot Chat tool activity cards: replaces BotActivityPill in a Bot Chat transcript.
 * Renders tool calls as live ToolActivityStack cards and suppresses redundant
 * quiet rows in children via ToolCardStackContext.
 */
export const BotToolCards: FC<PropsWithChildren<{ endIndex: number; startIndex: number }>> = ({
  children,
  endIndex,
  startIndex
}) => {
  const parts = useAuiState(state => state.message.parts)
  const currentTurn = useAuiState(state => isCurrentTurnMessage(state.thread.messages, state.message.id))
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
  }, [parts, startIndex, endIndex])

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

  const cacheRef = useRef<{ groups: ToolCardGroup[]; signature: string }>({ groups: [], signature: '' })
  const signature = useMemo(() => groupsSignature(freshGroups), [freshGroups])

  if (cacheRef.current.signature !== signature || cacheRef.current.groups.length !== freshGroups.length) {
    cacheRef.current = { groups: freshGroups, signature }
  }

  const groups = cacheRef.current.groups

  const handleReviewApproval = useCallback(() => {
    scrollToSessionApproval(sessionId)
  }, [sessionId])

  return (
    <>
      <ToolActivityStack groups={groups} onReviewApproval={handleReviewApproval} />
      <ToolCardStackContext.Provider value={true}>{children}</ToolCardStackContext.Provider>
    </>
  )
}
