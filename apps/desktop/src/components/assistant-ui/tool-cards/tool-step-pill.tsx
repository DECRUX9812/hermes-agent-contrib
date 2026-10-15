import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { Codicon } from '@/components/ui/codicon'
import { ToolIcon } from '@/components/ui/tool-icon'
import { useMediaImage } from '@/hooks/use-media-image'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { openToolStep } from '@/store/preview'
import { $activeGatewayProfile } from '@/store/profile'
import { $activeSessionId, $selectedStoredSessionId, $sessions, knownSessionOwner, rememberedSessionProfile } from '@/store/session'

import { browserThumbnailSource, useBrowserStepThumbnail } from './browser-step-resource'
import type { ToolCardView } from './types'

function useNearViewport(ref: { current: Element | null }): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = ref.current

    if (!element) {
      return
    }

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)

      return
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '160px' }
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [ref])

  return visible
}

function StepThumbnail({
  card,
  owner,
  profile,
  sessionId,
  visible
}: {
  card: ToolCardView
  owner?: ReturnType<typeof knownSessionOwner>
  profile: string
  sessionId?: string
  visible: boolean
}) {
  const toolCallId = card.step.toolCallId
  const request = { owner, profile, sessionId, toolCallId }
  const query = useBrowserStepThumbnail(request, visible)
  const fallback = card.thumb?.kind === 'screenshot' ? card.thumb.src : undefined
  const src = browserThumbnailSource(query.data, fallback)
  const image = useMediaImage(src ?? '', 16 / 10)

  if (!src || image.failed) {
    return null
  }

  return (
    <span className="h-8 w-12 shrink-0 overflow-hidden rounded-control bg-surface-sunken">
      {image.src ? (
        <img
          alt=""
          aria-hidden
          className="h-full w-full object-cover object-top"
          onError={image.onError}
          onLoad={event => image.onLoad(event.currentTarget)}
          src={image.src}
        />
      ) : null}
    </span>
  )
}

function LazyStepThumbnail({
  anchor,
  card,
  owner,
  profile,
  sessionId
}: {
  anchor: { current: Element | null }
  card: ToolCardView
  owner?: ReturnType<typeof knownSessionOwner>
  profile: string
  sessionId?: string
}) {
  const visible = useNearViewport(anchor)

  return <StepThumbnail card={card} owner={owner} profile={profile} sessionId={sessionId} visible={visible} />
}

function pillLabel(card: ToolCardView): string {
  const details = [card.name, card.status, card.state === 'error' ? card.reason : undefined].filter(Boolean)

  return details.join(': ')
}

export function ToolStepPill({
  actor,
  card,
  sessionId: requestedSessionId
}: {
  actor?: ReactNode
  card: ToolCardView
  sessionId?: string
}) {
  const { t } = useI18n()
  const sessionView = useSessionView()
  const viewRuntimeId = useStore(sessionView.$runtimeId)
  const viewStoredId = useStore(sessionView.$storedId)
  const activeProfile = useStore($activeGatewayProfile)
  const sessions = useStore($sessions)
  const sessionId = requestedSessionId ?? viewRuntimeId ?? undefined
  const owner = knownSessionOwner(sessions, sessionId ?? viewStoredId ?? $activeSessionId.get())
  const profile = rememberedSessionProfile(sessions, sessionId ?? viewStoredId, activeProfile)
  const browserStep = card.family === 'browser' && Boolean(card.step.toolCallId)
  const statusClass = card.state === 'error' ? 'text-danger' : card.state === 'approval' ? 'text-warning' : 'text-fg-muted'
  const ref = useRef<HTMLButtonElement>(null)

  return (
    <div className="min-w-0 max-w-full">
      <button
        aria-label={pillLabel(card)}
        className="focus-ring flex min-h-7 min-w-0 max-w-full items-center gap-2 rounded-pill px-2 py-1 text-left text-ui-xs text-fg-muted hover:bg-hover"
        data-tool-step={card.state}
        onClick={() =>
          openToolStep(
            {
              action: card.status,
              args: card.step.args,
              completedAt: card.completedAt,
              durationLabel: card.durationLabel,
              family: card.family,
              name: card.name,
              owner,
              reason: card.reason,
              result: card.step.result,
              sessionId,
              startedAt: card.step.startedAt,
              state: card.state,
              thumbnail: card.thumb,
              thumbnailId: card.step.thumbnailId,
              title: t.assistant.toolCards.viewer.title(card.name),
              toolCallId: card.step.toolCallId,
              toolName: card.step.toolName,
              url: card.thumb?.url
            },
            viewStoredId ?? $selectedStoredSessionId.get(),
            viewRuntimeId ?? $activeSessionId.get(),
            profile
          )
        }
        ref={ref}
        type="button"
      >
        <span className={cn('relative grid size-4 shrink-0 place-items-center rounded-control text-fg-secondary', card.state === 'running' && 'motion-ring text-info')}>
          <ToolIcon name={card.icon} size={14} />
          {actor ? <span className="absolute -right-1 -bottom-1 overflow-hidden rounded-full ring-1 ring-surface">{actor}</span> : null}
        </span>
        <span className="shrink-0 font-medium text-fg">{card.name}</span>
        <span className={cn('min-w-0 flex-1 truncate', statusClass)}>
          {card.state === 'error' ? card.reason ?? card.status : card.status || t.assistant.toolCards.working}
        </span>
        {card.state === 'done' && !card.interrupted ? (
          <Codicon className="shrink-0 text-success" name="check" size={12} />
        ) : null}
        {card.state === 'error' ? <Codicon className="shrink-0 text-danger" name="error" size={12} /> : null}
        {card.state === 'approval' ? <Codicon className="shrink-0 text-warning" name="warning" size={12} /> : null}
        {card.state === 'done' && card.durationLabel ? (
          <span className="shrink-0 font-mono text-ui-2xs tabular-nums text-fg-subtle">{card.durationLabel}</span>
        ) : null}
        {browserStep ? (
          <LazyStepThumbnail anchor={ref} card={card} owner={owner} profile={profile} sessionId={sessionId} />
        ) : null}
      </button>
    </div>
  )
}
