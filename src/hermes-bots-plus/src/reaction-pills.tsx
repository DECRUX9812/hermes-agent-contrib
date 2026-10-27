/**
 * Bot Chat reaction pills (bot-mode b1).
 *
 * Reactions themselves are stock: the hover slot in an assistant footer opens
 * the quick set (plus the full picker), a pick persists through the gateway's
 * `message.react` RPC, and with Settings › Appearance › Reactions on the agent
 * is told about it on its next turn (and may answer with one of its own).
 * Nothing here re-implements that — a second picker would double-write the
 * same row.
 *
 * What Bot Mode adds is presentation: inside a canonical Bot Chat a landed
 * reaction reads as a pill (tinted capsule, hairline ring, room between
 * several) instead of a bare glyph, so a bot's thread reads like a room you
 * share with it. The scope is a marker attribute on the chat pane, set by a
 * `composer.top` contribution that only renders in a canonical Bot Chat —
 * every other chat keeps the stock look.
 */

import { useSessionView, useValue } from '@hermes/plugin-sdk'
import { useLayoutEffect, useRef } from 'react'

import { canonicalBotChatOnScreen } from './bot-plan-card'
import { $lastRoster } from './data'

/** Attribute on the pane that hosts a canonical Bot Chat. */
export const BOT_CHAT_MARK = 'data-hbp-bot-chat'

const VIEWPORT = '[data-slot="aui_thread-viewport"]'

/** The nearest ancestor that also holds this chat's transcript viewport —
 *  the pane, whatever its tiling shape. */
export function chatPaneOf(el: Element | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node && node !== document.body; node = node.parentElement) {
    if (node.querySelector(VIEWPORT)) {
      return node
    }
  }

  return null
}

/** Marks its pane while the focused session is a canonical Bot Chat. Renders
 *  a zero-size hidden anchor so the composer slot keeps no visible footprint. */
export function BotChatMark() {
  const view = useSessionView()
  const storedId = useValue(view.$storedId) ?? null
  // Re-evaluate when the roster lands: a cold window renders before it.
  useValue($lastRoster)
  const on = canonicalBotChatOnScreen(storedId)
  const anchor = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (!on) {
      return
    }

    let pane: HTMLElement | null = null

    const mark = () => {
      pane = chatPaneOf(anchor.current)
      pane?.setAttribute(BOT_CHAT_MARK, '')

      return Boolean(pane)
    }

    // A cold open paints the composer before the transcript viewport mounts;
    // wait for it instead of giving up on the first pass.
    const watcher = mark() ? null : new MutationObserver(() => mark() && watcher?.disconnect())

    watcher?.observe(document.body, { childList: true, subtree: true })

    return () => {
      watcher?.disconnect()
      pane?.removeAttribute(BOT_CHAT_MARK)
    }
  }, [on, storedId])

  return on ? <span aria-hidden hidden ref={anchor} /> : null
}

const SCOPE = `[${BOT_CHAT_MARK}]`
const SLOT = `[data-slot='aui_msg-reactions']`

/** Pill styling for landed reactions, Bot Chat only. Tokens only; the
 *  selectors out-rank core's `button[data-slot='aui_msg-reactions']` reset. */
export function reactionPillStyleSheet(): string {
  return [
    `${SCOPE} button${SLOT}[data-reacted]{padding:0;border-radius:var(--radius-xl);}`,
    `${SCOPE} ${SLOT}[data-reacted]>span,${SCOPE} span${SLOT}{gap:0.25rem;}`,
    `${SCOPE} ${SLOT} .reaction-pop{display:inline-flex;align-items:center;justify-content:center;`,
    `min-width:1.75rem;height:1.375rem;padding:0 0.4375rem;border-radius:999px;`,
    `background:var(--ui-bg-quaternary);box-shadow:inset 0 0 0 1px var(--ui-stroke-tertiary);`,
    `transition:background-color 120ms cubic-bezier(0.2,0,0,1),box-shadow 120ms cubic-bezier(0.2,0,0,1);}`,
    `${SCOPE} button${SLOT}[data-reacted]:hover .reaction-pop,${SCOPE} button${SLOT} .reaction-pop:hover{`,
    `background:var(--ui-control-hover-background);box-shadow:inset 0 0 0 1px var(--ui-stroke-secondary);}`,
    `${SCOPE} button${SLOT}[data-state='open'] .reaction-pop{box-shadow:inset 0 0 0 1px var(--ui-accent);}`
  ].join('')
}

const STYLE_ID = 'hermes-bots-plus-reaction-pills'

export function mountReactionPillStyles(): () => void {
  if (typeof document === 'undefined') {
    return () => {}
  }

  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null

  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }

  el.textContent = reactionPillStyleSheet()

  return () => el?.remove()
}
