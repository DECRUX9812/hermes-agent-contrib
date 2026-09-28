/**
 * D1 — fleet broadcast: one prompt to each selected bot's canonical chat, in
 * parallel, with a results surface collecting every reply.
 *
 * Identity rules are the same ones the row's click-path lives by: the
 * forever-chat is (profile, 'Bot Chat'), resolved through the roster's
 * canonical_session first and the session.list registry lookup after that —
 * never a stored pointer beyond that registry, never recency. Minting is
 * adopt-before-mint, mirroring createCanonicalChat's session.create +
 * eager session.title write, minus its navigation: a broadcast must never
 * yank the user's focus (openStoredBotChat is the navigating half and stays
 * on the click path).
 *
 * Dispatch itself reuses the room engine's proven shape: session.resume by
 * STORED id mints a runtime id without mounting the tile, prompt.submit
 * carries the turn, and session.resume polls until the turn settles — the
 * same RPC trio group rounds run on, just parallel and on the canonical
 * chat instead of a per-group session.
 */

import { atom } from '@hermes/plugin-sdk'

import { CANONICAL_CHAT_TITLE, findExistingCanonicalChat } from './canonical-chat'
import { botRosterKey } from './data'
import { backendTargetProfile, botConnectionRoute, requestForBot } from './routing'
import type { RosterRow } from './types'

export interface BroadcastEntry {
  bot: RosterRow
  error?: string
  /** Bot's roster key — a connection-qualified identity, never a session id. */
  key: string
  reply?: string
  status: 'done' | 'error' | 'sending' | 'working'
}

export interface BroadcastRun {
  at: number
  entries: BroadcastEntry[]
  prompt: string
}

/** The latest broadcast's live state — the dialog renders this atom. */
export const $broadcastRun = atom<BroadcastRun | null>(null)

/** A broadcast's per-bot poll cadence and hard ceiling. Long turns keep
 *  reporting 'working' rather than erroring — the ceiling only stops the
 *  poller, not the turn. */
const BROADCAST_POLL_MS = 4000
const BROADCAST_POLL_CAP = 150 // ~10 minutes
const BROADCAST_RESUME_TIMEOUT_MS = 180_000

interface BroadcastSnapshot {
  inflight?: boolean | { error?: string; status?: string }
  message_count?: number
  messages?: { content?: Array<string | { text?: string }> | string; role?: string }[]
  running?: boolean
  session_id?: string
}

function messageText(message: NonNullable<BroadcastSnapshot['messages']>[number]): string {
  const content = message?.content

  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('').trim()
  }

  return ''
}

/** The newest assistant line since `before` message count — the reply a
 *  broadcast turn produced, or null while the turn is still streaming. */
function latestAssistantReply(messages: BroadcastSnapshot['messages'], before: number): null | string {
  const list = Array.isArray(messages) ? messages : []

  for (let i = list.length - 1; i >= before; i--) {
    if (list[i]?.role !== 'assistant') {
      continue
    }

    const text = messageText(list[i])

    if (text) {
      return text
    }
  }

  return null
}

/** Resolve (or mint) the bot's canonical chat STORED id without navigating.
 *  Returns null when the registry lookup itself failed — a fail-closed miss,
 *  same contract findExistingCanonicalChat's callers rely on. */
async function resolveCanonicalForDispatch(bot: RosterRow): Promise<null | string> {
  const known = bot?.canonical_session

  if (known?.id) {
    return String(known.resolved_id || known.id)
  }

  const existing = await findExistingCanonicalChat(bot)

  if (existing?.id) {
    return String(existing.resolved_id || existing.id)
  }

  // No row → mint, mirroring createCanonicalChat's create + eager title
  // write. No navigation and no kickoff: the broadcast prompt IS the first
  // user turn. A title collision means a concurrent writer minted first —
  // re-read the registry and adopt the winner instead of prompting into our
  // stray lazy session.
  const route = botConnectionRoute(bot)

  const created = await requestForBot<{ session_id?: string; stored_session_id?: string }>(
    bot,
    'session.create',
    {
      follow_profile_config: true,
      hidden: true,
      profile: backendTargetProfile(route, bot.name),
      title: CANONICAL_CHAT_TITLE
    },
    { spawnPriority: 'foreground' }
  )

  const runtime = created?.session_id
  const sid = created?.stored_session_id

  if (runtime) {
    try {
      await requestForBot(bot, 'session.title', {
        session_id: runtime,
        title: CANONICAL_CHAT_TITLE
      })
    } catch (error) {
      if (/already in use/i.test(String((error as { message?: string })?.message || ''))) {
        const winner = await findExistingCanonicalChat(bot)

        if (winner?.id) {
          return String(winner.resolved_id || winner.id)
        }
      }
      /* older gateways title on first prompt — the submit below persists it */
    }
  }

  return sid || null
}

