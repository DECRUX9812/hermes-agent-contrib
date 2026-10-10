/**
 * THE TIP BUBBLE — a pointer, not an overlay.
 *
 * The app's popover, in the calm glass surface: same box, same arrow, same
 * placement engine. Nothing here re-implements the surface — a tip that
 * drifted from the popover's shape would read as a different app talking, and
 * a tip loud enough to compete with the control it points at would break the
 * calm bar (#2: muted color for background information, one accent for
 * actions).
 *
 * What it does own is behaviour, and the audible half of a coachmark is that
 * it must not resist the gestures users already know: it never takes focus,
 * it blocks nothing (the click that dismisses it still lands where it was
 * aimed), and it dismisses like any popover — Esc, a click or focus anywhere
 * else, the ✕, or the rotation timer. Esc is the one with a caveat: a tip is
 * the topmost dismissable surface while it is up (DESIGN.md — one cancel
 * gesture does one thing), so Radix closes the tip and prevents the keydown,
 * and the composer's Esc gate reads defaultPrevented and stands down. The
 * cancellation goes to the tip, never through it.
 */

import { useEffect, useRef } from 'react'

import { KbdCombo } from '@/components/ui/kbd'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { iconSize, X } from '@/lib/icons'
import { useKeybindHint } from '@/lib/keybinds/use-keybind-hint'
import type { TipSide } from '@/lib/tips/catalog'
import type { ActiveTip } from '@/store/tips'

export interface TipBubbleProps {
  /** A call to action rendered as the bubble's one button. See ActiveTip. */
  action?: ActiveTip['action']
  /** The element the arrow points at. */
  anchor: HTMLElement
  /** Keybind action id; its live combo prints under the text. */
  keybind?: string
  /** Hard close — this tip never comes back. */
  onClose: () => void
  side: TipSide
  text: string
  title?: string
}

export function TipBubble({ action, anchor, keybind, onClose, side, text, title }: TipBubbleProps) {
  const { t } = useI18n()
  const combo = useKeybindHint(keybind ?? '')
  const anchorRef = useRef<HTMLElement | null>(anchor)

  // Radix reads `virtualRef.current` on every render of the anchor, so keeping
  // the ref current is what lets a tip follow an element that got re-created
  // (a re-render swaps the node, not the selector).
  anchorRef.current = anchor

  // Nothing in here is a focus trap, but a tip arriving under an open native
  // menu would still float above it. Scroll it into agreement instead of
  // guessing: the popover re-measures whenever its anchor moves.
  useEffect(() => {
    anchor.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [anchor])

  return (
    // The dismissal routes (Esc, outside click/focus) close the layer through
    // Radix's own path — onOpenChange(false) — which is also where the
    // keydown gets its preventDefault, so the composer stands down on the
    // same gesture (see the header note).
    <Popover
      onOpenChange={next => {
        if (!next) {
          onClose()
        }
      }}
      open
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        aria-live="polite"
        className="p-2.5"
        collisionPadding={12}
        data-slot="tip-bubble"
        // Ambient chrome: no caret steal in either direction — opening must
        // not move focus into the bubble, closing must not pull it anywhere.
        onCloseAutoFocus={event => event.preventDefault()}
        onOpenAutoFocus={event => event.preventDefault()}
        role="status"
        side={side}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {title && <p className="text-[length:var(--conversation-caption-font-size)] font-semibold">{title}</p>}
            {/* Held off full strength so the title still leads. Everything here
                is currentColor-relative, so it follows the surface's foreground
                rather than pinning a grey that only works on one fill. */}
            <p className="mt-0.5 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-current/85">
              {text}
            </p>
            {combo && <KbdCombo className="mt-2" combo={combo} size="sm" />}
            {action && (
              // The CTA: still not a focus trap — the button is tabbable when
              // reached but nothing steals the caret to get there. A quiet
              // currentColor fill, same discipline as the rest of the bubble.
              <button
                className="mt-2.5 inline-flex cursor-pointer items-center rounded-md bg-current/15 px-2.5 py-1 text-[length:var(--conversation-caption-font-size)] font-semibold transition-colors hover:bg-current/25"
                onClick={action.onSelect}
                type="button"
              >
                {action.label}
              </button>
            )}
          </div>
          <button
            aria-label={t.tips.close}
            className="-mr-0.5 -mt-0.5 shrink-0 cursor-pointer rounded-[3px] p-0.5 text-current/70 transition-colors hover:bg-current/15 hover:text-current"
            onClick={onClose}
            type="button"
          >
            <X className={iconSize.sm} />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
