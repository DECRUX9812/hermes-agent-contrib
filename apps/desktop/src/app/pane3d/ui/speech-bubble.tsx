import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { getAvatar, listAvatars } from '../avatars/registry'
import { $anchor, $avatars, $bubbles, type SpeechBubble } from '../director/store'
import type { AvatarId, ScreenRect } from '../protocol'
import { avatarFrames } from '../scene/projection'

import { avatarObstacleBoxes } from './avatar-obstacles'
import { CARD_GAP, CARD_MARGIN, type CardBox } from './card-geometry'
import { type BubbleLayout, bubbleLayout } from './card-layout'
import { DevBadge } from './dev-badge'

/** A speech bubble is 13px and never wider than this (architecture §8.6). */
export const BUBBLE_MAX_WIDTH = 220

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * The AvatarRoom's DOM layer (architecture §8.6): one bubble over the current
 * speaker, tail toward them, repositioned every frame from the speaker's
 * projected rect so it follows an anchor move and never covers another avatar's
 * body. The loop only runs while a bubble is up.
 */
export function SpeechBubbles() {
  const bubbles = useStore($bubbles)

  useEffect(() => {
    if (bubbles.length === 0) {
      return undefined
    }

    let frame = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)

      const viewport = { height: window.innerHeight, width: window.innerWidth }
      const avatars = $avatars.get()

      document.querySelectorAll<HTMLDivElement>('[data-pane-bubble]').forEach(element => {
        const id = element.getAttribute('data-avatar-id')
        const rect = id ? avatarFrames[id as keyof typeof avatarFrames]?.screenRect : null

        if (!rect) {
          element.style.visibility = 'hidden'

          return
        }

        const avatarObstacles: CardBox[] = avatarObstacleBoxes({
          anchor: $anchor.get(),
          avatars,
          exclude: id as AvatarId,
          frames: avatarFrames,
          silhouettes: listAvatars(),
          viewport
        })

        // Placed notification cards are obstacles too: a bubble must not cover a
        // card that is already open (§8.6).
        const cardObstacles: CardBox[] = [
          ...document.querySelectorAll<HTMLElement>('[data-pane-card="notify"]:not([data-notify-leaving])')
        ].map(card => ({
          height: card.offsetHeight,
          width: card.offsetWidth,
          x: card.offsetLeft,
          y: card.offsetTop
        }))

        const obstacles: CardBox[] = [...avatarObstacles, ...cardObstacles]

        const size = {
          height: element.offsetHeight || 52,
          width: Math.min(BUBBLE_MAX_WIDTH, element.offsetWidth || BUBBLE_MAX_WIDTH)
        }

        const layout = bubbleLayout(rect, size, viewport, CARD_GAP, CARD_MARGIN, obstacles)

        element.style.visibility = 'visible'
        element.style.left = `${Math.round(layout.left)}px`
        element.style.top = `${Math.round(layout.top)}px`
        element.dataset.bubblePlacement = layout.placement

        const tail = element.querySelector<HTMLElement>('[data-bubble-tail]')

        if (tail) {
          applyTail(tail, layout, rect)
        }
      })
    }

    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [bubbles.length])

  return (
    <>
      {bubbles.map(bubble => (
        <SpeechBubbleView bubble={bubble} key={bubble.id} />
      ))}
    </>
  )
}

/** Point the tail at the speaker: down for an above bubble, sideways otherwise. */
function applyTail(tail: HTMLElement, layout: BubbleLayout, speaker: ScreenRect): void {
  const speakerCenterX = speaker.x + speaker.width / 2
  const card = 'var(--color-card)'
  const clear = 'transparent'

  tail.style.left = ''
  tail.style.right = ''
  tail.style.top = ''
  tail.style.bottom = ''
  tail.style.borderWidth = ''
  tail.style.borderColor = ''

  if (layout.placement === 'above') {
    tail.style.bottom = '-6px'
    tail.style.left = `${clamp(speakerCenterX - layout.left - 6, 10, Math.max(10, BUBBLE_MAX_WIDTH - 22))}px`
    tail.style.borderLeft = `6px solid ${clear}`
    tail.style.borderRight = `6px solid ${clear}`
    tail.style.borderTop = `7px solid ${card}`

    return
  }

  tail.style.top = '50%'

  if (layout.placement === 'right') {
    tail.style.left = '-6px'
    tail.style.borderTop = `6px solid ${clear}`
    tail.style.borderBottom = `6px solid ${clear}`
    tail.style.borderRight = `7px solid ${card}`
  } else {
    tail.style.right = '-6px'
    tail.style.borderTop = `6px solid ${clear}`
    tail.style.borderBottom = `6px solid ${clear}`
    tail.style.borderLeft = `7px solid ${card}`
  }
}

function SpeechBubbleView({ bubble }: { bubble: SpeechBubble }) {
  const definition = getAvatar(bubble.avatar)

  return (
    <div
      className="pointer-events-auto absolute rounded-xl border border-(--stroke-nous) bg-card px-3 py-2 text-foreground shadow-nous"
      data-avatar-id={bubble.avatar}
      data-bubble-id={bubble.id}
      data-pane-bubble
      data-pane-hit
      style={{ left: 0, maxWidth: BUBBLE_MAX_WIDTH, top: 0, visibility: 'hidden', width: 'max-content' }}
    >
      <div className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: definition.palette.primary }} />
        <span className="text-[11px] leading-4 font-medium text-(--ui-text-secondary)">{definition.displayName}</span>
        {bubble.source === 'dev-harness' ? <DevBadge /> : null}
      </div>
      <p className="mt-1 text-[13px] leading-[1.35] text-(--ui-text-primary)">{bubble.text}</p>
      <span aria-hidden className="pointer-events-none absolute size-0" data-bubble-tail style={{ borderWidth: 0 }} />
    </div>
  )
}
