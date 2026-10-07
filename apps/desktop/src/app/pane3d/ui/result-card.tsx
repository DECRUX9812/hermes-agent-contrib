import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

import { getAvatar, listAvatars } from '../avatars/registry'
import { PANE_COPY } from '../copy'
import { $chartPresenter } from '../director/chart'
import { relativeTime } from '../director/feed'
import { $anchor, $avatars, $taskCards, type TaskCard } from '../director/store'
import { dismissTaskCard, presentTaskCardChart } from '../director/tasks'
import { avatarFrames } from '../scene/projection'

import { avatarObstacleBoxes } from './avatar-obstacles'
import { CARD_GAP, CARD_MARGIN, type CardBox } from './card-geometry'
import { type CardRequest, placeCards } from './card-layout'
import { DevBadge } from './dev-badge'

/** Fixed width keeps the placement math stable; the height is measured live. */
const CARD_WIDTH = 288
const FALLBACK_HEIGHT = 160

function domBoxes(selector: string): CardBox[] {
  return [...document.querySelectorAll<HTMLElement>(selector)].map(element => ({
    height: element.offsetHeight,
    width: element.offsetWidth,
    x: element.offsetLeft,
    y: element.offsetTop
  }))
}

/**
 * The settled task cards (architecture §8.7, §12): the executor's result, or its
 * error. One card per avatar, placed beside that avatar on the roomier side by
 * the same algorithm the notification cards use — so it follows the avatar when
 * the anchor moves (VAL-CROSS-002) and never covers a body, a pill or a
 * neighbour. The card carries the Dev-harness badge whenever the task came from
 * the harness, and its "Show chart" button exists only while a chart presenter
 * is registered.
 */
export function TaskCards() {
  const cards = useStore($taskCards)

  useEffect(() => {
    let frame = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)

      const nodes = [...document.querySelectorAll<HTMLElement>('[data-pane-card="result"],[data-pane-card="error"]')]

      if (nodes.length === 0) {
        return
      }

      const viewport = { height: window.innerHeight, width: window.innerWidth }

      const obstacles: CardBox[] = [
        ...avatarObstacleBoxes({
          anchor: $anchor.get(),
          avatars: $avatars.get(),
          frames: avatarFrames,
          silhouettes: listAvatars(),
          viewport
        }),
        ...domBoxes('[data-pane-card="notify"]:not([data-notify-leaving])'),
        ...domBoxes('[data-pane-task-pill]')
      ]

      const measured: { element: HTMLElement; request: CardRequest }[] = []

      nodes.forEach(element => {
        const id = element.getAttribute('data-avatar-id')
        const rect = id ? avatarFrames[id as keyof typeof avatarFrames]?.screenRect : null

        if (!rect) {
          return
        }

        measured.push({
          element,
          request: {
            avatar: rect,
            card: { height: element.offsetHeight || FALLBACK_HEIGHT, width: CARD_WIDTH },
            expanded: false
          }
        })
      })

      const placements = placeCards(
        measured.map(item => item.request),
        viewport,
        CARD_GAP,
        CARD_MARGIN,
        obstacles
      )

      measured.forEach((item, index) => {
        const placement = placements[index]

        item.element.style.left = `${Math.round(placement.left)}px`
        item.element.style.top = `${Math.round(placement.top)}px`
        item.element.style.transformOrigin = `${placement.originX} center`
        item.element.dataset.taskCardSide = placement.side
        // Position and visibility land in the same frame, so a fresh card never
        // flashes at (0,0) before its placement pass.
        item.element.style.opacity = '1'
      })
    }

    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <>
      {Object.values(cards).map(card => (
        <TaskCardView card={card} key={card.id} />
      ))}
    </>
  )
}

function TaskCardView({ card }: { card: TaskCard }) {
  const definition = getAvatar(card.avatar)
  const presenter = useStore($chartPresenter)

  const open = (url: string) => void window.hermesDesktop?.openExternal?.(url)

  return (
    <div
      className="pointer-events-auto absolute flex flex-col rounded-xl border border-(--stroke-nous) bg-card p-3 text-foreground opacity-0 shadow-nous transition-opacity duration-200 ease-out"
      data-avatar-id={card.avatar}
      data-pane-card={card.kind}
      data-pane-hit
      data-task-card-id={card.id}
      style={{ left: 0, top: 0, width: CARD_WIDTH }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: definition.palette.primary }}
        />
        <span className="truncate text-[12px] font-medium text-(--ui-text-secondary)">{definition.displayName}</span>
        {card.source === 'dev-harness' ? <DevBadge /> : null}
        <time
          className="ml-auto shrink-0 text-[11px] text-(--ui-text-tertiary)"
          dateTime={new Date(card.shownAt).toISOString()}
        >
          {relativeTime(card.shownAt)}
        </time>
        <Button
          aria-label={PANE_COPY.taskClose}
          className="-mt-1 -mr-1 shrink-0 text-(--ui-text-tertiary)"
          data-pane-hit
          onClick={() => dismissTaskCard(card.id)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          ×
        </Button>
      </div>

      <h3 className="mt-2 text-[15px] leading-[1.3] font-semibold text-(--ui-text-primary)">{card.title}</h3>
      <p className="mt-1.5 text-[14px] leading-[1.5] text-(--ui-text-secondary)" data-task-card-body>
        {card.body}
      </p>

      {card.links && card.links.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {card.links.map(link => (
            <button
              className="cursor-pointer rounded-full border border-(--stroke-nous) px-2 py-0.5 text-[12px] text-(--ui-text-secondary) outline-none hover:text-(--ui-text-primary)"
              data-pane-hit
              key={link.url}
              onClick={() => open(link.url)}
              type="button"
            >
              {link.label}
            </button>
          ))}
        </div>
      ) : null}

      {card.chart && presenter ? (
        <Button
          className="mt-2.5 self-start"
          data-pane-hit
          onClick={() => presentTaskCardChart(card.id)}
          size="sm"
          type="button"
          variant="secondary"
        >
          {PANE_COPY.showChart}
        </Button>
      ) : null}
    </div>
  )
}
