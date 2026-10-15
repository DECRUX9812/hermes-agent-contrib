import { type HTMLAttributes, type JSX, type KeyboardEvent, type MouseEvent, type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ToolIcon } from '@/components/ui/tool-icon'
import { useI18n } from '@/i18n'
import type { ToolCardsCopy } from '@/i18n/types_tool_cards'
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
  return (event: KeyboardEvent<HTMLSpanElement>) => {
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

interface CardBodyProps {
  actor?: ReactNode
  copy: ToolCardsCopy
  group: ToolCardGroup
  onReviewApproval?: () => void
  /** The disclosure control. Review sits beside it, never inside, so it stays reachable. */
  toggle: HTMLAttributes<HTMLSpanElement>
}

function LiveStatus({ copy, group }: Pick<CardBodyProps, 'copy' | 'group'>) {
  const status = group.cards[group.cards.length - 1].status

  if (group.state === 'running') {
    return (
      <>
        <span className="motion-shimmer min-w-0 truncate text-fg-muted">{status}</span>
        <TypingDots />
      </>
    )
  }

  if (group.state === 'approval') {
    return <span className="min-w-0 truncate text-warning">{copy.awaitingApproval}</span>
  }

  return <span className="min-w-0 truncate text-fg-muted">{status}</span>
}

function LiveCardBody({ actor, copy, group, onReviewApproval, toggle }: CardBodyProps) {
  const last = group.cards[group.cards.length - 1]
  const site = group.thumb?.kind === 'site' ? group.thumb : null
  const shot = group.thumb?.kind === 'screenshot' ? group.thumb.src : null

  return (
    <>
      <span {...toggle} className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-control">
      <span
        className={cn(
          'relative grid size-9 shrink-0 place-items-center rounded-control bg-surface-sunken text-fg-secondary',
          group.state === 'running' && 'motion-ring text-info',
          group.state === 'error' && 'bg-danger/10 text-danger',
          group.state === 'approval' && 'bg-warning/10 text-warning'
        )}
      >
        <ToolIcon className={group.state === 'running' ? 'text-fg-secondary' : undefined} name={group.icon} size={18} />
        {actor ? (
          <span className="absolute -right-1 -bottom-1 block overflow-hidden rounded-full ring-2 ring-surface-raised">
            {actor}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui-sm font-semibold text-fg">
          {group.name}
          {group.cards.length > 1 ? (
            <span className="font-normal text-fg-subtle tabular-nums"> · {group.cards.length}</span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-ui-xs">
          {site ? <SiteFavicon host={site.host} url={site.url} /> : null}
          <LiveStatus copy={copy} group={group} />
        </span>
        {group.state === 'error' && last.reason ? (
          <span className="text-ui-xs text-danger line-clamp-2">{last.reason}</span>
        ) : null}
      </span>
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
  )
}

function QuietCardBody({ copy, group, toggle }: Pick<CardBodyProps, 'copy' | 'group' | 'toggle'>) {
  const last = group.cards[group.cards.length - 1]
  const header = group.cards.length > 1 ? copy.usedTimes(group.name, group.cards.length) : last.status
  const site = group.thumb?.kind === 'site' ? group.thumb : null

  return (
    <span {...toggle} className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-row">
      <ToolIcon className="shrink-0 text-fg-subtle" name={group.icon} size={14} />
      <Codicon className="shrink-0 text-success" name="check" size={12} />
      <span className="min-w-0 flex-1 truncate">{header}</span>
      {site ? <SiteFavicon host={site.host} url={site.url} /> : null}
      {last.durationLabel ? (
        <span className="shrink-0 text-ui-2xs text-fg-subtle tabular-nums">{last.durationLabel}</span>
      ) : null}
    </span>
  )
}

function cardLabel(copy: ToolCardsCopy, group: ToolCardGroup): string {
  const last = group.cards[group.cards.length - 1]

  if (group.state === 'approval') {
    return `${group.name}: ${copy.awaitingApproval}`
  }

  if (group.state === 'done' && group.cards.length > 1) {
    return copy.usedTimes(group.name, group.cards.length)
  }

  return [`${group.name}: ${last.status}`, group.state === 'error' ? last.reason : null].filter(Boolean).join('. ')
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

  const toggle = () => {
    if (everOpened) {
      setOpen(current => !current)

      return
    }

    // Mount the panel closed first so its grid row has a 0fr frame to grow from.
    setEverOpened(true)
    requestAnimationFrame(() => setOpen(true))
  }

  const toggleProps: HTMLAttributes<HTMLSpanElement> = {
    'aria-expanded': open,
    'aria-label': cardLabel(copy, group),
    onKeyDown: toggleOnKey(toggle),
    role: 'button',
    tabIndex: 0
  }

  return (
    <div data-tool-card={group.state} data-tool-card-key={group.key} role="listitem">
      {/* The whole surface is a pointer target; keyboard and assistive tech use the toggle inside it. */}
      <div
        className={cn(
          'w-full max-w-md transition-[background-color,border-color,box-shadow,padding,min-height] duration-(--dur-base) ease-spring',
          mountedLive && 'motion-arrive',
          live
            ? 'flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface-raised px-3 py-2.5 text-left shadow-e1'
            : 'flex min-h-7 items-center gap-2 rounded-row border border-transparent px-1.5 text-left text-ui-xs text-fg-muted hover:bg-hover'
        )}
        onClick={toggleOnClick(toggle)}
      >
        {live ? (
          <LiveCardBody actor={actor} copy={copy} group={group} onReviewApproval={onReviewApproval} toggle={toggleProps} />
        ) : (
          <QuietCardBody copy={copy} group={group} toggle={toggleProps} />
        )}
      </div>
      {everOpened ? <ToolCardDetails group={group} live={live} open={open} /> : null}
    </div>
  )
}
