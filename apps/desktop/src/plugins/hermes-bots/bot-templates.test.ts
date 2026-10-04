/**
 * Bot templates (C1): renderer-local presets for the create dialog.
 *
 * Invariants under test:
 *  - the preset catalog is exactly Researcher / Engineer / Ops / Custom, in
 *    picker order, and `custom` is the blank slate (no skill curation, no
 *    model pin, no soul stub).
 *  - skill curation is a leaf-name match: the catalog may carry
 *    `category/skill` slugs while presets name bare skill dirs.
 *  - a preset NEVER touches the user's name slug — seeding covers
 *    title/description/soul/model/skills only.
 */

import { describe, expect, it } from 'vitest'

import {
  BOT_TEMPLATE_IDS,
  BOT_TEMPLATES,
  disabledSkillNames,
  leafSkillName,
  stagedSkillsForTemplate
} from './bot-templates'

describe('bot template catalog', () => {
  it('ships the four presets in picker order', () => {
    expect(BOT_TEMPLATE_IDS).toEqual(['researcher', 'engineer', 'ops', 'custom'])
  })

  it('seeds a soul stub and a model default on the named presets', () => {
    for (const id of ['researcher', 'engineer', 'ops'] as const) {
      const spec = BOT_TEMPLATES[id]

      expect(spec.soul.trim().length).toBeGreaterThan(0)
      expect(spec.model).toBe('auto')
      expect(spec.provider).toBe('auto')
      expect(spec.skills.length).toBeGreaterThan(0)
    }
  })

  it('custom is the blank slate — nothing curated, nothing pinned', () => {
    const spec = BOT_TEMPLATES.custom

    expect(spec.soul).toBe('')
    expect(spec.skills).toEqual([])
    expect(spec.model).toBe('')
    expect(spec.provider).toBe('')
  })
})

describe('skill curation', () => {
  const catalog = [
    { enabled: true, name: 'arxiv' },
    { enabled: true, name: 'github' },
    { enabled: false, name: 'sdlc-review' }
  ]

  it('leafSkillName unwraps a category slug', () => {
    expect(leafSkillName('research/arxiv')).toBe('arxiv')
    expect(leafSkillName('github')).toBe('github')
  })

  it('enables exactly the suggested set when staging the catalog', () => {
    const staged = stagedSkillsForTemplate(catalog, BOT_TEMPLATES.researcher)

    expect(staged.find(s => s.name === 'arxiv')?.enabled).toBe(true)
    expect(staged.find(s => s.name === 'github')?.enabled).toBe(false)
    expect(staged.find(s => s.name === 'sdlc-review')?.enabled).toBe(false)
  })

  it('returns the untouched catalog for a preset with no curation', () => {
    expect(stagedSkillsForTemplate(catalog, BOT_TEMPLATES.custom)).toBe(catalog)
  })

  it('computes the disabled list for post-create profiles.configure', () => {
    const disabled = disabledSkillNames([{ name: 'arxiv' }, { name: 'github' }], BOT_TEMPLATES.engineer)

    expect(disabled).toEqual(['arxiv'])
  })

  it('returns null when the preset does not curate skills', () => {
    expect(disabledSkillNames([{ name: 'arxiv' }], BOT_TEMPLATES.custom)).toBeNull()
  })
})
