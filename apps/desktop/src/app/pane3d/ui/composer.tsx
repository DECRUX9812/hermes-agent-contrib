import { useStore } from '@nanostores/react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import { getAvatar, listAvatars } from '../avatars/registry'
import { PANE_COPY } from '../copy'
import { closeComposer, removeContextField, submitComposer } from '../director/composer'
import { dispatch } from '../director/director'
import { $anchor, $avatars, $composer, type ComposerState } from '../director/store'
import { avatarFrames } from '../scene/projection'

import { avatarObstacleBoxes } from './avatar-obstacles'
import { CARD_GAP, CARD_MARGIN, type CardBox } from './card-geometry'
import { cardLayout } from './card-layout'
import { contextChips } from './composer-chips'
import { DevBadge } from './dev-badge'

/** Wide enough for a sentence, narrow enough to sit beside an avatar. */
const COMPOSER_WIDTH = 320
const FALLBACK_HEIGHT = 148

/**
 * The task composer (architecture §8.8). It mounts only while its avatar is
 * `listening`, docks beside that avatar (re-positioned every frame so it
 * follows the anchor), and owns the chips, the textarea and the submit/close
 * keys. Enter submits, Shift+Enter inserts a newline, Esc closes; closing is
 * what returns the pane to non-focusable (the hit-region publisher watches the
 * `listening` state).
 */
export function Composer() {
  const state = useStore($composer)
  const avatars = useStore($avatars)

  if (!state || avatars[state.avatar]?.state !== 'listening') {
    return null
  }

  return <ComposerView state={state} />
}

function ComposerView({ state }: { state: ComposerState }) {
  const definition = getAvatar(state.avatar)
  const box = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const typed = useRef(false)
  // The launch demo opens the composer pre-filled (§11); a plain click starts
  // empty. The draft is the initial value only — typing owns it from then on.
  const [text, setText] = useState(state.draft ?? '')
  const chips = contextChips(state.context, state.removed)

  // The pane becomes focusable a tick after COMPOSER_OPEN (main sets it, then
  // focuses the window), so focus once on mount and again when the window
  // really takes the keyboard. Without this the textarea is mounted but the
  // first keystrokes go nowhere.
  useEffect(() => {
    const focus = () => textarea.current?.focus()

    focus()

    const frame = requestAnimationFrame(focus)
    const timer = setTimeout(focus, 120)

    window.addEventListener('focus', focus)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      window.removeEventListener('focus', focus)
    }
  }, [])

  // One loop owns the position: beside the avatar on the roomier side, in the
  // clearest band, never over another avatar's body or an open card (§8.8).
  useEffect(() => {
    let frame = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)

      const element = box.current
      const rect = avatarFrames[state.avatar].screenRect

      if (!element || !rect) {
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
        ...Array.from(
          document.querySelectorAll<HTMLElement>('[data-pane-card="notify"]:not([data-notify-leaving])')
        ).map(card => ({ height: card.offsetHeight, width: card.offsetWidth, x: card.offsetLeft, y: card.offsetTop }))
      ]

      const size = { height: element.offsetHeight || FALLBACK_HEIGHT, width: COMPOSER_WIDTH }
      const layout = cardLayout(rect, size, viewport, CARD_GAP, CARD_MARGIN, obstacles)

      element.style.left = `${Math.round(layout.left)}px`
      element.style.top = `${Math.round(layout.top)}px`
      element.dataset.composerSide = layout.side
    }

    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [state.avatar])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeComposer(state.avatar)

      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitComposer(state.avatar, text)
    }
  }

  return (
    <div
      className="pointer-events-auto absolute rounded-xl border border-(--stroke-nous) bg-card p-3 text-foreground shadow-nous"
      data-avatar-id={state.avatar}
      data-pane-composer
      data-pane-hit
      ref={box}
      style={{ left: 0, top: 0, width: COMPOSER_WIDTH }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: definition.palette.primary }}
        />
        <span className="truncate text-[12px] font-medium text-(--ui-text-secondary)">{definition.displayName}</span>
        {state.source === 'dev-harness' ? <DevBadge /> : null}
        <Button
          aria-label={PANE_COPY.closeComposer}
          className="-mt-1 -mr-1 ml-auto shrink-0 text-(--ui-text-tertiary)"
          data-pane-hit
          onClick={() => closeComposer(state.avatar)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          ×
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1" data-composer-chips>
        {chips.map(chip => {
          const field = chip.field

          return (
            <span
              className="flex max-w-full items-center gap-1 rounded-full border border-(--stroke-nous) px-2 py-0.5 text-[11px] leading-4 text-(--ui-text-secondary)"
              data-context-chip={chip.kind}
              data-pane-hit
              key={chip.kind}
            >
              <span className="max-w-[190px] truncate">{chip.label}</span>
              {field ? (
                <button
                  aria-label={PANE_COPY.removeContext(chip.kind)}
                  className="cursor-pointer text-(--ui-text-tertiary) outline-none hover:text-(--ui-text-primary)"
                  data-pane-hit
                  onClick={() => removeContextField(field)}
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </span>
          )
        })}
      </div>

      <Textarea
        autoFocus
        className="mt-2 min-h-10 resize-none border-0 bg-transparent px-0 py-0 text-[13px] focus-visible:ring-0"
        data-pane-hit
        onChange={event => {
          setText(event.target.value)

          if (!typed.current) {
            typed.current = true
            dispatch(state.avatar, 'USER_INPUT')
          }
        }}
        onKeyDown={onKeyDown}
        placeholder={PANE_COPY.composerPlaceholder(definition.displayName)}
        ref={textarea}
        rows={2}
        value={text}
      />

      <p className="mt-1.5 text-[11px] leading-4 text-(--ui-text-tertiary)">{PANE_COPY.composerHint}</p>
    </div>
  )
}
