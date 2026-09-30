/**
 * `botCardMetaItems` — the bot card's compact meta line.
 *
 * Facts only: a pinned model, a nonzero skill count, org teammates. An empty
 * field renders nothing — a bare profile produces NO line at all rather than
 * a row of "0 skills · no team" noise. `reports_to` joins come in already
 * resolved (bot-teammates); this is ordering, filtering, and the long-list
 * cap.
 */

import { describe, expect, it } from 'vitest'

import { botCardMetaItems } from './bot-card-meta'
import type { RosterRow } from './types'

const card = {
  leads: (names: string) => `leads ${names}`,
  ledBy: (name: string) => `led by ${name}`,
  skills: (count: number) => `${count} skills`
}

const none = { leads: [] as string[], reports: [] as string[] }

describe('botCardMetaItems', () => {
  it('renders the pinned model in fixed pitch and a nonzero skill count', () => {
    const items = botCardMetaItems({ model: 'opus-4.5', name: 'porter', skill_count: 4 } as RosterRow, none, card)

    expect(items.map(item => item.text)).toEqual(['opus-4.5', '4 skills'])
    expect(items[0].mono).toBe(true)
  })

  it('names the lead per seat and the reports on one line', () => {
    const items = botCardMetaItems({ name: 'porter' } as RosterRow, { leads: ['scout'], reports: ['a', 'b'] }, card)

    expect(items.map(item => item.text)).toEqual(['led by scout', 'leads a, b'])
  })

  it('caps a long reports list at three names plus a count', () => {
    const items = botCardMetaItems(
      { name: 'porter' } as RosterRow,
      { leads: [], reports: ['a', 'b', 'c', 'd', 'e'] },
      card
    )

    expect(items.map(item => item.text)).toEqual(['leads a, b, c +2'])
  })

  it('renders nothing when the profile carries no facts', () => {
    expect(botCardMetaItems({ name: 'porter', skill_count: 0 } as RosterRow, none, card)).toEqual([])
    expect(botCardMetaItems(null, none, card)).toEqual([])
    expect(botCardMetaItems({ model: '  ', name: 'porter' } as RosterRow, none, card)).toEqual([])
  })
})
