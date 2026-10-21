/** How many recently entered projects each profile remembers. */
export const RECENT_PROJECT_LIMIT = 12

/** `id` moves to the front; the list stays duplicate-free and bounded. */
export function touchRecent(ids: readonly string[], id: string, limit = RECENT_PROJECT_LIMIT): string[] {
  return [id, ...ids.filter(other => other !== id)].slice(0, limit)
}

/** Recently entered first (most recent leading), the rest in their own order. */
export function byRecency<T>(items: readonly T[], recentIds: readonly string[], idOf: (item: T) => string): T[] {
  const rank = new Map(recentIds.map((id, index) => [id, index]))
  const unranked = recentIds.length

  return items
    .map((item, index) => ({ index, item, rank: rank.get(idOf(item)) ?? unranked }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(entry => entry.item)
}
