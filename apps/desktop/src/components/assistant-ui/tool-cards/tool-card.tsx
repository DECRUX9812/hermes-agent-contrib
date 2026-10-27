import {
  createContext,
  type HTMLAttributes,
  type JSX,
  type KeyboardEvent,
  memo,
  type MouseEvent,
  type ReactNode,
  useState
} from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Favicon } from '@/components/ui/favicon'
import { ToolIcon } from '@/components/ui/tool-icon'
import { Tip } from '@/components/ui/tooltip'
import { useMediaImage } from '@/hooks/use-media-image'
import { useI18n } from '@/i18n'
import type { ToolCardsCopy } from '@/i18n/types_tool_cards'
import { hostPathLabel } from '@/lib/external-link'
import { cn } from '@/lib/utils'
import { openPreview } from '@/store/preview'

import { isPublicHost, type ToolCardGroup, type ToolCardView } from './model'

export const ToolCardStackContext = createContext(false)

/** A site's icon, inline at 14px. Renders nothing for private hosts so the
 *  lookup never touches the LAN; the fixed empty fallback keeps local names
 *  from flashing a spinner. */
export function SiteFavicon({ host, url }: { host: string; url: string }) {
  if (!isPublicHost(host)) {
    return null
  }

  return (
    <span className="inline-grid size-3.5 shrink-0 place-items-center">
      <Favicon fallback={<span className="block size-full" />} url={url} />
    </span>
  )
}

/** A fixed-size screenshot tile: the box is always the same geometry so the
 *  row never reflows when the image resolves, and it vanishes on failure. */
