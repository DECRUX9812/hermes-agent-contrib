import { activeConnectionScopeSuffix, connectionScopedAtom } from '@/lib/connection-scoped'
import { Codecs } from '@/lib/persisted'
import { readKey } from '@/lib/storage'

// ── ⌘K frecency ────────────────────────────────────────────────────────────
// "Frecency" = frequency × recency: the palette ranks rows by how often AND
// how recently they were picked, so the static curated order relaxes into the
// user's actual habits. One table per connection scope — sessions and settings
// only exist on the backend that served them, so the key carries the scope
// (`connectionScopedAtom`) instead of going global.

export interface PaletteUse {
  /** Selections counted across every window on this connection scope. */
  count: number
  /** Epoch ms of the most recent selection. */
  lastUsed: number
}

export type PaletteFrecencyTable = Record<string, PaletteUse>

const STORAGE_KEY = 'hermes.desktop.commandPaletteFrecency'

// Bounded: each entry is a few dozen bytes, but the session namespace is
// unbounded — only the strongest entries earn their slot.
const MAX_ENTRIES = 200

const sanitize = (value: unknown): PaletteFrecencyTable => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const table: PaletteFrecencyTable = {}

  for (const [key, entry] of Object.entries(value)) {
    if (!key || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }

    const { count, lastUsed } = entry as { count?: unknown; lastUsed?: unknown }

    if (
      typeof count === 'number' &&
      Number.isFinite(count) &&
      count > 0 &&
      typeof lastUsed === 'number' &&
      Number.isFinite(lastUsed)
    ) {
      table[key] = { count: Math.floor(count), lastUsed }
    }
  }

  return table
}

export const $paletteFrecency = connectionScopedAtom<PaletteFrecencyTable>(STORAGE_KEY, {}, Codecs.json(sanitize))

// Recency buckets: frequency alone would pin last month's daily habit above
// the thing picked twice today, so each use counts for more while it's fresh.
const HOUR_MS = 3_600_000

const recencyWeight = (ageMs: number): number =>
  ageMs < 4 * HOUR_MS
    ? 4
    : ageMs < 24 * HOUR_MS
      ? 2
      : ageMs < 7 * 24 * HOUR_MS
        ? 1
        : ageMs < 30 * 24 * HOUR_MS
          ? 0.5
          : 0.2

/** Raw strength of a history entry — the unit ordering and pruning work in. */
export function frecencyScore(use: PaletteUse | undefined, now: number): number {
  if (!use || use.count <= 0) {
    return 0
  }

  return use.count * recencyWeight(Math.max(0, now - use.lastUsed))
}

// The lift history adds to a text match, capped under ~3 grade bands of
// scoreItem (~0.1 each): frecency orders same-quality matches and rescues a
// near miss, but a heavily used row never buries a clearly better text match —
// the needle still wins.
const MAX_BOOST = 0.25

export function frecencyBoost(use: PaletteUse | undefined, now: number): number {
  const score = frecencyScore(use, now)

  return MAX_BOOST * (score / (score + 6))
}

/** Re-read the scope's persisted table — windows sharing this connection
 *  write the same key, so the freshest copy lives in storage, not the atom. */
function persistedTable(): PaletteFrecencyTable {
  const raw = readKey(STORAGE_KEY + activeConnectionScopeSuffix())

  if (raw === null) {
    return {}
  }

  try {
    return sanitize(JSON.parse(raw))
  } catch {
    return {}
  }
}

function pruneFrecency(table: PaletteFrecencyTable, now: number): PaletteFrecencyTable {
  const keys = Object.keys(table)

  if (keys.length <= MAX_ENTRIES) {
    return table
  }

  const keep = new Set(
    keys
      .map(key => [key, frecencyScore(table[key], now)] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ENTRIES)
      .map(([key]) => key)
  )

  return Object.fromEntries(Object.entries(table).filter(([key]) => keep.has(key)))
}

/** The canonical history key for a chat — the palette lists one session under
 *  several row ids (`pinned-`, `session-`, `archived-`), and opens from other
 *  surfaces feed the same entry. */
export const paletteSessionKey = (storedSessionId: string): string => `session:${storedSessionId}`

/** Count one selection. Re-reads the persisted table first (merge, don't
 *  clobber — see persistedTable), then lands the increment on top. The
 *  in-memory copy participates too: a failed write (quota, restricted
 *  storage) leaves it holding entries storage never saw. Counts merge by
 *  MAX — each window's writes pass through storage, so the larger side
 *  already contains the smaller's increments. */
export function recordPaletteUse(key: string, now: number = Date.now()): void {
  if (!key) {
    return
  }

  const next: PaletteFrecencyTable = { ...$paletteFrecency.get() }

  for (const [entryKey, entry] of Object.entries(persistedTable())) {
    const existing = next[entryKey]

    next[entryKey] = existing
      ? { count: Math.max(existing.count, entry.count), lastUsed: Math.max(existing.lastUsed, entry.lastUsed) }
      : entry
  }

  const previous = next[key]
  next[key] = { count: (previous?.count ?? 0) + 1, lastUsed: now }
  $paletteFrecency.set(pruneFrecency(next, now))
}
