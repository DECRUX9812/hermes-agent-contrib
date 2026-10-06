import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { getAvatar, listAvatars } from '../avatars/registry'
import { PANE_COPY } from '../copy'
import {
  activateNotificationAction,
  dismissNotification,
  hoverNotification,
  unhoverNotification
} from '../director/director'
import { relativeTime } from '../director/feed'
import { isHarnessRequest } from '../director/notify'
import { $anchor, $avatars, $cards, type PaneCard } from '../director/store'
import { avatarFrames } from '../scene/projection'

import { avatarObstacleBoxes } from './avatar-obstacles'
import { CARD_GAP, CARD_MARGIN, expandedCardMaxHeight } from './card-geometry'
import { type CardRequest, placeCards } from './card-layout'
import { DevBadge } from './dev-badge'
import { useViewport } from './use-viewport'

/** Fixed width keeps the placement math stable; the height is measured live. */
const CARD_WIDTH = 264
const FALLBACK_HEIGHT = 150
/** The collapse-into-the-feed fade (§8.5). */
const EXIT_MS = 200

/**
 * The height the card would take if its body were not capped: the measured box
 * plus the part of the body currently scrolled out of view. The layout uses it
 * to pick a band tall enough to show the whole card (§8.5).
 */
function naturalCardHeight(element: HTMLDivElement, measured: number): number {
  const body = element.querySelector<HTMLElement>('[data-notify-body]')

  if (!body) {
    return measured
  }

  return Math.max(measured, measured - body.clientHeight + body.scrollHeight)
}

/**
 * The DOM layer's notification cards (architecture §8.5). One card per open
 * `$cards` entry, positioned every frame from its avatar's projected rect so it
 * follows the avatar when the anchor moves. A single loop positions all cards
 * and resolves collisions, so several open cards read as a tidy column instead
 * of covering each other.
 */