export function ScreenshotThumb({ src }: { src: string }) {
  const image = useMediaImage(src, 16 / 10)

  if (image.failed) {
    return null
  }

  return (
    <span className="h-10 w-16 shrink-0 overflow-hidden rounded-control border border-line bg-surface-sunken">
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

/** The web page a set of steps was last on: the newest step that knows its
 *  address, at or before `index` (a click or screenshot stays on the page the
 *  last navigation opened). Empty when none of them does. */
export function stepPageUrl(cards: readonly ToolCardView[], index = cards.length - 1): string {
  for (let at = Math.min(index, cards.length - 1); at >= 0; at -= 1) {
    const url = cards[at]?.thumb?.url

    if (url && /^https?:\/\//i.test(url)) {
      return url
    }
  }

  return ''
}

/** Opens a step's page in the side preview. `iconOnly` is the compact form
 *  for a card row, where it must not toggle the row it sits in. */
export function OpenPageButton({
  className,
  iconOnly = false,
  url
}: {
  className?: string
  iconOnly?: boolean
  url: string
}) {
  const { t } = useI18n()
  const label = t.assistant.toolCards.viewer.openPage
  const { $runtimeId, $storedId } = useSessionView()

  const open = (event: MouseEvent) => {
    event.stopPropagation()
    openPreview(
      { kind: 'url', label: hostPathLabel(url), source: url, url },
      $storedId.get() ?? undefined,
      $runtimeId.get()
    )
  }

  return (
    <Tip label={url}>
      <Button
        aria-label={label}
        className={cn(iconOnly ? 'shrink-0 text-fg-subtle hover:text-fg' : 'h-6 gap-1 px-1.5 text-ui-xs', className)}
        data-open-page=""
        onClick={open}
        onKeyDown={event => event.stopPropagation()}
        size={iconOnly ? 'icon-xs' : 'sm'}
        type="button"
        variant="ghost"
      >
        <Codicon name="link-external" />
        {iconOnly ? null : label}
      </Button>
    </Tip>
  )
}

/** One call's request, output, error and duration inside an expanded card. */
export function CardBlock({ card, showStatus }: { card: ToolCardView; showStatus: boolean }) {
  const { t } = useI18n()
  const copy = t.assistant.toolCards
  // Browser steps show their page and screenshot in the step pager instead.
  const pageUrl = card.family === 'browser' ? '' : stepPageUrl([card])
  const shot = card.family !== 'browser' && card.thumb?.kind === 'screenshot' ? card.thumb.src : ''

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {showStatus ? <div className="truncate text-ui-xs text-fg-muted">{card.status}</div> : null}
      {pageUrl || shot ? (
        <div className="flex min-w-0 items-center gap-2" data-card-page="">
          {shot ? (
            <ScreenshotThumb src={shot} />
          ) : (
            <span className="inline-grid size-4 shrink-0 place-items-center text-fg-subtle">
              {isPublicHost(new URL(pageUrl).hostname) ? (
                <Favicon fallback={<Codicon name="globe" size={14} />} url={pageUrl} />
              ) : (
                <Codicon name="globe" size={14} />
              )}
            </span>
          )}
          {pageUrl ? (
            <>
              <span className="min-w-0 flex-1 truncate text-ui-xs text-fg-secondary">{hostPathLabel(pageUrl)}</span>
              <OpenPageButton url={pageUrl} />
            </>
          ) : null}
        </div>
      ) : null}
      {card.args.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="text-ui-2xs text-fg-subtle">{copy.details.request}</div>
          {card.args.map(detail => (
            <div className="flex min-w-0 gap-2" key={detail.label}>
              <span className="w-16 shrink-0 text-fg-subtle">{detail.label}</span>
              <span className="min-w-0 flex-1 break-words font-mono text-ui-2xs text-fg-secondary line-clamp-3">
                {detail.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="text-ui-2xs text-fg-subtle">{copy.details.output}</div>
      {card.output ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-control bg-surface-sunken p-2 font-mono text-ui-2xs text-fg-secondary">
          {card.output}
        </pre>
      ) : (
        <div className="text-ui-2xs text-fg-subtle">{copy.details.noOutput}</div>
      )}
      {card.reason ? <div className="text-ui-xs text-danger">{card.reason}</div> : null}
      {card.durationLabel ? (
        <div className="text-ui-2xs text-fg-subtle">
          {copy.details.duration} <span className="tabular-nums">{card.durationLabel}</span>
        </div>
      ) : null}
    </div>
  )
}

function stepHost(card: ToolCardView): string {
  return card.thumb?.kind === 'site' ? card.thumb.host : ''
}

function stepScreenshot(card: ToolCardView): string {
  return card.thumb?.kind === 'screenshot' ? card.thumb.src : ''
}


/** The settled default is the latest step with a picture, else the last one. */
function latestScreenshotIndex(cards: readonly ToolCardView[]): number | null {
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    if (stepScreenshot(cards[index])) {
      return index
    }
  }

  return null
}

function StepShot({ src }: { src: string }) {
  const image = useMediaImage(src, 16 / 9)

  if (!image.src || image.failed) {
    return null
  }

  return (
    <img
      alt=""
      aria-hidden
      className="h-full w-full object-contain"
      onError={image.onError}
      onLoad={event => image.onLoad(event.currentTarget)}
      src={image.src}
    />
  )
}

/** The browser steps viewer: a frame on the selected step plus an ordered
 *  step list. Key handling sits on the section so arrows work from any of
 *  its buttons without adding a tab stop. */
export function BrowserSteps({ group }: { group: ToolCardGroup }) {
  const { t } = useI18n()
  const copy = t.assistant.toolCards.viewer
  const { cards, name } = group
  const total = cards.length
  const [manual, setManual] = useState<number | null>(null)

  const live = group.state !== 'done'
  const settledDefault = latestScreenshotIndex(cards) ?? total - 1
  const selected = Math.min(manual ?? (live ? total - 1 : settledDefault), total - 1)
  const step = cards[selected]
  const shot = stepScreenshot(step)
  const host = stepHost(step)
  const pageUrl = stepPageUrl(cards, selected)

  const move = (delta: number) => {
    setManual(Math.min(total - 1, Math.max(0, selected + delta)))
  }

  return (
    <section
      aria-label={copy.title(name)}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft') {
          move(-1)
        } else if (event.key === 'ArrowRight') {
          move(1)
        }
      }}
    >
      <div className="text-ui-xs font-semibold text-fg">{copy.title(name)}</div>
      <div className="mt-1 aspect-video w-full max-w-md overflow-hidden rounded-card border border-line bg-surface-sunken">
        {shot ? (
          <StepShot key={shot} src={shot} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 text-ui-xs text-fg-subtle">
            {pageUrl && isPublicHost(new URL(pageUrl).hostname) ? (
              <span className="inline-grid size-6 place-items-center">
                <Favicon fallback={<Codicon name="globe" size={20} />} url={pageUrl} />
              </span>
            ) : null}
            {pageUrl ? (
              <span className="max-w-full truncate text-ui-sm text-fg-secondary">{hostPathLabel(pageUrl)}</span>
            ) : host ? (
              <span className="truncate">{host}</span>
            ) : null}
            <span>{copy.noScreenshot}</span>
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1">
        <Button
          aria-label={copy.previous}
          disabled={selected <= 0}
          onClick={() => move(-1)}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name="chevron-left" />
        </Button>
        <span className="min-w-0 flex-1 text-center text-ui-xs text-fg-muted tabular-nums">
          {copy.step(selected + 1, total)}
        </span>
        <Button
          aria-label={copy.next}
          disabled={selected >= total - 1}
          onClick={() => move(1)}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name="chevron-right" />
        </Button>
        {pageUrl ? <OpenPageButton url={pageUrl} /> : null}
      </div>
      <ol className="mt-1 flex flex-col gap-0.5">
        {cards.map((card, index) => {
          const rowHost = stepHost(card)

          return (
            <li key={card.id}>
              <button
                aria-current={index === selected ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-row px-2 py-1 text-left text-ui-xs text-fg-muted hover:bg-hover',
                  index === selected && 'bg-selected text-fg'
                )}
                onClick={() => setManual(index)}
                type="button"
              >
                <span className="shrink-0 tabular-nums">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{card.status}</span>
                {rowHost ? <span className="shrink-0 truncate">{rowHost}</span> : null}
              </button>
            </li>
          )
        })}
      </ol>
      <div className="mt-2">
        <CardBlock card={step} showStatus={false} />
      </div>
    </section>
  )
}

/** The expandable panel under a card row. Mounted on first open and kept so
 *  closing never drops a loaded screenshot. */
export function ToolCardDetails({
  group,
  live,
  open
}: {
  group: ToolCardGroup
  live: boolean
  open: boolean
}) {
  const multi = group.cards.length > 1

  return (
    <div className="motion-collapse" data-open={open}>
      <div>
        <div className={cn('flex min-w-0 flex-col gap-2 pt-1 pr-1 pb-1 text-ui-xs', live ? 'pl-12' : 'pl-6')}>
          {group.family === 'browser' ? (
            <BrowserSteps group={group} />
          ) : (
            group.cards.map(card => <CardBlock card={card} key={card.id} showStatus={multi} />)
          )}
        </div>
      </div>
    </div>
  )
}

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
  const pageUrl = stepPageUrl(group.cards)

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
      {pageUrl && group.state !== 'approval' ? <OpenPageButton iconOnly url={pageUrl} /> : null}
    </>
  )
}

