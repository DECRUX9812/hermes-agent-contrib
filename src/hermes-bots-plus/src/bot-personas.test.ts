/**
 * Bot personas (G3) — the role one-liner and the accent color.
 *
 * Role invariants:
 *  - An explicit `meta.role` (editable in Edit Profile) always wins.
 *  - Absent it, the subtitle derives from the description's first sentence —
 *    markdown stripped, capped at one line. No description, no line.
 *
 * Accent invariants:
 *  - A picked avatar color IS the accent override — the roster ring, card
 *    tint, and avatar can never disagree because there is only one color.
 *  - Otherwise the accent is deterministic on the bot name (same bot, same
 *    color, every session) and is not one global default for the roster.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  // Deterministic stand-in for the SDK's profileColor — distinct names map to
  // distinct hues, which is all the accent contract needs.
  const profileColor = (name: string) => {
    let h = 2166136261

    for (const ch of String(name)) {
      h ^= ch.charCodeAt(0)
      h = Math.imul(h, 16777619)
    }

    return `#${(h >>> 0).toString(16).padStart(8, '0').slice(2)}`
  }

  return { ...(await pluginSdkMock({})), profileColor }
})

import { botAccentColor } from './avatar'
import { botRole } from './labels'
import type { RosterRow } from './types'

const bot = (name: string, description?: string) => ({ description, name }) as RosterRow

describe('botRole', () => {
  it('an explicit meta role wins over any derivation', () => {
    expect(botRole(bot('alpha', 'Writes reports.'), { role: 'Head of Research' })).toBe('Head of Research')
  })

  it('derives the one-liner from the first sentence of the description', () => {
    expect(botRole(bot('alpha'), { description: 'Triage inbox. Then files bugs.' })).toBe('Triage inbox')
    // Falls back to the roster row's own description when meta has none.
    expect(botRole(bot('alpha', 'Runs the ops board. Across gateways.'))).toBe('Runs the ops board')
  })

  it('strips markdown and caps the line at 60 chars', () => {
    const long = `**Boldly** watches the queue for ${'x'.repeat(80)}`

    expect(botRole(bot('alpha', long)).length).toBeLessThanOrEqual(60)
    expect(botRole(bot('alpha', long))).not.toContain('**')
  })

  it('renders no line when nothing says what the bot is for', () => {
    expect(botRole(bot('alpha'), null)).toBe('')
    expect(botRole(bot('alpha'), { role: '   ' })).toBe('')
  })
})

describe('botAccentColor', () => {
  it('a picked avatar color is the accent override', () => {
    expect(botAccentColor(bot('alpha'), { color: '#123456' })).toBe('#123456')
  })

  it('is deterministic on the bot name and varies across the roster', () => {
    const a = botAccentColor(bot('alpha'), null)
    const aAgain = botAccentColor(bot('alpha'), null)
    const b = botAccentColor(bot('beta'), null)

    expect(a).toBe(aAgain)
    expect(a).not.toBe(b)
  })
})
