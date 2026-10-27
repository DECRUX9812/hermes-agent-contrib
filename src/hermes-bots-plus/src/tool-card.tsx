import {
  Button,
  cn,
  Codicon,
  Favicon,
  hostPathLabel,
  openPreview,
  Tip,
  type ToolCardsCopy,
  ToolIcon,
  type ToolRunRendererProps,
  useI18n,
  useMediaImage
} from '@hermes/plugin-sdk'
import {
  type HTMLAttributes,
  type JSX,
  type KeyboardEvent,
  memo,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { ExpandableShot, LiveFrame } from './tool-card-live'
import { isPublicHost, type ToolCardGroup, toolCardsFromParts, type ToolCardView } from './tool-card-model'
import { PreviewSessionContext } from './tool-card-session'

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
    <span className="h-10 w-16 shrink-0 overflow-hidden hbp-tc-rc border border-line hbp-tc-sunken">
      {image.src ? (
        <img
          alt=""
          aria-hidden
          className="hbp-tc-top h-full w-full object-cover"
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
  const session = useContext(PreviewSessionContext)

  const open = (event: MouseEvent) => {
    event.stopPropagation()
    openPreview(
      { kind: 'url', label: hostPathLabel(url), source: url, url },
      session.storedId ?? undefined,
      session.runtimeId
    )
  }

  return (
    <Tip label={url}>
      <Button
        aria-label={label}
        className={cn(iconOnly ? 'shrink-0 hbp-tc-subtle hbp-tc-hover-fg' : 'h-6 gap-1 px-1.5 text-ui-xs', className)}
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
      {showStatus ? <div className="truncate text-ui-xs hbp-tc-muted">{card.status}</div> : null}
      {pageUrl || shot ? (
        <div className="flex min-w-0 items-center gap-2" data-card-page="">
          {shot ? (
            <ScreenshotThumb src={shot} />
          ) : (
            <span className="inline-grid size-4 shrink-0 place-items-center hbp-tc-subtle">
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
          <div className="text-ui-2xs hbp-tc-subtle">{copy.details.request}</div>
          {card.args.map(detail => (
            <div className="flex min-w-0 gap-2" key={detail.label}>
              <span className="w-16 shrink-0 hbp-tc-subtle">{detail.label}</span>
              <span className="min-w-0 flex-1 break-words font-mono text-ui-2xs text-fg-secondary line-clamp-3">
                {detail.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="text-ui-2xs hbp-tc-subtle">{copy.details.output}</div>
      {card.output ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap hbp-tc-rc hbp-tc-sunken p-2 font-mono text-ui-2xs text-fg-secondary">
          {card.output}
        </pre>
      ) : (
        <div className="text-ui-2xs hbp-tc-subtle">{copy.details.noOutput}</div>
      )}
      {card.reason ? <div className="text-ui-xs text-danger">{card.reason}</div> : null}
      {card.durationLabel ? (
        <div className="text-ui-2xs hbp-tc-subtle">
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
      <div className="mt-1 aspect-video w-full max-w-md overflow-hidden rounded-card border border-line hbp-tc-sunken">
        {shot ? (
          <ExpandableShot host={host} src={shot} step={selected + 1} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 text-ui-xs hbp-tc-subtle">
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
        <span className="min-w-0 flex-1 text-center text-ui-xs hbp-tc-muted tabular-nums">
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
                  'flex w-full items-center gap-2 hbp-tc-rr px-2 py-1 text-left text-ui-xs hbp-tc-muted hbp-tc-hover',
                  index === selected && 'hbp-tc-selected'
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
    <div className="hbp-tc-collapse" data-open={open}>
      <div>
        <div className={cn('flex min-w-0 flex-col gap-2 pt-1 pr-1 pb-1 text-ui-xs', live ? 'hbp-tc-pl12' : 'pl-6')}>
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
    <span aria-hidden="true" className="hbp-tc-typing inline-flex shrink-0 items-center gap-0.5" data-typing="">
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
        <span className="hbp-tc-shimmer min-w-0 truncate hbp-tc-muted">{status}</span>
        <TypingDots />
      </>
    )
  }

  if (group.state === 'approval') {
    return <span className="min-w-0 truncate text-warning">{copy.awaitingApproval}</span>
  }

  return <span className="min-w-0 truncate hbp-tc-muted">{status}</span>
}

function LiveCardBody({ actor, copy, group, onReviewApproval, toggle }: CardBodyProps) {
  const last = group.cards[group.cards.length - 1]
  const site = group.thumb?.kind === 'site' ? group.thumb : null
  const shot = group.thumb?.kind === 'screenshot' ? group.thumb.src : null
  const pageUrl = stepPageUrl(group.cards)

  return (
    <>
      <span {...toggle} className="focus-ring flex min-w-0 flex-1 items-center gap-3 hbp-tc-rc">
      <span
        className={cn(
          'relative grid size-9 shrink-0 place-items-center hbp-tc-rc hbp-tc-sunken text-fg-secondary',
          group.state === 'running' && 'hbp-tc-ring hbp-tc-info',
          group.state === 'error' && 'hbp-bg-danger-10 text-danger',
          group.state === 'approval' && 'hbp-bg-warn-10 text-warning'
        )}
      >
        <ToolIcon className={group.state === 'running' ? 'text-fg-secondary' : undefined} name={group.icon} size={18} />
        {actor ? (
          <span className="absolute -right-1 -bottom-1 block overflow-hidden rounded-full hbp-tc-face">
            {actor}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui-sm font-semibold text-fg">
          {group.name}
          {group.cards.length > 1 ? (
            <span className="font-normal hbp-tc-subtle tabular-nums"> · {group.cards.length}</span>
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
      {shot && group.family !== 'browser' ? <ScreenshotThumb src={shot} /> : null}
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
      <span {...toggle} className="focus-ring flex min-w-0 flex-1 items-center gap-2 hbp-tc-rr">
        <ToolIcon className="shrink-0 hbp-tc-subtle" name={group.icon} size={14} />
        <Codicon className="shrink-0 hbp-fg-ok" name="check" size={12} />
        <span className="min-w-0 flex-1 truncate">{header}</span>
        {site ? <SiteFavicon host={site.host} url={site.url} /> : null}
        {last.durationLabel ? (
          <span className="shrink-0 text-ui-2xs hbp-tc-subtle tabular-nums">{last.durationLabel}</span>
        ) : null}
      </span>
      {pageUrl ? (
        <OpenPageButton
          className="hbp-tc-reveal"
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
  const frameOpen = group.family === 'browser' && live && !open
  const [frameMounted, setFrameMounted] = useState(frameOpen)

  // Keep the frame mounted while it folds shut, then drop its images.
  useEffect(() => {
    if (frameOpen) {
      setFrameMounted(true)

      return
    }

    const timer = window.setTimeout(() => setFrameMounted(false), 240)

    return () => window.clearTimeout(timer)
  }, [frameOpen])

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
          'hbp-tc-surface w-full max-w-md',
          mountedLive && 'hbp-tc-arrive',
          live
            ? 'flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface-raised px-3 py-2.5 text-left'
            : 'hbp-tc-row flex min-h-7 items-center gap-2 hbp-tc-rr border border-transparent px-1.5 text-left text-ui-xs hbp-tc-muted hbp-tc-hover'
        )}
        onClick={toggleOnClick(toggle)}
      >
        {live ? (
          <LiveCardBody actor={actor} copy={copy} group={group} onReviewApproval={onReviewApproval} toggle={toggleProps} />
        ) : (
          <QuietCardBody copy={copy} group={group} toggle={toggleProps} />
        )}
      </div>
      {frameMounted ? <LiveFrame group={group} open={frameOpen} /> : null}
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

/** Bot Chat tool activity cards: the plugin's renderer for a transcript tool
 *  run (`transcript.toolRun`). Core hands over the run's plain tool calls and
 *  hides its own rows for them; the cards cache by signature so a streaming
 *  run keeps the same group objects (and DOM) until something visible moves. */
export function ToolRunCards({
  approvalCallId,
  onReviewApproval,
  parts,
  sessionId,
  storedSessionId
}: ToolRunRendererProps): JSX.Element {
  const freshGroups = useMemo(() => toolCardsFromParts(parts, { approvalCallId }), [parts, approvalCallId])
  const cacheRef = useRef<{ groups: ToolCardGroup[]; signature: string }>({ groups: [], signature: '' })
  const signature = useMemo(() => groupsSignature(freshGroups), [freshGroups])

  if (cacheRef.current.signature !== signature || cacheRef.current.groups.length !== freshGroups.length) {
    cacheRef.current = { groups: freshGroups, signature }
  }

  const session = useMemo(() => ({ runtimeId: sessionId, storedId: storedSessionId }), [sessionId, storedSessionId])

  return (
    <PreviewSessionContext.Provider value={session}>
      <ToolActivityStack groups={cacheRef.current.groups} onReviewApproval={onReviewApproval} />
    </PreviewSessionContext.Provider>
  )
}
