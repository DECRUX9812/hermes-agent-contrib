/**
 * Built-in packs must be org designs `tools/bot_team.py::import_pack` accepts and
 * builds into a valid chart: the current pack version, exactly one lead, every
 * reporting line pointing at a seat in the same pack, and no cycles.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('./team', () => ({ mutateTeam: vi.fn() }))

import { BUILTIN_TEAM_PACKS } from './team-packs'

describe('BUILTIN_TEAM_PACKS', () => {
  it.each(BUILTIN_TEAM_PACKS.map(p => [p.id, p] as const))('%s is an importable org chart', (_id, { faces, pack }) => {
    expect(pack.pack_version).toBe(1)
    expect(pack.seats.length).toBeGreaterThan(0)
    expect(pack.seats.filter(seat => seat.lead)).toHaveLength(1)
    expect(faces.length).toBeGreaterThan(0)

    const slots = new Set(pack.seats.map(seat => seat.slot))

    expect(slots.size).toBe(pack.seats.length)

    for (const seat of pack.seats) {
      if (seat.reports_to_slot) {
        expect(slots).toContain(seat.reports_to_slot)
      }

      // Walk up the chain: it must end at a seat with no boss, never loop.
      const seen = new Set<string>()
      let at: string | undefined = seat.slot

      while (at) {
        expect(seen.has(at)).toBe(false)
        seen.add(at)
        at = pack.seats.find(s => s.slot === at)?.reports_to_slot
      }
    }
  })
})
