/**
 * G6 — the marketplace stub's starter-set contract:
 *   1. every starter card maps to a real template (an 'Add bot' that seeds
 *      nothing is a dead card);
 *   2. 'custom' is never installable — it is the blank slate the New bot
 *      menu item already is.
 */

import { describe, expect, it } from 'vitest'

import { BOT_TEMPLATES } from './bot-templates'
import { MARKET_STARTER_IDS } from './marketplace-dialog'

describe('marketplace starter set', () => {
  it('covers exactly the non-custom templates', () => {
    expect(MARKET_STARTER_IDS).toEqual(['researcher', 'engineer', 'ops'])

    for (const id of MARKET_STARTER_IDS) {
      expect(BOT_TEMPLATES[id]).toBeTruthy()
    }

    expect(MARKET_STARTER_IDS).not.toContain('custom')
  })
})
