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

/** Move a room to an absolute index inside its band (same pin flag, and the
 *  same `visible` subset the caller rendered, so filtered-out rooms keep
 *  their slots). Returns the full group-name order for the `rosterOrder`
 *  write, or null when the name is unknown, outside the band, or unmoved. */
export function moveGroupRow(rows: OrderRow[], name: string, toIndex: number, visible?: string[]): string[] | null {
  const row = rows.find(row => row.name === name)

  if (!row || row.kind !== 'group') {
    return null
  }

  const band = rows.filter(
    candidate =>
      candidate.kind === 'group' && candidate.pinned === row.pinned && (!visible || visible.includes(candidate.name!))
  )

  const from = band.findIndex(candidate => candidate.name === name)

  if (from === -1) {
    return null
  }

  const clamped = Math.max(0, Math.min(toIndex, band.length - 1))

  if (clamped === from) {
    return null
  }

  const moved = band.slice()
  const [picked] = moved.splice(from, 1)
  moved.splice(clamped, 0, picked!)

  const bandNames = new Set(band.map(candidate => candidate.name))
  let cursor = 0

  return rows
    .filter(row => row.kind === 'group')
    .map(row => {
      if (!bandNames.has(row.name)) {
        return row.name!
      }

      const placed = moved[cursor++]

      return placed?.name ?? row.name!
    })
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
