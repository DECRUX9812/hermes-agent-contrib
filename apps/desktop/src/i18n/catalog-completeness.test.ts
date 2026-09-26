import { describe, expect, it } from 'vitest'

import { TRANSLATIONS } from './catalog'
import { deOverrides } from './de'
import { esOverrides } from './es'
import { frOverrides } from './fr'
import type { Locale } from './types'

// Locales that shipped fully translated. They are `defineLocale` overlays like
// ja/ru, so an English key added later falls back to English instead of
// failing typecheck; these checks keep the translated copy structurally sound.
const COMPLETE_LOCALES = ['fr', 'de', 'es'] as const satisfies readonly Locale[]
const completeOverrides = { fr: frOverrides, de: deOverrides, es: esOverrides }

type Leaf = { path: string; value: unknown }

function leaves(value: unknown, path = ''): Leaf[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key))
  }

  return [{ path, value }]
}

// Arguments that are identifiers rather than display text; translations
// branch on them (`capability === 'search' ? … : …`) instead of echoing them.
const IDENTIFIER_ARGS: Record<string, number[]> = {
  'settings.toolsets.webCapabilitySelectedMessage': [1]
}

const kindOf = (value: unknown) => (Array.isArray(value) ? 'array' : typeof value)

// `intro` is display-only: English lives in intro-copy.jsonl, so its catalog
// entry is an empty shell. intro.test.tsx covers the translated rotation.
const catalogLeaves = (locale: Locale) =>
  new Map(
    leaves(TRANSLATIONS[locale])
      .filter(leaf => !leaf.path.startsWith('intro.'))
      .map(leaf => [leaf.path, leaf.value])
  )

const english = catalogLeaves('en')

it.each(['de', 'es', 'fr', 'ja', 'ru', 'zh', 'zh-hant', 'ar'] as const)(
  '%s renders localized retirement copy instead of English fallback',
  locale => {
    expect(TRANSLATIONS[locale].updates.discontinuedTitle).not.toBe(TRANSLATIONS.en.updates.discontinuedTitle)
    expect(TRANSLATIONS[locale].updates.discontinuedBody).not.toBe(TRANSLATIONS.en.updates.discontinuedBody)
  }
)

describe.each(COMPLETE_LOCALES)('%s desktop catalog', locale => {
  const catalog = catalogLeaves(locale)

  it('keeps Updates copy in the locale overlay rather than falling back to English', () => {
    expect(Object.keys(completeOverrides[locale].updates).sort()).toEqual(Object.keys(TRANSLATIONS.en.updates).sort())
  })

  it('covers exactly the English key set with matching value kinds', () => {
    expect([...catalog.keys()].sort()).toEqual([...english.keys()].sort())

    for (const [path, value] of english) {
      expect({ path, kind: kindOf(catalog.get(path)) }).toEqual({ path, kind: kindOf(value) })
    }
  })

  it('keeps every interpolated argument that English renders', () => {
    for (const [path, value] of english) {
      if (typeof value !== 'function') {
        continue
      }

      const translated = catalog.get(path) as (...args: unknown[]) => unknown
      const probes = Array.from({ length: value.length }, (_, index) => `⟦${index}⟧`)
      let englishOut: string

      try {
        englishOut = JSON.stringify(value(...probes))
      } catch {
        continue // needs structured arguments; the type checker covers the signature
      }

      expect(translated.length, path).toBe(value.length)
      const translatedOut = JSON.stringify(translated(...probes))

      const identifiers = new Set(IDENTIFIER_ARGS[path]?.map(index => probes[index]))

      for (const probe of probes.filter(probe => englishOut.includes(probe) && !identifiers.has(probe))) {
        expect(translatedOut, `${path} drops ${probe}`).toContain(probe)
      }
    }
  })

  it('keeps list-shaped copy the same length as English', () => {
    for (const [path, value] of english) {
      if (Array.isArray(value)) {
        expect((catalog.get(path) as unknown[]).length, path).toBe(value.length)
      }
    }
  })
})

// Partial locales merge English under their overrides, so a *new* key ships
// silently untranslated. This ratchet pins the translated-leaf count: it may
// only rise. When a PR adds English copy, either translate it in the partial
// locales or bump the baseline after weighing the visible cost — never let it
// drift down unnoticed.
const PARTIAL_LOCALE_BASELINE = { ar: 3149, ja: 3486, 'zh-hant': 4389 } as const satisfies Partial<
  Record<Locale, number>
>

describe.each(Object.keys(PARTIAL_LOCALE_BASELINE) as (keyof typeof PARTIAL_LOCALE_BASELINE)[])(
  '%s partial locale coverage ratchet',
  locale => {
    it('does not lose translated strings', () => {
      const catalog = catalogLeaves(locale)
      let translated = 0

      for (const [path, value] of catalog) {
        // An untranslated leaf is the SAME value reference the merge filled in
        // from English — works for strings, functions, and arrays alike.
        if (catalog.get(path) !== undefined && !english.has(path)) {
          continue
        }

        if (value !== english.get(path)) {
          translated += 1
        }
      }

      expect(translated).toBeGreaterThanOrEqual(PARTIAL_LOCALE_BASELINE[locale])
    })
  }
)
