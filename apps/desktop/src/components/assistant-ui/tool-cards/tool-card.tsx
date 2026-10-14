import { type JSX, type KeyboardEvent, type MouseEvent, type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ToolIcon } from '@/components/ui/tool-icon'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { ToolCardDetails } from './tool-card-details'
import { ScreenshotThumb, SiteFavicon } from './tool-card-thumb'
import type { ToolCardGroup } from './types'

function TypingDots() {
  return (
    <span aria-hidden="true" className="motion-typing inline-flex shrink-0 items-center gap-0.5" data-typing="">
      <span className="size-1 rounded-full bg-current" />
      <span className="size-1 rounded-full bg-current" />
      <span className="size-1 rounded-full bg-current" />
    </span>
  )
}

function isLiveState(state: ToolCardGroup['state']): boolean {
  return state !== 'done'
}

function toggleOnKey(toggle: () => void) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('button')) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggle()
    }
  }
}

function toggleOnClick(toggle: () => void) {
  return (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('button')) {
      return
    }

    toggle()
  }
}

/** One tool group: a live card while it works, settling into a quiet line
 *  once done. A single root keeps its DOM node across the change so the
 *  transition animates instead of remounting. */
export function ToolCard({
  actor,
  group,
  onReviewApproval
}: {
  actor?: ReactNode
  group: ToolCardGroup
  onReviewApproval?: () => void
}): JSX.Element {
  const { t } = useI18n()
  const copy = t.assistant.toolCards
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  const [mountedLive] = useState(() => isLiveState(group.state))

  const live = isLiveState(group.state)
  const last = group.cards[group.cards.length - 1]
  const multi = group.cards.length > 1
  const header = group.state === 'done' && multi ? copy.usedTimes(group.name, group.cards.length) : last.status
  const site = group.thumb?.kind === 'site' ? group.thumb : null
  const shot = group.thumb?.kind === 'screenshot' ? group.thumb.src : null

  const toggle = () => {
    setOpen(current => !current)
    setEverOpened(true)
  }

  return (
    <div data-tool-card={group.state} data-tool-card-key={group.key} role="listitem">
      <div
        aria-expanded={open}
        aria-label={open ? copy.hideDetails : copy.showDetails}
        className={cn(
          'w-full max-w-md transition-[background-color,border-color,box-shadow,padding,min-height] duration-(--dur-base) ease-spring',
          mountedLive && 'motion-arrive',
          live
            ? 'flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface-raised px-3 py-2.5 text-left shadow-e1'
            : 'flex min-h-7 items-center gap-2 rounded-row border border-transparent px-1.5 text-left text-ui-xs text-fg-muted hover:bg-hover'
        )}
        onClick={toggleOnClick(toggle)}
        onKeyDown={toggleOnKey(toggle)}
        role="button"
        tabIndex={0}
      >
        {live ? (
          <>
            <span
              className={cn(
                'relative grid size-9 shrink-0 place-items-center rounded-control bg-surface-sunken text-fg-secondary',
                group.state === 'running' && 'motion-ring text-info',
                group.state === 'error' && 'bg-danger/10 text-danger',
                group.state === 'approval' && 'bg-warning/10 text-warning'
              )}
            >
              <ToolIcon
                className={group.state === 'running' ? 'text-fg-secondary' : undefined}
                name={group.icon}
                size={18}
              />
              {actor ? (
                <span className="absolute -right-1 -bottom-1 block overflow-hidden rounded-full ring-2 ring-surface-raised">
                  {actor}
                </span>
              ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-ui-sm font-semibold text-fg">
                {group.name}
                {multi ? <span className="font-normal text-fg-subtle tabular-nums"> · {group.cards.length}</span> : null}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 truncate text-ui-xs">
                {site ? <SiteFavicon host={site.host} url={site.url} /> : null}
                {group.state === 'running' ? (
                  <>
                    <span className="motion-shimmer min-w-0 truncate text-fg-muted">{last.status}</span>
                    <TypingDots />
                  </>
                ) : group.state === 'approval' ? (
                  <span className="min-w-0 truncate text-warning">{copy.awaitingApproval}</span>
                ) : (
                  <span className="min-w-0 truncate text-fg-muted">{last.status}</span>
                )}
              </span>
              {group.state === 'error' && last.reason ? (
                <span className="text-ui-xs text-danger line-clamp-2">{last.reason}</span>
              ) : null}
            </span>
            {group.state === 'approval' && onReviewApproval ? (
              <Button
                onClick={event => {
                  event.stopPropagation()
                  onReviewApproval()
                }}
                size="xs"
                variant="outline"
              >
                {copy.reviewApproval}
              </Button>
            ) : null}
            {shot ? <ScreenshotThumb src={shot} /> : null}
          </>
        ) : (
          <>
            <ToolIcon className="shrink-0 text-fg-subtle" name={group.icon} size={14} />
            <Codicon className="shrink-0 text-success" name="check" size={12} />
            <span className="min-w-0 flex-1 truncate">{header}</span>
            {site ? <SiteFavicon host={site.host} url={site.url} /> : null}
            {last.durationLabel ? (
              <span className="shrink-0 text-ui-2xs text-fg-subtle tabular-nums">{last.durationLabel}</span>
            ) : null}
          </>
        )}
      </div>
      {everOpened ? <ToolCardDetails group={group} live={live} open={open} /> : null}
    </div>
  )
}
