/**
 * Team OS slice 5 — the universal Needs You categories.
 *
 * The triage strip's pending-input index (triage.ts) is content-free by
 * design: it carries a classified KIND and, at most, a one-line reason code —
 * never a message body. This module extends that index with the three
 * EXPLICIT categories the invariants allow ("Needs you ONLY from real
 * clarify/approval/sudo/secret stores (+ later explicit categories)"):
 *
 *   - `handoff-failed`   — a structured task hand-off bounced (a relay
 *                          delivery that carried a mailbox note and threw).
 *   - `blocked`          — work parked on a dependency that has not landed.
 *   - `artifact-review`  — an artifact is ready for a human look.
 *
 * Everything here is pure and explicit: an entry exists only because someone
 * recorded an event through `recordNeedsYouEvent` / `applyNeedsYouEvent`.
 * Nothing is derived from transcript content, nothing polls, and the index
 * never writes a status — recording an artifact-review event attaches the
 * artifact REF beside the caller's status and leaves `status` byte-identical
 * (the same contract `applyMissionEvent`'s ARTIFACT_CREATED branch had).
 *
 * The store itself is a window-local atom persisted best-effort through
 * plugin storage, hydrated tolerantly: a malformed or unknown event is
 * dropped, never thrown on, so a bad payload can never break hydration or
 * the strip that reads it.
 */

import { atom } from '@hermes/plugin-sdk'

import { getPluginCtx } from './shared'

const STORAGE_KEY = 'needs-you-index-v1'

/** Bound on every free-text field — a reason is a classified code, a ref is a
 *  pointer. Neither may ever become a payload channel. */
export const NEEDS_YOU_TEXT_MAX = 200

/** Entries kept per bot (highest rank wins), and the whole index's ceiling. */
export const NEEDS_YOU_PER_BOT = 4
export const NEEDS_YOU_TOTAL_LIMIT = 60

export const NEEDS_YOU_CATEGORIES = ['artifact-review', 'blocked', 'handoff-failed'] as const

export type NeedsYouCategory = (typeof NEEDS_YOU_CATEGORIES)[number]

/** Urgency inside one bot's cards — lower wins. A failed handoff stalls work
 *  outright, a blocked dependency stalls the next step, an artifact waiting
 *  for review can hold its position. */
export const NEEDS_YOU_RANK: Readonly<Record<NeedsYouCategory, number>> = {
  'handoff-failed': 0,
  blocked: 1,
  'artifact-review': 2
}

/** One explicit needs-you card. Content-free: identity + category + bounded
 *  classified reason/ref, nothing else. */
export interface NeedsYouEntry {
  /** Milliseconds epoch. */
  at: number
  /** The bot this card belongs to — `conn::profile` / selection-key ladder. */
  bot: string
  category: NeedsYouCategory
  /** Stable event id — the dedupe key, so a re-delivered event replaces its
   *  own copy instead of stacking. */
  id: string
  /** Classified reason code (never free text from a transcript). */
  reason?: string
  /** Artifact URI / dependency id the card points at. */
  ref?: string
}

/** bot key → that bot's cards, ranked. */
export type NeedsYouIndex = Record<string, readonly NeedsYouEntry[]>

/** Bot Mode's universal Needs You index: window-local, best-effort persisted. */
export const $needsYouIndex = atom<NeedsYouIndex>({})

function text(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined
  }

  const value = raw.trim().slice(0, NEEDS_YOU_TEXT_MAX)

  return value || undefined
}

/** Validate one raw event. Unknown categories, missing identity, wrong types
 *  and present-but-non-numeric timestamps all normalize to null — the caller
 *  drops them. Pure; tested directly. */
export function normalizeNeedsYouEvent(raw: unknown, now: number = Date.now()): NeedsYouEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const event = raw as Record<string, unknown>
  const bot = typeof event.bot === 'string' ? event.bot.trim() : ''
  const id = typeof event.id === 'string' ? event.id.trim() : ''
  const category = event.category

  if (!bot || !id || !NEEDS_YOU_CATEGORIES.includes(category as NeedsYouCategory)) {
    return null
  }

  let at = now

  if (event.at !== undefined) {
    const stamp = Number(event.at)

    if (!Number.isFinite(stamp)) {
      return null
    }

    at = stamp
  }

  const entry: NeedsYouEntry = {
    at,
    bot,
    category: category as NeedsYouCategory,
    id
  }

  const reason = text(event.reason)
  const ref = text(event.ref)

  if (reason) {
    entry.reason = reason
  }

  if (ref) {
    entry.ref = ref
  }

  return entry
}

/** Rank then recency — the order cards surface in. */
function ranked(entries: readonly NeedsYouEntry[]): NeedsYouEntry[] {
  return [...entries].sort((a, b) => NEEDS_YOU_RANK[a.category] - NEEDS_YOU_RANK[b.category] || b.at - a.at)
}

function boundIndex(index: NeedsYouIndex): NeedsYouIndex {
  const next: NeedsYouIndex = {}

  for (const [bot, entries] of Object.entries(index)) {
    const kept = ranked(entries).slice(0, NEEDS_YOU_PER_BOT)

    if (kept.length) {
      next[bot] = kept
    }
  }

  const total = Object.values(next).reduce((sum, entries) => sum + entries.length, 0)

  if (total <= NEEDS_YOU_TOTAL_LIMIT) {
    return next
  }

  // Over the ceiling: drop the globally oldest cards first, never a whole bot
  // at random.
  const drop = new Set(
    ranked(Object.values(next).flat())
      .slice(NEEDS_YOU_TOTAL_LIMIT)
      .map(entry => `${entry.bot}::${entry.id}`)
  )

  const trimmed: NeedsYouIndex = {}

  for (const [bot, entries] of Object.entries(next)) {
    const kept = entries.filter(entry => !drop.has(`${bot}::${entry.id}`))

    if (kept.length) {
      trimmed[bot] = kept
    }
  }

  return trimmed
}

