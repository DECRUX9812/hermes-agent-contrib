/**
 * The decision model: a fast classifier that picks which room member
 * answers a message, in a few hundred milliseconds, before any bot turn
 * starts. It never does the work itself.
 *
 * Ported from OpenMausBot's server/decider (jev.ts + room-routing.ts;
 * © Milind Soni and contributors, Apache-2.0 — github.com/milind-soni/
 * OpenMausBot). The API shape is TypeSafe Jev's /v1/systemone.
 *
 * The contract every caller relies on: it NEVER throws into a relay. No
 * key, the switch off, a timeout, an HTTP error, a malformed answer: each
 * comes back as a fallback route and the room does exactly what it did
 * before this module existed.
 *
 * The key never leaves this worker: https endpoints only, or plain http to
 * loopback (a local Jev-compatible server, e.g. openjev-lm). Redirects are
 * never followed, so the key can't be replayed elsewhere.
 */

// ── the backend ────────────────────────────────────────────────────────────

export const JEV_DEFAULT_BASE_URL = 'https://api.typesafe.ai'
const JEV_MODEL = 'jev-latest'

export interface DeciderConfig {
  key: string
  /** Optional custom base — a local Jev-compatible server. https, or http
   *  to loopback only. */
  baseUrl?: string
}

export type DeciderFailure =
  | 'disabled'
  | 'misconfigured'
  | 'unreachable'
  | 'rejected'
  | 'rate_limited'
  | 'overloaded'
  | 'http_error'
  | 'malformed'

/** Turn starts take seconds anyway, and people far from the vendor see
 *  400–700 ms round trips; 1.5 s keeps a slow answer usable. */
export const ROOM_ROUTING_TIMEOUT_MS = 1_500
/** Bench calibration in OpenMausBot: answers at >= 0.6 were right 92–99%
 *  of the time. */
export const ROOM_ROUTING_MIN_PROBABILITY = 0.6
/** The Settings key check is one tiny call a person is waiting on. */
const KEY_CHECK_TIMEOUT_MS = 10_000

/** The endpoint for a base URL, or null when the key must not be sent
 *  there: https anywhere, plain http only to this machine. */
export function jevEndpoint(baseUrl?: string | null): URL | null {
  const root = (baseUrl?.trim() || JEV_DEFAULT_BASE_URL).replace(/\/+$/, '')
  let url: URL

  try {
    url = new URL(`${root}/v1/systemone`)
  } catch {
    return null
  }

  if (url.username || url.password) {return null}

  if (url.protocol === 'https:') {return url}

  const host = url.hostname

  return url.protocol === 'http:' &&
    (host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.') || host === '::1')
    ? url
    : null
}

// ── answers ─────────────────────────────────────────────────────────────────

interface ChoiceAnswer {
  type: 'choice'
  choice: string
  pTop: number
  probabilities: Record<string, number>
}

interface YesNoAnswer {
  type: 'yesno'
  p: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isProbability = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

/** Jev rounds to two places, so a map can sum to 0.98 or 1.02. */
const SUM_TOLERANCE = 0.1
const EPSILON = 1e-9

/** Strictly decode one choice answer against the options that were asked:
 *  the choice is one of the offered keys and the most likely one, every
 *  probability a number in [0, 1]. Anything else is malformed. */
function parseChoice(raw: Record<string, unknown>, options: Record<string, string>): ChoiceAnswer | null {
  const offered = new Set(Object.keys(options))
  const choice = raw.choice

  if (typeof choice !== 'string' || !offered.has(choice)) {return null}

  if (!isRecord(raw.probabilities)) {return null}

  const probabilities: Record<string, number> = {}
  let sum = 0

  for (const [key, value] of Object.entries(raw.probabilities)) {
    if (!offered.has(key) || !isProbability(value)) {return null}
    probabilities[key] = value
    sum += value
  }

  if (!(Math.abs(sum - 1) <= SUM_TOLERANCE)) {return null}

  const pTop = probabilities[choice]

  if (pTop === undefined) {return null}

  const runnerUp = Math.max(...Object.entries(probabilities).filter(([key]) => key !== choice).map(([, v]) => v), 0)

  // Ties break to the first key on the vendor side; a choice that is not
  // the most likely option means the answer is not what it claims to be.
  if (runnerUp > pTop + EPSILON) {return null}

  return { type: 'choice', choice, pTop, probabilities }
}

function parseYesNo(raw: Record<string, unknown>): YesNoAnswer | null {
  return isProbability(raw.noul) ? { type: 'yesno', p: raw.noul } : null
}

// ── the call ────────────────────────────────────────────────────────────────

interface WireQuestion {
  type: string
  instructions: string
  criteria?: unknown
}

async function jevAsk(
  cfg: DeciderConfig,
  state: unknown,
  questions: Record<string, WireQuestion>,
  timeoutMs: number,
): Promise<{ ok: true; answers: Record<string, unknown> } | { ok: false; reason: DeciderFailure }> {
  const endpoint = jevEndpoint(cfg.baseUrl)

  if (!endpoint) {return { ok: false, reason: 'misconfigured' }}

  let response: Response

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${cfg.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ state, model: JEV_MODEL, questions }),
      signal: AbortSignal.timeout(timeoutMs),
      // Never replay the key to wherever a redirect points.
      redirect: 'error',
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }

  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined)
    const { status } = response

    if (status === 401 || status === 403) {return { ok: false, reason: 'rejected' }}

    if (status === 429) {return { ok: false, reason: 'rate_limited' }}

    if (status === 503 || status === 529) {return { ok: false, reason: 'overloaded' }}

    return { ok: false, reason: 'http_error' }
  }

  let body: unknown

  try {
    body = await response.json()
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  if (!isRecord(body) || !isRecord(body.answers)) {return { ok: false, reason: 'malformed' }}

  return { ok: true, answers: body.answers }
}

