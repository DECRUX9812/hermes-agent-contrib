/**
 * Find-on-map matching, kept pure so the rule is testable without a canvas.
 *
 * The map can hold hundreds of stars, and until now the only way to locate one
 * was to hunt for it by eye. This is the search that answers "where is that
 * memory?" — deliberately literal: a case-insensitive substring of the node's
 * label, in map order, no ranking. A map is a place, not a result list.
 */

/** The only part of a node this needs. Anything graph-shaped satisfies it. */
export interface Findable {
  id: string
  label?: unknown
}

/** Trim + case-fold. A blank box is not a search: it matches nothing. */
export function normalizeQuery(query: unknown): string {
  return typeof query === 'string' ? query.trim().toLowerCase() : ''
}

/**
 * Node ids whose label contains the query, in the order the map holds them.
 *
 * Robust by construction: a node with no id or a non-string label (a partial or
 * malformed graph) is skipped rather than thrown on — a search must never be
 * the thing that breaks a map that otherwise renders.
 */
export function findMatches(nodes: readonly Findable[], query: unknown): string[] {
  const needle = normalizeQuery(query)

  if (!needle) {
    return []
  }

  const ids: string[] = []

  for (const node of nodes ?? []) {
    if (!node || typeof node.id !== 'string' || node.id === '') {
      continue
    }

    const label = typeof node.label === 'string' ? node.label : ''

    if (label.toLowerCase().includes(needle)) {
      ids.push(node.id)
    }
  }

  return ids
}

/**
 * Step to the next/previous match with wrap-around.
 *
 * Enter walks forward, Shift+Enter back, and both wrap — so one key repeatedly
 * pressed visits every hit and comes home, which is how people actually read a
 * map. Returns null only when there is nothing to match.
 */
export function stepMatch(current: null | string, ids: readonly string[], direction: 1 | -1): null | string {
  if (!ids || ids.length === 0) {
    return null
  }

  const at = current ? ids.indexOf(current) : -1

  if (at < 0) {
    return direction === 1 ? ids[0] : ids[ids.length - 1]
  }

  return ids[(at + direction + ids.length) % ids.length]
}

/** Human label for the counter: "3/12", or a distinct no-match state. */
export function matchCounterLabel(index: number, count: number): string {
  if (count <= 0) {
    return '0/0'
  }

  const safe = Number.isFinite(index) ? Math.min(Math.max(index, 0), count - 1) : 0

  return `${safe + 1}/${count}`
}
