/**
 * What a bot's chat shows before it has said anything.
 *
 * Core's splash is Hermes' own wordmark and belongs to a fresh draft; a bot
 * chat is neither. It gets the same lettering with the bot's name in it, over
 * the same face the roster row and tab carry, so an empty conversation still
 * says whose it is.
 */

import { host, RowButton, useValue, Wordmark } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { chatStarters } from './bot-starters'
import { $botMeta, $lastRoster } from './data'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botRosterMeta, requestForBot } from './routing'
import type { RosterRow } from './types'

const FACE_SIZE = 96
const FACE_GAP = 16
/** What the face costs the stack in height — the offset that puts the name on
 *  the center line is derived from it, so the two can never drift apart. */
const FACE_BLOCK = FACE_SIZE + FACE_GAP

/** The bot whose canonical chat this session is, if it is one. Matches the
 *  durable registry id or the compression-lineage tip, the same pair the
 *  roster's click and preview identity resolve through. */
export function botForStoredId(roster: readonly RosterRow[], storedId: string): null | RosterRow {
  if (!storedId || !Array.isArray(roster)) {
    return null
  }

  return (
    roster.find(bot => {
      const canonical = bot?.canonical_session

      return String(canonical?.id ?? '') === storedId || String(canonical?.resolved_id ?? '') === storedId
    }) ?? null
  )
}

/** The stored id of the chat on screen. The transcript hands its slot the
 *  RUNTIME id, and a canonical Bot Chat is keyed by its stored one — the same
 *  two id spaces that misrouted Bot Mode's RPCs in #93080. The focus store is
 *  the translation the rest of the plugin already trusts. */
function focusedStoredId(): string {
  return String(host.state.focusedStoredSessionId?.get?.() ?? '')
}

export function botForChat(roster: readonly RosterRow[], sessionId: string): null | RosterRow {
  // Stored ids pass straight through, so a shell that hands us one still
  // resolves; otherwise the focused chat is the empty one being looked at.
  return botForStoredId(roster, sessionId) ?? botForStoredId(roster, focusedStoredId())
}

export function BotChatEmpty({ sessionId }: { sessionId: string }) {
  const b = useBots()
  // Subscribed, not read once: roster, metadata and focus all land after the
  // transcript mounts. This is also how the state appears at all — the slot
  // mounts for every empty session and only resolves to a bot once the roster
  // is in hand.
  const roster = useValue($lastRoster)
  const allMeta = useValue($botMeta)
  useValue(host.state.focusedStoredSessionId)
  // Hooks before the early return — a bot resolving late must not reorder them.
  const [sent, setSent] = useState(false)
  const bot = botForChat(roster, sessionId)

  if (!bot) {
    return null
  }

  // Route-keyed, exactly as the roster row resolves it: metadata is scoped to
  // the gateway it came from, so a plain by-name read misses the entry a
  // source-scoped bot's avatar actually lives under.
  const meta = botRosterMeta(bot, allMeta)
  const name = displayName(bot, meta)
  const { color, image, shape } = botAppearance(bot.name, meta)
  // Same rule the rows use: keep a real photo or pet, drop the SVG backfill so
  // the math face can animate.
  const photo = Boolean(image && !isBackfilledFacePng(image))

  /** A starter chip is a real user turn: it submits into the LIVE runtime
   *  session the transcript is showing (focused first — the prop can be the
   *  stored id on shells that hand us that). One click locks the row; the
   *  submitted message fills the transcript and unmounts this slot anyway.
   *  `busy` is read at click time — the component doesn't subscribe to it. */
  const submitStarter = (text: string) => {
    if (sent || host.state.busy?.get?.()) {
      return
    }

    const runtimeId = host.state.focusedSessionId?.get?.() || sessionId

    if (!runtimeId) {
      return
    }

    setSent(true)
    void requestForBot(bot, 'prompt.submit', {
      session_id: runtimeId,
      text
    }).catch(err => {
      setSent(false)
      host.notifyError(err, 'Could not send that message')
    })
  }

  const starters = chatStarters(meta)

  return (
    <div
      className="pointer-events-none flex w-full min-w-0 flex-col items-center justify-center px-0.5 py-6 text-center text-muted-foreground sm:px-6 lg:px-8"
      data-slot="bot_chat_empty"
      // The name reads as the title of the chat, so it — not the stack as a
      // whole — is what should sit on the optical center line. Lifting the
      // stack by half the face's block does exactly that: the face hangs above
      // the line and the text lands on it, the same balance the splash strikes
      // with nothing above its lettering.
      style={{ transform: `translateY(-${FACE_BLOCK / 2}px)` }}
    >
      <div className="w-full min-w-0">
        <div className="flex justify-center" style={{ marginBottom: FACE_GAP }}>
          <BotFace
            color={avatarColor(color, bot.name)}
            image={photo ? image : null}
            mood="idle"
            name={bot.name}
            shape={shape}
            size={FACE_SIZE}
          />
        </div>

        <Wordmark className="mb-1" text={name} width="calc(80% - 1rem)" />

        <p className="m-0 text-center leading-normal tracking-tight">{b.bot.chatEmpty}</p>

        {/* Starter chips: the template's (or generic) first-message ideas.
            pointer-events-auto re-enables clicks inside the pointer-events-none
            splash stack; once a prompt lands the transcript fills and this
            unmounts. */}
        <div className="pointer-events-auto mt-4 flex max-w-md flex-wrap items-center justify-center gap-1.5">
          {starters.map(text => (
            <RowButton
              className="rounded-full border border-(--ui-stroke-secondary) px-3 py-1.5 text-xs text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground disabled:opacity-50"
              disabled={sent}
              key={text}
              onClick={() => submitStarter(text)}
            >
              {text}
            </RowButton>
          ))}
        </div>
      </div>
    </div>
  )
}
