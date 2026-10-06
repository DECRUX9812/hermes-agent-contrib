/**
 * Contract tests for the composer's context chips (architecture §8.8,
 * VAL-CONTEXT-003).
 */

import { describe, expect, it } from 'vitest'

import type { PageContext } from '../protocol'

import { contextChips, domainLabel, SELECTION_CHIP_CHARS, selectionExcerpt } from './composer-chips'

const browserContext = (over: Partial<PageContext> = {}): PageContext => ({
  capturedAt: 1,
  selection: 'Look at this generative shader',
  source: 'hermes-browser',
  title: 'Ada on X: "Look at this generative shader"',
  url: 'http://127.0.0.1:5181/x-post.html',
  ...over
})

describe('domainLabel', () => {
  it('keeps the host and port', () => {
    expect(domainLabel('http://127.0.0.1:5181/x-post.html')).toBe('127.0.0.1:5181')
    expect(domainLabel('https://x.com/ada/status/1')).toBe('x.com')
  })

  it('falls back to the raw value when it does not parse', () => {
    expect(domainLabel('not a url')).toBe('not a url')
  })
})

describe('selectionExcerpt', () => {
  it('trims and keeps short selections intact', () => {
    expect(selectionExcerpt('  hello  ')).toBe('hello')
  })

  it('caps at 140 characters with an ellipsis', () => {
    const excerpt = selectionExcerpt('x'.repeat(200))

    expect(excerpt).toHaveLength(SELECTION_CHIP_CHARS + 1)
    expect(excerpt.endsWith('…')).toBe(true)
  })
})

describe('contextChips', () => {
  it('shows domain, title and quoted selection for an in-app browser page', () => {
    const chips = contextChips(browserContext())

    expect(chips.map(chip => chip.kind)).toEqual(['url', 'title', 'selection'])
    expect(chips[0]).toEqual({ field: 'url', kind: 'url', label: '127.0.0.1:5181' })
    expect(chips[1].label).toBe('Ada on X: "Look at this generative shader"')
    expect(chips[2].label).toBe('“Look at this generative shader”')
  })

  it('quotes only the first 140 characters of a long selection', () => {
    const [chip] = contextChips(browserContext({ selection: 'y'.repeat(300) })).filter(c => c.kind === 'selection')

    expect(chip.label).toBe(`“${'y'.repeat(SELECTION_CHIP_CHARS)}…”`)
  })

  it('drops a removed field and keeps the rest', () => {
    const chips = contextChips(browserContext(), ['url'])

    expect(chips.map(chip => chip.kind)).toEqual(['title', 'selection'])
  })

  it('falls back to the single "No page context" chip once every field is removed', () => {
    const chips = contextChips(browserContext(), ['url', 'title', 'selection'])

    expect(chips).toEqual([{ kind: 'none', label: 'No page context' }])
  })

  it('labels an OS window "title only" with a single removable chip', () => {
    const chips = contextChips({
      app: 'Firefox',
      capturedAt: 1,
      source: 'os-window',
      title: 'Generative shaders — MDN'
    })

    expect(chips).toEqual([{ field: 'title', kind: 'title-only', label: 'Generative shaders — MDN' }])
    expect(contextChips({ app: 'Firefox', capturedAt: 1, source: 'os-window' })).toEqual([
      { field: 'title', kind: 'title-only', label: 'Firefox' }
    ])
  })

  it('shows the single non-removable chip when there is no page context', () => {
    const chips = contextChips({ capturedAt: 1, source: 'none' })

    expect(chips).toEqual([{ kind: 'none', label: 'No page context' }])
    expect(chips[0].field).toBeUndefined()
  })
})
