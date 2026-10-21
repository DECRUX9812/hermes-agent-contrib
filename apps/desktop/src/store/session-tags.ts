/**
 * User-assigned color/label chips on a session — the desktop's answer to
 * Linear labels. Purely renderer-side state (like pins and session colors):
 * keyed by the DURABLE lineage id so a tag survives auto-compression's
 * session-id rotation, and by profile so the islands never bleed into each
 * other. The atom is connection-scoped (`connectionScopedAtom`): remote
 * connections persist under `<key>.remote.<baseUrl>.<profile>`, the local
 * connection keeps the bare key — scope is declared in the key itself.
 *
 * Profile renames/deletes re-home or drop this map's local entries through
 * {@link migrateSessionTagsForProfile} / {@link dropSessionTagsForProfile},
 * both hung off `migrateTilesForProfile` / `dropTilesForProfile` like every
 * other profile-keyed localStorage family.
 */
import { connectionScopedAtom } from '@/lib/connection-scoped'
import { Codecs } from '@/lib/persisted'
import { normalizeProfileKey } from '@/store/profile'

export interface SessionTag {
  /** A PROFILE_SWATCHES hsl() string picked in the tags dialog. */
  color: string
  label: string
}

/** One session's tags live under `${profile}:${durableId}` — serialized as a
 *  JSON pair (same convention as the session owner hints) so a profile name
 *  can never collide with the id half of a neighbor's key. */
export const sessionTagKey = (profile: null | string | undefined, durableId: string): string =>
  JSON.stringify([normalizeProfileKey(profile), durableId])

type SessionTagMap = Record<string, SessionTag[]>

const normalizeTagLabel = (label: string) => label.trim().replace(/\s+/g, ' ')

function sanitizeTagMap(value: unknown): SessionTagMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const out: SessionTagMap = {}

  for (const [key, tags] of Object.entries(value)) {
    if (!Array.isArray(tags)) {
      continue
    }

    const clean = tags.filter(
      (tag): tag is SessionTag =>
        Boolean(tag) &&
        typeof tag === 'object' &&
        typeof (tag as SessionTag).label === 'string' &&
        (tag as SessionTag).label.trim().length > 0 &&
        typeof (tag as SessionTag).color === 'string' &&
        (tag as SessionTag).color.length > 0
    )

    if (clean.length > 0) {
      out[key] = clean
    }
  }

  return out
}

export const $sessionTags = connectionScopedAtom<SessionTagMap>(
  'hermes.desktop.sessionTags',
  {},
  Codecs.json(sanitizeTagMap)
)

export const sessionTagsFor = (
  map: SessionTagMap,
  profile: null | string | undefined,
  durableId: string
): readonly SessionTag[] => map[sessionTagKey(profile, durableId)] ?? []

/** Replace a session's tag list wholesale (empty clears the key so the map
 *  doesn't collect orphaned entries for sessions long since deleted). */
export function setSessionTags(profile: null | string | undefined, durableId: string, tags: SessionTag[]): void {
  const map = $sessionTags.get()
  const key = sessionTagKey(profile, durableId)
  const next = { ...map }

  if (tags.length > 0) {
    next[key] = tags
  } else {
    delete next[key]
  }

  $sessionTags.set(next)
}

/** Add (or recolor) a tag. Labels dedupe case-insensitively: re-adding an
 *  existing label updates its color rather than stacking a twin chip. */
export function addSessionTag(profile: null | string | undefined, durableId: string, tag: SessionTag): void {
  const label = normalizeTagLabel(tag.label)

  if (!label || !tag.color) {
    return
  }

  const tags = [...sessionTagsFor($sessionTags.get(), profile, durableId)]
  const existing = tags.findIndex(t => t.label.toLowerCase() === label.toLowerCase())

  if (existing >= 0) {
    tags[existing] = { color: tag.color, label: tags[existing]!.label }
  } else {
    tags.push({ color: tag.color, label })
  }

  setSessionTags(profile, durableId, tags)
}

export function removeSessionTag(profile: null | string | undefined, durableId: string, label: string): void {
  const tags = sessionTagsFor($sessionTags.get(), profile, durableId)
  const next = tags.filter(t => t.label !== label)

  if (next.length === tags.length) {
    return
  }

  setSessionTags(profile, durableId, next)
}

/**
 * A local profile rename re-homes its tag entries: keys under the old profile
 * name move onto the new one (destination wins on the impossible-ish
 * collision — the renamed-away entries keep their own tags regardless).
 * Remote profiles need nothing here: their storage key already carries the
 * remote profile name and remote renames don't route through this dialog.
 */
export function migrateSessionTagsForProfile(from: string, to: string): void {
  const map = $sessionTags.get()
  const fromPrefix = `[${JSON.stringify(normalizeProfileKey(from))},`
  const toPrefix = `[${JSON.stringify(normalizeProfileKey(to))},`
  let changed = false
  const next: SessionTagMap = {}

  for (const [key, tags] of Object.entries(map)) {
    if (key.startsWith(fromPrefix)) {
      next[toPrefix + key.slice(fromPrefix.length)] = tags
      changed = true
    } else {
      next[key] = tags
    }
  }

  if (changed) {
    $sessionTags.set(next)
  }
}

/** Mirror of the composer-drafts drop: only a LOCAL profile delete can reach
 *  these keys — a remote connection's tags persist under a different storage
 *  key entirely — but the route guard stays so the contract matches its
 *  siblings (`dropComposerDraftsForProfile`). */
export function dropSessionTagsForProfile(
  profile: string,
  route?: { connectionId?: string; profile?: string; targetProfile?: string }
): void {
  if ((String(route?.connectionId ?? '').trim() || 'local') !== 'local') {
    return
  }

  const map = $sessionTags.get()
  const prefix = `[${JSON.stringify(normalizeProfileKey(profile))},`
  let changed = false
  const next: SessionTagMap = {}

  for (const [key, tags] of Object.entries(map)) {
    if (key.startsWith(prefix)) {
      changed = true
    } else {
      next[key] = tags
    }
  }

  if (changed) {
    $sessionTags.set(next)
  }
}

/** Distinct tag labels across every session in the map, for the sidebar's
 *  Tags filter facet. Dedupes case-insensitively; first-seen color wins so a
 *  filter row can carry the tag's own swatch. */
export function collectSessionTagFacets(map: SessionTagMap): SessionTag[] {
  const seen = new Map<string, SessionTag>()

  for (const tags of Object.values(map)) {
    for (const tag of tags) {
      const key = tag.label.toLowerCase()

      if (!seen.has(key)) {
        seen.set(key, tag)
      }
    }
  }

  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
}