function persist(index: NeedsYouIndex): void {
  try {
    void getPluginCtx()?.storage?.set?.(STORAGE_KEY, index)
  } catch {
    /* persistence is best-effort — the cards hold for this window either way */
  }
}

/** Record one explicit event. Returns false when it normalized to null (the
 *  event is dropped); true when a card is now indexed. */
export function recordNeedsYouEvent(raw: unknown, now: number = Date.now()): boolean {
  const entry = normalizeNeedsYouEvent(raw, now)

  if (!entry) {
    return false
  }

  const index = { ...$needsYouIndex.get() }
  const kept = (index[entry.bot] ?? []).filter(prior => prior.id !== entry.id)

  index[entry.bot] = [...kept, entry]
  $needsYouIndex.set(boundIndex(index))
  persist($needsYouIndex.get())

  return true
}

/** Dismiss one card (or every card under a category — the "a good turn clears
 *  the badge" door a successful delivery calls). */
export function clearNeedsYou(bot: string, category?: NeedsYouCategory): boolean {
  const key = String(bot || '')
  const current = $needsYouIndex.get()[key]

  if (!key || !current) {
    return false
  }

  const kept = category ? current.filter(entry => entry.category !== category) : []
  const index = { ...$needsYouIndex.get() }

  if (kept.length) {
    index[key] = kept
  } else {
    delete index[key]
  }

  $needsYouIndex.set(index)
  persist(index)

  return kept.length !== current.length
}

/** The task-scoped subject a card hangs off: a status the caller owns plus
 *  the cards recorded beside it. */
export interface NeedsYouSubject {
  entries?: readonly NeedsYouEntry[]
  status?: string
}

/** The task-scoped door: add a card BESIDE a caller-held subject and return a
 *  new subject. `status` is spread through untouched — an artifact-review
 *  event attaches its ref and never flips the task's status (the contract the
 *  mission model's ARTIFACT_CREATED branch had). Malformed events return the
 *  subject unchanged. */
export function applyNeedsYouEvent<T extends NeedsYouSubject>(subject: T, raw: unknown, now?: number): T {
  const entry = normalizeNeedsYouEvent(raw, now)

  if (!entry) {
    return subject
  }

  const next = { ...subject, entries: [...(subject.entries ?? []), entry] }

  return next as T
}

/** Tolerant hydration: a non-object payload yields an empty index, and every
 *  malformed or unknown entry is dropped (its `bot` is re-stamped from the
 *  bucket key so a forged bot inside a bucket cannot escape it). Never throws.
 *  Pure; tested directly. */
export function hydrateNeedsYouIndex(raw: unknown, now: number = Date.now()): NeedsYouIndex {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }

  const index: NeedsYouIndex = {}

  for (const [bot, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      continue
    }

    const entries = value
      .map(item =>
        normalizeNeedsYouEvent(item && typeof item === 'object' ? { ...(item as object), bot } : null, now)
      )
      .filter((entry): entry is NeedsYouEntry => entry !== null)

    if (entries.length) {
      index[bot] = entries
    }
  }

  return boundIndex(index)
}

/** Read the persisted index back into the atom — same shape contract as every
 *  other `hydrateX()` Bot Mode calls during register(). A corrupt blob is
 *  ignored outright rather than wiping cards already on screen. */
export function hydrateNeedsYou(): void {
  try {
    Promise.resolve<unknown>(getPluginCtx()?.storage?.get?.(STORAGE_KEY, null))
      .then(value => {
        if (value && typeof value === 'object') {
          $needsYouIndex.set(hydrateNeedsYouIndex(value))
        }
      })
      .catch(() => undefined)
  } catch {
    /* no storage — the index stays window-local */
  }
}

/** Shape guard for anything reaching the strip: the index is hydrated from
 *  storage and fed by events, so a bucket may hold junk — a non-object or an
 *  unknown category never becomes a card. */
function isNeedsYouEntry(entry: unknown): entry is NeedsYouEntry {
  if (!entry || typeof entry !== 'object') {
    return false
  }

  const candidate = entry as Partial<NeedsYouEntry>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.category === 'string' &&
    Object.hasOwn(NEEDS_YOU_RANK, candidate.category)
  )
}

/** The cards for one bot, highest urgency first, across every key that bot's
 *  row can publish under (selection key → roster key → conn::profile — the
 *  same ladder the attention flag reads). Deduped by event id. */
export function needsYouEntriesFor(
  index: Readonly<Record<string, readonly NeedsYouEntry[] | undefined>> | undefined,
  keys: readonly string[],
  limit = NEEDS_YOU_PER_BOT
): NeedsYouEntry[] {
  if (!index) {
    return []
  }

  const seen = new Set<string>()
  const entries: NeedsYouEntry[] = []

  for (const key of keys) {
    const bucket = index[key]

    if (!Array.isArray(bucket)) {
      continue
    }

    for (const entry of bucket) {
      if (!isNeedsYouEntry(entry) || seen.has(entry.id)) {
        continue
      }

      seen.add(entry.id)
      entries.push(entry)
    }
  }

  return ranked(entries).slice(0, limit)
}