/** Mint a runtime id for the stored chat without mounting a tile. */
async function resumeForDispatch(bot: RosterRow, stored: string): Promise<BroadcastSnapshot> {
  return requestForBot<BroadcastSnapshot>(
    bot,
    'session.resume',
    {
      omit_messages: true,
      profile: bot.name,
      session_id: stored
    },
    { spawnPriority: 'foreground', timeoutMs: BROADCAST_RESUME_TIMEOUT_MS }
  )
}

/** Poll the settled turn and surface its latest assistant reply. A retained
 *  failed turn (`inflight: {status:'error'}`) reports as an error entry. */
async function collectReply(
  bot: RosterRow,
  stored: string,
  baselineCount: number,
  patch: (part: Partial<BroadcastEntry>) => void
) {
  for (let attempt = 0; attempt < BROADCAST_POLL_CAP; attempt++) {
    await new Promise(resolve => setTimeout(resolve, BROADCAST_POLL_MS))

    let state: BroadcastSnapshot | null = null

    try {
      state = await requestForBot<BroadcastSnapshot>(
        bot,
        'session.resume',
        {
          profile: bot.name,
          session_id: stored
        },
        { timeoutMs: BROADCAST_RESUME_TIMEOUT_MS }
      )
    } catch {
      continue
    }

    const inflight = state?.inflight
    const failedTurn = inflight && typeof inflight === 'object' && inflight.status === 'error'

    if (failedTurn) {
      patch({
        error: String((inflight as { error?: string }).error || 'turn failed'),
        status: 'error'
      })

      return
    }

    const stillRunning = inflight === true || (Boolean(inflight) && typeof inflight === 'object') || state?.running

    const reply = latestAssistantReply(state?.messages, baselineCount)

    if (!stillRunning && reply) {
      patch({ reply, status: 'done' })

      return
    }

    if (!stillRunning && !reply && (state?.messages?.length ?? 0) > baselineCount) {
      // Turn settled with no assistant row (a pass/notice only) — still a
      // finished broadcast leg, report the empty reply honestly.
      patch({ reply: '', status: 'done' })

      return
    }

    patch({ status: 'working' })
  }
}

/** The run currently allowed to write — a newer broadcast supersedes an
 *  older one's in-flight patches. Kept as a separate binding because each
 *  patch replaces the atom's value, so comparing the atom's contents to the
 *  original object would drop every patch after the first. */
let latestRun: BroadcastRun | null = null

/** Send one prompt to each bot's canonical chat in parallel and collect the
 *  replies into $broadcastRun for the results surface. Never navigates. */
export function broadcastPrompt(bots: RosterRow[], prompt: string) {
  const text = String(prompt || '').trim()

  if (!text || !bots.length) {
    return
  }

  const run: BroadcastRun = {
    at: Date.now(),
    entries: bots.map(bot => ({
      bot,
      key: botRosterKey(bot) || bot.name,
      status: 'sending'
    })),
    prompt: text
  }

  const setEntry = (key: string, part: Partial<BroadcastEntry>) => {
    const current = $broadcastRun.get()

    if (latestRun !== run || !current) {
      return // a newer broadcast superseded this one
    }

    $broadcastRun.set({
      ...current,
      entries: current.entries.map(entry => (entry.key === key ? { ...entry, ...part } : entry))
    })
  }

  latestRun = run
  $broadcastRun.set(run)

  for (const entry of run.entries) {
    void (async () => {
      try {
        const stored = await resolveCanonicalForDispatch(entry.bot)

        if (!stored) {
          setEntry(entry.key, { error: 'registry-unavailable', status: 'error' })

          return
        }

        const resumed = await resumeForDispatch(entry.bot, stored)
        const runtime = resumed?.session_id

        if (!runtime) {
          setEntry(entry.key, { error: 'session-unavailable', status: 'error' })

          return
        }

        const baselineCount = resumed.message_count ?? resumed.messages?.length ?? 0

        await requestForBot(
          entry.bot,
          'prompt.submit',
          { session_id: runtime, text },
          { spawnPriority: 'foreground' }
        )

        setEntry(entry.key, { status: 'working' })
        await collectReply(entry.bot, stored, baselineCount, part => setEntry(entry.key, part))
      } catch (error) {
        setEntry(entry.key, {
          error: String((error as { message?: string })?.message || error || 'broadcast failed'),
          status: 'error'
        })
      }
    })()
  }
}

/** Test hook: reset run state between tests. */
export function resetBroadcastForTest() {
  latestRun = null
  $broadcastRun.set(null)
}
