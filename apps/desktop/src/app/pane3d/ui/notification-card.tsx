import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { getAvatar } from '../avatars/registry'
import { PANE_COPY } from '../copy'
import {
  activateNotificationAction,
  dismissNotification,
  hoverNotification,
  unhoverNotification
} from '../director/director'
import { relativeTime } from '../director/feed'
import { isHarnessRequest } from '../director/notify'
import { $cards, type PaneCard } from '../director/store'
import { avatarFrames } from '../scene/projection'

import { CARD_GAP, cardLayout, stackCards } from './card-layout'
import { DevBadge } from './dev-badge'

/** Fixed width keeps the placement math stable; the height is measured live. */
const CARD_WIDTH = 264
const FALLBACK_HEIGHT = 150
/** The collapse-into-the-feed fade (§8.5). */
const EXIT_MS = 200

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

  // A settled card is kept mounted for one short fade so it visibly collapses
  // into the feed rather than blinking out (§8.5). `previous` is a
  // previous-render snapshot, not a mirror of a live atom value read by a
  // callback, so it is exempt from the atom-mirrored-ref rule.
  // eslint-disable-next-line no-restricted-syntax -- previous-render snapshot, not a reactive mirror
  useEffect(() => {
    const removed = Object.values(previous.current).filter(card => !cards[card.id])

    previous.current = cards

    if (removed.length === 0) {
      return undefined
    }

    const ids = new Set(removed.map(card => card.id))

    setLeaving(list => [...list, ...removed])

    const timer = setTimeout(() => setLeaving(list => list.filter(card => !ids.has(card.id))), EXIT_MS)

    return () => clearTimeout(timer)
  }, [cards])

  // One loop positions every mounted card. Reading the live DOM (rather than a
  // ref map) means an unmounting card needs no cleanup here, and the collision
  // pass sees exactly the cards that are on screen.
  useEffect(() => {
    let frame = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)

      const viewport = { height: window.innerHeight, width: window.innerWidth }
      const nodes = [...document.querySelectorAll<HTMLDivElement>('[data-notify-id]')]

      const measured: { element: HTMLDivElement; id: string; layout: ReturnType<typeof cardLayout>; height: number }[] =
        []

      nodes.forEach(element => {
        const avatarId = element.getAttribute('data-avatar-id')
        const rect = avatarId ? avatarFrames[avatarId as keyof typeof avatarFrames]?.screenRect : null

        if (!rect) {
          return
        }

        const height = element.offsetHeight || FALLBACK_HEIGHT

        measured.push({
          element,
          height,
          id: element.getAttribute('data-notify-id') ?? '',
          layout: cardLayout(rect, { height, width: CARD_WIDTH }, viewport)
        })
      })

      // One pass resolves collisions across every open card, so two cards can
      // never cover each other (VAL-NOTIFY-005) while each stays beside its own
      // avatar (VAL-NOTIFY-007).
      const positions = stackCards(
        measured.map(item => ({ height: item.height, width: CARD_WIDTH, x: item.layout.left, y: item.layout.top })),
        viewport,
        CARD_GAP
      )

      measured.forEach((item, index) => {
        item.element.style.left = `${item.layout.left}px`
        item.element.style.top = `${positions[index].y}px`
        item.element.style.transformOrigin = `${item.layout.originX} center`
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

  return (
    <div
      className="pointer-events-auto absolute w-[264px] rounded-xl border border-(--stroke-nous) bg-card p-3 text-foreground shadow-nous transition-[opacity,transform] duration-[220ms] ease-out"
      data-avatar-id={card.avatar}
      data-notify-id={card.id}
      data-pane-card="notify"
      data-pane-hit={leaving ? undefined : ''}
      onPointerEnter={() => hoverNotification(card.id)}
      onPointerLeave={() => unhoverNotification(card.id)}
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'scale(1)' : 'scale(0.96)' }}
    >
      <div className="flex items-center gap-2">
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
          className="-mt-1 -mr-1 text-(--ui-text-tertiary)"
          data-pane-hit
          onClick={() => dismissNotification(card.id)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          ×
        </Button>
      </div>

      <h3 className="mt-2 text-[15px] leading-[1.3] font-semibold text-(--ui-text-primary)">{card.request.title}</h3>
      <p
        className={cn('mt-1.5 text-[14px] leading-[1.5] text-(--ui-text-secondary)', !expanded && 'line-clamp-3')}
        ref={body}
      >
        {card.request.body}
      </p>
      {bodyOverflows || expanded ? (
        <div className="mt-1">
          <button
            className="cursor-pointer text-[12px] font-medium text-(--ui-text-tertiary) hover:text-(--ui-text-primary)"
            data-pane-hit
            onClick={() => setExpanded(value => !value)}
            type="button"
          >
            {expanded ? PANE_COPY.less : PANE_COPY.more}
          </button>
        </div>
      ) : null}

      {action ? (
        <Button
          className="mt-2.5"
          data-pane-hit
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