export function NotificationCards() {
  const cards = useStore($cards)
  const [entered, setEntered] = useState<ReadonlySet<string>>(() => new Set())
  const [leaving, setLeaving] = useState<PaneCard[]>([])
  const previous = useRef<Record<string, PaneCard>>({})
  // One exit timer per card. A single shared timer was cancelled by the next
  // settlement, leaving an invisible card mounted forever — along with its
  // descendant hit regions and its contribution to the layout obstacles. Each
  // exiting card therefore owns its own cleanup.
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // A settled card is kept mounted for one short fade so it visibly collapses
  // into the feed rather than blinking out (§8.5). `previous` is a
  // previous-render snapshot, not a mirror of a live atom value read by a
  // callback, so it is exempt from the atom-mirrored-ref rule.
  // eslint-disable-next-line no-restricted-syntax -- previous-render snapshot, not a reactive mirror
  useEffect(() => {
    const removed = Object.values(previous.current).filter(card => !cards[card.id])

    previous.current = cards

    if (removed.length === 0) {
      return
    }

    setLeaving(list => {
      const known = new Set(list.map(card => card.id))
      const added = removed.filter(card => !known.has(card.id))

      return added.length === 0 ? list : [...list, ...added]
    })

    removed.forEach(card => {
      if (exitTimers.current.has(card.id)) {
        return
      }

      exitTimers.current.set(
        card.id,
        setTimeout(() => {
          exitTimers.current.delete(card.id)
          setLeaving(list => list.filter(entry => entry.id !== card.id))
        }, EXIT_MS)
      )
    })
  }, [cards])

  // Exits deliberately outlive a single `cards` change, so they are cleared on
  // unmount only — never by the effect above (that cancellation was the bug).
  useEffect(() => {
    const timers = exitTimers.current

    return () => {
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [])

  // One loop positions every mounted card. Reading the live DOM (rather than a
  // ref map) means an unmounting card needs no cleanup here, and the collision
  // pass sees exactly the cards that are on screen.
  useEffect(() => {
    let frame = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)

      const viewport = { height: window.innerHeight, width: window.innerWidth }
      // A leaving card is excluded the moment it starts its exit: it must not
      // position, and it must not act as an obstacle pushing the live cards
      // around while it fades out.
      const nodes = [...document.querySelectorAll<HTMLDivElement>('[data-notify-id]:not([data-notify-leaving])')]
      const avatars = $avatars.get()

      // Every visible avatar's reserved rect: a card must never cover a body,
      // not just another card, and an emerging avatar's final perch counts from
      // the frame it becomes visible — before its rig climbs into it
      // (VAL-NOTIFY-005/007).
      const avatarObstacles = avatarObstacleBoxes({
        anchor: $anchor.get(),
        avatars,
        frames: avatarFrames,
        silhouettes: listAvatars(),
        viewport
      })

      const measured: { element: HTMLDivElement; id: string; request: CardRequest }[] = []

      nodes.forEach(element => {
        const avatarId = element.getAttribute('data-avatar-id')
        const rect = avatarId ? avatarFrames[avatarId as keyof typeof avatarFrames]?.screenRect : null

        if (!rect) {
          return
        }

        const expanded = element.hasAttribute('data-notify-expanded')
        const measuredHeight = element.offsetHeight || FALLBACK_HEIGHT
        // An expanded card's natural height is what its body wants, so the layout
        // can pick a band tall enough to show it without scrolling.
        const height = expanded ? naturalCardHeight(element, measuredHeight) : measuredHeight

        measured.push({
          element,
          id: element.getAttribute('data-notify-id') ?? '',
          request: { avatar: rect, card: { height, width: CARD_WIDTH }, expanded }
        })
      })

      // ONE placement pass positions every open card: each is fitted against the
      // avatars AND every card already placed this frame, on both sides, so a
      // card whose preferred side is taken moves to the opposite side's clear
      // band instead of overlapping (VAL-NOTIFY-005/007). The DOM takes left, top
      // and cap straight from the result — no second vertical-only refit.
      const placements = placeCards(
        measured.map(item => item.request),
        viewport,
        CARD_GAP,
        CARD_MARGIN,
        avatarObstacles
      )

      measured.forEach((item, index) => {
        const placement = placements[index]

        item.element.style.left = `${placement.left}px`
        item.element.style.top = `${placement.top}px`
        item.element.style.transformOrigin = `${placement.originX} center`
        // The loop owns the expanded cap: the band the card fits today decides
        // how much of the body is visible, so it scrolls rather than growing the
        // card over a neighbour (VAL-NOTIFY-007). Collapsed cards have no cap.
        item.element.style.maxHeight = placement.maxHeight === undefined ? '' : `${placement.maxHeight}px`
      })

      if (measured.length > 0) {
        setEntered(current => {
          const missing = measured.filter(item => !current.has(item.id))

          if (missing.length === 0) {
            return current
          }

          const next = new Set(current)

          missing.forEach(item => next.add(item.id))

          return next
        })
      }
    }

    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [])

  const open = Object.values(cards)

  return (
    <>
      {[...open, ...leaving].map(card => (
        <NotificationCard card={card} entered={entered.has(card.id)} key={card.id} leaving={!cards[card.id]} />
      ))}
    </>
  )
}

interface NotificationCardProps {
  card: PaneCard
  entered: boolean
  leaving: boolean
}

function NotificationCard({ card, entered, leaving }: NotificationCardProps) {
  const definition = getAvatar(card.avatar)
  const body = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [bodyOverflows, setBodyOverflows] = useState(false)

  useEffect(() => {
    const node = body.current

    if (node) {
      setBodyOverflows(!expanded && node.scrollHeight > node.clientHeight + 1)
    }
  }, [card.request.body, expanded])

  const action = card.request.action
  const harness = isHarnessRequest(card.request)
  const visible = entered && !leaving
  const viewport = useViewport()
  // A leaving card must stop being a hit target at once — on the card AND every
  // descendant, since `data-pane-hit` is what the publisher turns into a region.
  const hit = leaving ? undefined : ''

  return (
    <div
      className={cn(
        'pointer-events-auto absolute w-[264px] rounded-xl border border-(--stroke-nous) bg-card p-3 text-foreground shadow-nous transition-[opacity,transform] duration-[220ms] ease-out',
        // A flex column lets the expanded body shrink and scroll instead of
        // growing the card past the pane.
        expanded && 'flex flex-col',
        leaving && 'pointer-events-none'
      )}
      data-avatar-id={card.avatar}
      data-notify-expanded={expanded ? '' : undefined}
      data-notify-id={card.id}
      data-notify-leaving={leaving ? '' : undefined}
      data-pane-card="notify"
      data-pane-hit={hit}
      onPointerEnter={() => hoverNotification(card.id)}
      onPointerLeave={() => unhoverNotification(card.id)}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'scale(1)' : 'scale(0.96)',
        // Caps the card inside the pane; the body below is the scroll container,
        // so the title, action and close × always stay visible (§8.5).
        ...(expanded ? { maxHeight: expandedCardMaxHeight(viewport.height) } : {})
      }}
    >
      <div className="flex shrink-0 items-center gap-2">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: definition.palette.primary }}
        />
        <span className="truncate text-[12px] font-medium text-(--ui-text-secondary)">{definition.displayName}</span>
        {harness ? <DevBadge /> : null}
        <time
          className="ml-auto shrink-0 text-[11px] text-(--ui-text-tertiary)"
          dateTime={new Date(card.shownAt).toISOString()}
        >
          {relativeTime(card.shownAt)}
        </time>
        <Button
          aria-label={PANE_COPY.dismissNotification}
          className="-mt-1 -mr-1 shrink-0 text-(--ui-text-tertiary)"
          data-pane-hit={hit}
          onClick={() => dismissNotification(card.id)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          ×
        </Button>
      </div>

      <h3 className="mt-2 shrink-0 text-[15px] leading-[1.3] font-semibold text-(--ui-text-primary)">
        {card.request.title}
      </h3>
      <p
        className={cn(
          'mt-1.5 text-[14px] leading-[1.5] text-(--ui-text-secondary)',
          expanded ? 'min-h-0 overflow-y-auto' : 'line-clamp-3'
        )}
        data-notify-body=""
        ref={body}
      >
        {card.request.body}
      </p>
      {bodyOverflows || expanded ? (
        <div className="mt-1 shrink-0">
          <button
            className="cursor-pointer text-[12px] font-medium text-(--ui-text-tertiary) hover:text-(--ui-text-primary)"
            data-pane-hit={hit}
            onClick={() => setExpanded(value => !value)}
            type="button"
          >
            {expanded ? PANE_COPY.less : PANE_COPY.more}
          </button>
        </div>
      ) : null}

      {action ? (
        <Button
          className="mt-2.5 shrink-0"
          data-pane-hit={hit}
          onClick={() => activateNotificationAction(card.id, action.id)}
          size="sm"
          type="button"
          variant="secondary"
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