function QuietCardBody({ copy, group, toggle }: Pick<CardBodyProps, 'copy' | 'group' | 'toggle'>) {
  const last = group.cards[group.cards.length - 1]
  const header = group.cards.length > 1 ? copy.usedTimes(group.name, group.cards.length) : last.status
  const site = group.thumb?.kind === 'site' ? group.thumb : null
  const pageUrl = stepPageUrl(group.cards)

  return (
    <>
      <span {...toggle} className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-row">
        <ToolIcon className="shrink-0 text-fg-subtle" name={group.icon} size={14} />
        <Codicon className="shrink-0 text-success" name="check" size={12} />
        <span className="min-w-0 flex-1 truncate">{header}</span>
        {site ? <SiteFavicon host={site.host} url={site.url} /> : null}
        {last.durationLabel ? (
          <span className="shrink-0 text-ui-2xs text-fg-subtle tabular-nums">{last.durationLabel}</span>
        ) : null}
      </span>
      {pageUrl ? (
        <OpenPageButton
          className="opacity-0 transition-opacity duration-(--dur-fast) group-hover/tool-row:opacity-100 focus-visible:opacity-100"
          iconOnly
          url={pageUrl}
        />
      ) : null}
    </>
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
            : 'group/tool-row flex min-h-7 items-center gap-2 rounded-row border border-transparent px-1.5 text-left text-ui-xs text-fg-muted hover:bg-hover'
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

export interface ToolActivityStackProps {
  groups: readonly ToolCardGroup[]
  /** The bot doing the work (group rooms): a small face drawn on each card's icon tile. */
  actor?: ReactNode
  /** Shown as a Review button on a card waiting for approval. */
  onReviewApproval?: () => void
  className?: string
}

/** Live tool activity cards, inline in the chat. Renders nothing when there
 *  is nothing to show. Groups stay keyed by their stable key so a group that
 *  grows or settles keeps its DOM node and animates instead of remounting. */
function ToolActivityStackImpl({ actor, className, groups, onReviewApproval }: ToolActivityStackProps): JSX.Element | null {
  const { t } = useI18n()

  if (groups.length === 0) {
    return null
  }

  return (
    <div
      aria-label={t.assistant.toolCards.activityLabel}
      className={cn('flex min-w-0 max-w-full flex-col gap-1.5', className)}
      data-slot="tool-activity-stack"
      role="list"
    >
      {groups.map(group => (
        <ToolCard actor={actor} group={group} key={group.key} onReviewApproval={onReviewApproval} />
      ))}
    </div>
  )
}

export const ToolActivityStack = memo(ToolActivityStackImpl)
