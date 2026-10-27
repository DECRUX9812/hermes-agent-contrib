import { afterEach, describe, expect, it } from 'vitest'

import { setToolCardsTranslator, TOOL_CARDS_LOCALES, toolCardsT } from './tool-cards-i18n'

function shape(node: unknown): unknown {
  if (typeof node === 'function') {
    return 'fn'
  }

  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, shape(value)]).sort())
  }

  return 'str'
}

afterEach(() => setToolCardsTranslator(null))

describe('tool card strings', () => {
  it('ships every locale with the English shape', () => {
    const english = shape(TOOL_CARDS_LOCALES.en)

    for (const [locale, bundle] of Object.entries(TOOL_CARDS_LOCALES)) {
      expect(shape(bundle), locale).toEqual(english)
    }
  })

  it('reads English before the bundle is registered', () => {
    expect(toolCardsT('viewer.openPage')).toBe('Open page')
    expect(toolCardsT('opening', 'example.com')).toContain('example.com')
  })

  it('uses the registered translator, falling back to English for a key it lacks', () => {
    setToolCardsTranslator((key: string) => (key === 'toolCards.working' ? 'Arbeitet' : key))

    expect(toolCardsT('working')).toBe('Arbeitet')
    expect(toolCardsT('viewer.next')).toBe('Next step')
  })
})