/** The Options key check's fixed request — one noul the key either
 *  answers or doesn't. */
export async function jevKeyCheck(cfg: DeciderConfig): Promise<{ ok: true } | { ok: false; reason: DeciderFailure }> {
  if (!cfg.key.trim()) {return { ok: false, reason: 'misconfigured' }}

  const question: WireQuestion = { type: 'noul', instructions: 'Is this a connection check?' }
  const res = await jevAsk(cfg, { purpose: 'Bot Room is checking that a decision-model key works.' }, { check: question }, KEY_CHECK_TIMEOUT_MS)

  if (!res.ok) {return res}

  return parseYesNo(isRecord(res.answers.check) ? res.answers.check : {})
    ? { ok: true }
    : { ok: false, reason: 'malformed' }
}

// ── room routing ────────────────────────────────────────────────────────────

export const EVERYONE_OPTION = '__everyone__'
const EVERYONE_MEANING = 'Several members: the message explicitly needs answers or work from more than one member of the room, for example it asks everyone or asks each member for their part.'
const ROOM_ROUTING_INSTRUCTIONS = 'Which bot in this room should answer `new_message`? Choose __everyone__ only when the message needs several members to answer.'

const NAME_MAX = 80
const LINE_MAX = 500
/** Recent lines are clipped individually; this bounds their total, because
 *  large irrelevant state makes the classifier worse, not better. */
const RECENT_BUDGET_CHARS = 6_000

export interface RoomRoutingMember {
  id: string
  name: string
  description?: string
}

export interface RoomRoutingInput {
  room: string
  humans: string[]
  /** Active members only, in room order. */
  members: RoomRoutingMember[]
  /** Oldest first; already limited to the room's context window. */
  recent: Array<{ from: string; text: string }>
  message: { from: string; text: string }
}

export type RoomRoute =
  | { kind: 'member'; botId: string; probability: number }
  | { kind: 'everyone'; probability: number }
  | { kind: 'fallback'; reason: DeciderFailure | 'low_confidence' | 'no_choice' }

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** What one bot is, as an option: "Maya, Product Designer. Owns UI…". */
export function memberOption(member: RoomRoutingMember): string {
  const name = clip(member.name, NAME_MAX) || 'Unnamed bot'
  const description = member.description ? clip(member.description, LINE_MAX) : ''

  return `${name} bot.${description ? ` ${description}` : ''}`
}

/** The newest lines that fit the budget, oldest first, each clipped. */
function recentWithinBudget(recent: RoomRoutingInput['recent']): RoomRoutingInput['recent'] {
  const kept: RoomRoutingInput['recent'] = []
  let used = 0

  for (let index = recent.length - 1; index >= 0; index--) {
    const line = recent[index]!
    const text = clip(line.text, LINE_MAX)

    if (!text) {continue}

    const size = text.length + line.from.length

    if (used + size > RECENT_BUDGET_CHARS) {break}
    used += size
    kept.unshift({ from: clip(line.from, NAME_MAX), text })
  }

  return kept
}

/** Ask once and turn the answer into a route. Never throws. */
export async function decideRoomResponder(
  cfg: DeciderConfig | null,
  input: RoomRoutingInput,
): Promise<RoomRoute> {
  try {
    if (!cfg || !cfg.key.trim()) {return { kind: 'fallback', reason: 'disabled' }}

    if (input.members.length < 2) {return { kind: 'fallback', reason: 'no_choice' }}

    const options: Record<string, string> = {}

    for (const member of input.members) {options[member.id] = memberOption(member)}
    options[EVERYONE_OPTION] = EVERYONE_MEANING

    const recent = recentWithinBudget(input.recent)

    const state = {
      room: clip(input.room, NAME_MAX),
      humans_in_room: input.humans.map((human) => clip(human, NAME_MAX)),
      bots_in_room: input.members.map((member) => clip(member.name, NAME_MAX)),
      ...(recent.length ? { recent_messages: recent } : {}),
      new_message: { from: clip(input.message.from, NAME_MAX), text: input.message.text.trim().slice(0, 8_000) },
    }

    const question: WireQuestion = { type: 'choice', instructions: ROOM_ROUTING_INSTRUCTIONS, criteria: options }

    const res = await jevAsk(cfg, state, { answer: question }, ROOM_ROUTING_TIMEOUT_MS)

    if (!res.ok) {return { kind: 'fallback', reason: res.reason }}

    const answer = parseChoice(isRecord(res.answers.answer) ? res.answers.answer : {}, options)

    if (!answer) {return { kind: 'fallback', reason: 'malformed' }}

    if (answer.pTop < ROOM_ROUTING_MIN_PROBABILITY) {return { kind: 'fallback', reason: 'low_confidence' }}

    if (answer.choice === EVERYONE_OPTION) {return { kind: 'everyone', probability: answer.pTop }}

    return { kind: 'member', botId: answer.choice, probability: answer.pTop }
  } catch {
    return { kind: 'fallback', reason: 'malformed' }
  }
}
