interface OrderRow {
  activity: number
  /** A2 rollup — only consulted when the caller opts into attention sort. */
  attention?: number
  kind: 'bot' | 'group'
  name?: string
  pinned: boolean
}

/** Reorder room slots, not bots or folders. Pinning remains the outer band.
 *  `compareRows` overrides the inner (post-pin) order — the roster passes an
 *  attention-first comparator there; the default stays pinned-then-activity. */
export function sortGroupRosterRows<T extends OrderRow>(
  rows: T[],
  rooms: Record<string, { rosterOrder?: number }>,
  compareRows?: (a: T, b: T) => number
): T[] {
  const legacy = rows
    .slice()
    .sort(compareRows ?? ((a, b) => Number(b.pinned) - Number(a.pinned) || b.activity - a.activity))

  const groups = legacy
    .filter(row => row.kind === 'group')
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (rooms[a.name!]?.rosterOrder ?? Infinity) - (rooms[b.name!]?.rosterOrder ?? Infinity)
    )

  let index = 0

  return legacy.map(row => (row.kind === 'group' ? groups[index++] : row))
}

/** Swap visible neighbours without dropping filtered-out rooms from the order. */
export function reorderGroupRows(rows: OrderRow[], name: string, delta: -1 | 1, visible?: string[]): string[] | null {
  const row = rows.find(row => row.name === name)

  const band = rows.filter(
    candidate =>
      candidate.kind === 'group' && candidate.pinned === row?.pinned && (!visible || visible.includes(candidate.name!))
  )

  const index = band.findIndex(candidate => candidate.name === name)
  const neighbour = index >= 0 ? band[index + delta] : undefined

  if (!neighbour) {
    return null
  }

  return rows
    .filter(row => row.kind === 'group')
    .map(row => (row.name === name ? neighbour.name! : row.name === neighbour.name ? name : row.name!))
}
