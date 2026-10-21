/**
 * The scripted conversation behind the AvatarRoom — version 1 of
 * `ConversationSource` (architecture §8.6, §11).
 *
 * LABELLED scaffolding: the room's bubbles and feed lines are badged "Dev
 * harness" because this is where the text comes from. The interface it
 * implements lives in `director/room.ts`, and only the composition point
 * (`director/defaults.ts`) imports this module.
 *
 * Lines are per ordered pair (speaker → listener); the greeting is two lines,
 * so both directions of the pair are used.
 */

import type { ConversationSource } from '../director/room'
import type { AvatarId } from '../protocol'

const DISPLAY_NAMES: Record<AvatarId, string> = {
  claude: 'Claude',
  grok: 'Grok',
  hermes: 'Hermes',
  muse: 'Muse',
  opencode: 'OpenCode'
}

/** Key: `${speaker}->${listener}`. Indexed by `ctx.turn` for longer exchanges. */
const LINES: Record<string, string[]> = {
  'claude->hermes': ['Hermes, the notes are on your desk.', 'Winged courier of the morning — thank you.'],
  'claude->muse': ['Muse, that palette is lovely.', 'Terracotta and pearl. We should team up.'],
  'claude->opencode': ['Your cursor has been blinking at me.', 'It only blinks when I am thinking.'],
  'grok->hermes': ['Hermes, the digest is queued — want it now?', 'Send it over; I will fold it into the brief.'],
  'grok->muse': ['Muse! Saw the reel go out — clean edit.', 'Third pass finally landed the cut, right?'],
  'grok->opencode': ['OpenCode, how is the build looking?', 'Green. Two warnings, both yours.'],
  'hermes->claude': ['Claude, the notes are on your desk.', 'Winged courier of the morning — thank you.'],
  'hermes->grok': ['Send it over; I will fold it into the brief.', 'Queued. You will like this one.'],
  'hermes->muse': ['Muse, your halo is catching the light.', 'And your gold is doing most of the work.'],
  'hermes->opencode': ['The index finished — 1,204 entries.', 'Indexed and cached. Nice.'],
  'muse->claude': ['Terracotta and pearl. We should team up.', 'I will bring the sparkle.'],
  'muse->grok': ['Thanks! Third pass finally landed the cut.', 'Told you the slower edit would win.'],
  'muse->hermes': ['Hermes, your gold is catching the light today.', 'And your halo is doing most of the work.'],
  'muse->opencode': ['Always — the last one rendered beautifully.', 'Then this one will too.'],
  'opencode->claude': ['It only blinks when I am thinking.', 'Then you are always thinking.'],
  'opencode->grok': ['Green. Two warnings, both yours.', 'Fix them before the review.'],
  'opencode->hermes': ['Indexed and cached. Nice.', 'The fastest courier is a warm cache.'],
  'opencode->muse': ['Muse, want a preview build?', 'Always — the last one rendered beautifully.']
}

function fallback(speaker: AvatarId, listener: AvatarId, turn: number): string {
  const name = DISPLAY_NAMES[listener]

  return turn === 0 ? `Good to see you out here, ${name}.` : `Likewise, ${DISPLAY_NAMES[speaker]}.`
}

export const scriptedConversation: ConversationSource = {
  isDevHarness: true,
  label: 'Dev harness',

  next(speaker, listener, ctx) {
    const pool = LINES[`${speaker}->${listener}`]
    const text = pool?.[ctx.turn % pool.length] ?? fallback(speaker, listener, ctx.turn)

    return { listener, speaker, text }
  }
}
