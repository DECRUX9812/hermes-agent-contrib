import type { BrowserSnapshotResult, BrowserThumbnailResult } from '@hermes/shared'
import { useQuery } from '@tanstack/react-query'

import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import type { SessionOwnerScope } from '@/store/session-request-router'
import { requestForSessionProfile } from '@/store/session-request-router'

export interface BrowserStepOwner {
  owner?: SessionOwnerScope
  profile?: string
  sessionId?: string
  toolCallId?: string
}

function ownerKey(owner: SessionOwnerScope | undefined): string {
  if (typeof owner === 'string') {
    return owner
  }

  return owner ? `${owner.connectionId}:${owner.profile}:${owner.targetProfile ?? ''}` : ''
}

function ownerProfile(owner: SessionOwnerScope | undefined, fallback?: string): string | undefined {
  if (typeof owner === 'string') {
    return owner
  }

  return owner ? (owner.targetProfile ?? owner.profile) : fallback
}

export function browserStepThumbnailKey(step: BrowserStepOwner) {
  return ['browser-step-thumbnail', ownerKey(step.owner), step.profile ?? '', step.sessionId ?? '', step.toolCallId ?? ''] as const
}

export function browserStepSnapshotKey(step: BrowserStepOwner) {
  return ['browser-step-snapshot', ownerKey(step.owner), step.profile ?? '', step.sessionId ?? '', step.toolCallId ?? ''] as const
}

function canReadBrowserStep(step: BrowserStepOwner): boolean {
  return Boolean(step.toolCallId && step.sessionId && (step.owner || step.profile))
}

function requestParams(step: BrowserStepOwner) {
  return {
    profile: ownerProfile(step.owner, step.profile),
    session_id: step.sessionId,
    tool_call_id: step.toolCallId ?? ''
  }
}

export function useBrowserStepThumbnail(step: BrowserStepOwner, enabled = true) {
  const { requestGateway } = useGatewayRequest()

  return useQuery({
    enabled: enabled && canReadBrowserStep(step),
    queryFn: ({ signal }) =>
      requestForSessionProfile<BrowserThumbnailResult>(
        step.owner ?? step.profile,
        requestGateway,
        'fork.browser.thumbnail',
        requestParams(step),
        undefined,
        signal
      ),
    queryKey: browserStepThumbnailKey(step),
    retry: false,
    staleTime: 5 * 60_000
  })
}

export function useBrowserStepSnapshot(step: BrowserStepOwner, enabled = true) {
  const { requestGateway } = useGatewayRequest()

  return useQuery({
    enabled: enabled && canReadBrowserStep(step),
    queryFn: ({ signal }) =>
      requestForSessionProfile<BrowserSnapshotResult>(
        step.owner ?? step.profile,
        requestGateway,
        'fork.browser.snapshot',
        requestParams(step),
        undefined,
        signal
      ),
    queryKey: browserStepSnapshotKey(step),
    retry: false,
    staleTime: 5 * 60_000
  })
}

export function browserThumbnailSource(
  result: BrowserThumbnailResult | undefined,
  fallback?: string
): string | undefined {
  if (result?.found && result.data_base64) {
    return `data:${result.mime || 'image/png'};base64,${result.data_base64}`
  }

  return fallback
}
