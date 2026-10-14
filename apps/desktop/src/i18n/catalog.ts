import { en } from './en'
import type { BundledLocale, Translations } from './types'

// Every non-English catalog is a dynamic import: together they were ~1.8 MB of
// the boot preload set, parsed on every launch to render one language. English
// stays static because it is the fallback every lookup ends on.
const LOADERS: Record<Exclude<BundledLocale, 'en'>, () => Promise<Translations>> = {
  zh: () => import('./zh').then(m => m.zh),
  'zh-hant': () => import('./zh-hant').then(m => m.zhHant),
  ja: () => import('./ja').then(m => m.ja),
  ar: () => import('./ar').then(m => m.ar),
  ru: () => import('./ru').then(m => m.ru),
  fr: () => import('./fr').then(m => m.fr),
  de: () => import('./de').then(m => m.de),
  es: () => import('./es').then(m => m.es)
}

const loaded: Partial<Record<BundledLocale, Translations>> = { en }
const pending = new Map<BundledLocale, Promise<Translations>>()

/** The catalogs compiled into the app, keyed by id. Only English and the
 *  catalogs already fetched through `loadBundledLocale()` are present, so app
 *  code resolves through `bundledCatalog()` / `resolveTranslations()` instead.
 *  The test setup preloads every catalog, which is why tests may index it. */
export const TRANSLATIONS = loaded as Record<BundledLocale, Translations>

export const BUNDLED_LOCALES = ['en', ...Object.keys(LOADERS)] as readonly BundledLocale[]

export function isBundledLocale(value: unknown): value is BundledLocale {
  return typeof value === 'string' && (value === 'en' || Object.hasOwn(LOADERS, value))
}

/** A bundled catalog if it has been fetched, else `undefined`. */
export function bundledCatalog(id: BundledLocale): Translations | undefined {
  return loaded[id]
}

/** Fetch a bundled catalog once; later calls share the same promise. */
export function loadBundledLocale(id: BundledLocale): Promise<Translations> {
  const ready = loaded[id]

  if (ready) {
    return Promise.resolve(ready)
  }

  let promise = pending.get(id)

  if (!promise) {
    promise = LOADERS[id as Exclude<BundledLocale, 'en'>]().then(value => {
      loaded[id] = value
      pending.delete(id)

      return value
    })
    pending.set(id, promise)
    // A failed fetch must not wedge the locale forever; the next ask retries.
    promise.catch(() => pending.delete(id))
  }

  return promise
}

/** Test seam: fetch every bundled catalog so `TRANSLATIONS` is complete. */
export async function preloadBundledLocales(): Promise<void> {
  await Promise.all(BUNDLED_LOCALES.map(loadBundledLocale))

  // Fetches settle in any order; keep key order equal to BUNDLED_LOCALES.
  for (const id of BUNDLED_LOCALES) {
    const value = loaded[id]

    delete loaded[id]
    loaded[id] = value
  }
}
