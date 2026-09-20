/**
 * The New Bot gallery's data layer: starter presets and the
 * describe-your-bot draft generator. Drafts are pure presentation — the
 * contract is that a description always yields an editable form draft with a
 * valid-name suggestion, never a crash or an empty-handed "form".
 */

import { describe, expect, it, vi } from 'vitest'

// The module pulls in ./avatar for shape strings, which imports the SDK —
// same self-returning stub the single-flight test uses so the graph links
// without pinning the SDK surface.
vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  const stub: unknown = new Proxy(function stubbed() {}, {
    apply: () => stub,
    get: (_target, key) => (key === 'then' ? undefined : stub)
  })

  return new Proxy({ atom } as Record<string, unknown>, {
    get: (target, key) =>
      typeof key === 'symbol' || key in target ? target[key as string] : key === 'then' ? undefined : stub,
    has: () => true
  })
})

import { BOT_TEMPLATES, chatStarters, draftFromDescription, suggestedName, templateDraft } from './bot-templates'
import { slugifyProfileName } from './labels'

describe('BOT_TEMPLATES', () => {
  it('ships presets with everything a one-click create needs', () => {
    expect(BOT_TEMPLATES.length).toBeGreaterThanOrEqual(5)

    for (const template of BOT_TEMPLATES) {
      expect(template.id).toBeTruthy()
      expect(template.name).toBeTruthy()
      expect(template.title).toBeTruthy()
      expect(template.tagline).toBeTruthy()
      expect(template.persona).toBeTruthy()
      expect(template.starters).toHaveLength(3)
      expect(template.blob).toBeTruthy()
      // A template name must survive the profile-name slugger.
      expect(slugifyProfileName(template.name)).toBeTruthy()
    }

    // Ids are stable identities — persisted on bot meta.
    expect(new Set(BOT_TEMPLATES.map(t => t.id)).size).toBe(BOT_TEMPLATES.length)
  })

  it('templateDraft pre-fills the form without committing anything', () => {
    const draft = templateDraft(BOT_TEMPLATES[0])

    expect(draft.name).toBe(BOT_TEMPLATES[0].name)
    expect(draft.title).toBe(BOT_TEMPLATES[0].title)
    expect(draft.templateId).toBe(BOT_TEMPLATES[0].id)
    expect(draft.starters).toEqual(BOT_TEMPLATES[0].starters)
    expect(draft.shape).toContain('blobatar')
  })
})

describe('suggestedName', () => {
  it('honors an explicit "named X" clause', () => {
    expect(suggestedName('a code reviewer named Ada who catches edge cases')).toBe('Ada')
  })

  it('derives a title-cased name from the leading words', () => {
    expect(suggestedName('a skeptical code reviewer')).toBe('Skeptical Code Reviewer')
    expect(suggestedName('i need a bot that watches my servers')).toBe('Watches My Servers')
  })

  it('falls back when nothing usable remains', () => {
    expect(suggestedName('!!!')).toBe('Custom Bot')
  })

  it('keeps a suggested name slugable', () => {
    for (const text of ['a skeptical code reviewer', '我的写作助手', 'named Bolt, a fast helper']) {
      expect(slugifyProfileName(suggestedName(text))).toBeTruthy()
    }
  })
})

describe('draftFromDescription', () => {
  it('returns null for empty input', () => {
    expect(draftFromDescription('')).toBeNull()
    expect(draftFromDescription('   ')).toBeNull()
  })

  it('carries the user’s words into the draft', () => {
    const draft = draftFromDescription('a skeptical code reviewer who catches edge cases')!

    expect(draft.name).toBe('Skeptical Code Reviewer')
    expect(draft.description).toBe('a skeptical code reviewer who catches edge cases')
    expect(draft.starters).toHaveLength(3)
    expect(draft.shape).toBe('blobatar')
    expect(draft.templateId).toBeUndefined()
  })
})

describe('chatStarters', () => {
  it('prefers the starters a bot was created with', () => {
    expect(chatStarters({ starters: ['one', 'two'] })).toEqual(['one', 'two'])
  })

  it('falls back to generic starters for hand-made and legacy bots', () => {
    const starters = chatStarters(null)

    expect(starters).toHaveLength(3)
    expect(starters.every(s => s.length > 0)).toBe(true)
    expect(chatStarters({})).toEqual(starters)
    expect(chatStarters({ starters: ['', '  '] })).toEqual(starters)
  })
})
