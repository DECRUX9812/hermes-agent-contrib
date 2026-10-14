import { describe, expect, it, vi } from 'vitest'

// The test setup preloads every catalog; a fresh module instance shows what
// the app sees at boot.
async function freshCatalog() {
  vi.resetModules()

  return import('./catalog')
}

describe('bundled catalogs load on demand', () => {
  it('boots with English only and still recognises every bundled id', async () => {
    const catalog = await freshCatalog()

    expect(catalog.bundledCatalog('en')).toBeTruthy()
    expect(catalog.bundledCatalog('fr')).toBeUndefined()
    expect(catalog.BUNDLED_LOCALES).toEqual(['en', 'zh', 'zh-hant', 'ja', 'ar', 'ru', 'fr', 'de', 'es'])
    expect(catalog.isBundledLocale('fr')).toBe(true)
    expect(catalog.isBundledLocale('pl')).toBe(false)
  })

  it('fetches a catalog once and shares the in-flight request', async () => {
    const catalog = await freshCatalog()
    const first = catalog.loadBundledLocale('de')
    const second = catalog.loadBundledLocale('de')

    expect(second).toBe(first)

    const de = await first

    expect(catalog.bundledCatalog('de')).toBe(de)
    expect(de.common).not.toEqual(catalog.bundledCatalog('en')!.common)
  })

  it('re-resolves translators once a catalog that was not fetched yet lands', async () => {
    vi.resetModules()

    const registry = await import('./registry')
    const catalog = await import('./catalog')
    const before = registry.$appLocaleVersion.get()

    expect(registry.resolveTranslations('ja')).toBe(catalog.bundledCatalog('en'))

    await catalog.loadBundledLocale('ja')
    await Promise.resolve()

    expect(registry.$appLocaleVersion.get()).toBeGreaterThan(before)
    expect(registry.resolveTranslations('ja')).toBe(catalog.bundledCatalog('ja'))
  })
})
