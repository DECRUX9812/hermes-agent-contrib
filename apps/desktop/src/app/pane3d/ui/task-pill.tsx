import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { getAvatar, listAvatars } from '../avatars/registry'
import { PANE_COPY } from '../copy'
import { $anchor, $avatars, $taskProgress, type TaskProgress } from '../director/store'
import type { AvatarId } from '../protocol'
import { avatarFrames } from '../scene/projection'

import { avatarObstacleBoxes } from './avatar-obstacles'
import { CARD_MARGIN, type CardBox } from './card-geometry'
import { DevBadge } from './dev-badge'
import { PILL_GAP, pillLayout } from './pill-layout'

/** Wide enough for a sentence, small enough to read as a working indicator. */
const PILL_WIDTH = 232
const FALLBACK_HEIGHT = 54

/** Every mounted node of a selector as a placement box. */
function domBoxes(selector: string): CardBox[] {
  return [...document.querySelectorAll<HTMLElement>(selector)].map(element => ({
    height: element.offsetHeight,
    width: element.offsetWidth,
    x: element.offsetLeft,
    y: element.offsetTop
  }))
}

/**
 * The working task pill (architecture §8.8). The composer collapses into this
 * compact pill under the avatar: a progress label and a thin bar while the
 * executor is `thinking`, then the last two lines of streamed text while it is
 * `responding`. It disappears when the task settles into its result card.
 *
 * One rAF loop positions every pill from its avatar's projected rect, so the
 * pill follows the anchor and never covers a reserved avatar box or a card.
 */
export function TaskPill() {
  const progress = useStore($taskProgress)
  const avatars = useStore($avatars)

  useEffect(() => {
    let frame = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)

      const nodes = [...document.querySelectorAll<HTMLElement>('[data-pane-task-pill]')]

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
        ...domBoxes('[data-pane-card="result"],[data-pane-card="error"]')
      ]

      nodes.forEach(node => {
        const id = node.getAttribute('data-avatar-id') as AvatarId | null
        const rect = id ? avatarFrames[id]?.screenRect : null

        if (!rect) {
          return
        }

        const layout = pillLayout(
          rect,
          { height: node.offsetHeight || FALLBACK_HEIGHT, width: PILL_WIDTH },
          viewport,
          PILL_GAP,
          CARD_MARGIN,
          obstacles
        )

        node.style.left = `${Math.round(layout.left)}px`
        node.style.top = `${Math.round(layout.top)}px`
        node.dataset.taskPillSide = layout.side
        // The loop owns visibility too: a fresh pill starts invisible and fades
        // in only once it has a real position, so it can never flash at (0,0).
        node.style.opacity = '1'
      })
    }

    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [])

  const entries = (Object.entries(progress) as [AvatarId, TaskProgress | undefined][]).filter(
    ([id, state]) => state !== undefined && avatars[id]?.visible
  )

  return (
    <>
      {entries.map(([id, state]) => (
        <TaskPillView avatar={id} key={id} progress={state as TaskProgress} />
      ))}
    </>
  )
}

function TaskPillView({ avatar, progress }: { avatar: AvatarId; progress: TaskProgress }) {
  const definition = getAvatar(avatar)
  const thinking = progress.phase === 'thinking'

  return (
    <div
      className="pointer-events-auto absolute flex flex-col gap-1.5 rounded-lg border border-(--stroke-nous) bg-card px-2.5 py-2 text-foreground opacity-0 shadow-nous transition-opacity duration-150 ease-out"
      data-avatar-id={avatar}
      data-pane-hit
      data-pane-task-pill
      data-task-phase={progress.phase}
      style={{ left: 0, top: 0, width: PILL_WIDTH }}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: definition.palette.primary }} />
        <span className="truncate text-[11px] font-medium text-(--ui-text-secondary)">{definition.displayName}</span>
        {progress.source === 'dev-harness' ? <DevBadge /> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="truncate text-[12px] text-(--ui-text-primary)" data-task-label>
          {progress.label ?? PANE_COPY.taskWorking}
        </span>
        <span aria-hidden className="h-[3px] w-full overflow-hidden rounded-full bg-(--ui-bg-quaternary)">
          <span
            className="block h-full rounded-full transition-[width] duration-300 ease-out"
            style={{
              background: definition.palette.accent,
              width: `${Math.round((progress.pct ?? 0.12) * 100)}%`
            }}
          />
        </span>
      </div>

      {thinking ? null : (
        // The last two lines stay visible: the text is bottom-anchored inside a
        // fixed two-line box, so new tokens push the older ones out of the top.
        <span className="relative block h-[2.6em] overflow-hidden" data-task-stream-box>
          <span
            className="absolute inset-x-0 bottom-0 block text-[12px] leading-[1.3] text-(--ui-text-primary)"
            data-task-stream
          >
            {progress.stream}
          </span>
        </span>
      )}
    </div>
  )
}
