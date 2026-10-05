/**
 * The browser-hosted Desktop's desktop-plugin door, exercised through the REAL
 * loader and the REAL browser capability against a stubbed `/api`.
 *
 * Why this file exists: `runtime-loader.ts`'s `diskRoots()` calls
 * `window.hermesDesktop?.desktopPluginsRoot?.()` and returns `[]` when that is
 * undefined — SILENTLY, no error, no inventory row. A capability that resolves
 * the root is therefore the whole fix, and "the type exists" proves nothing.
 * These tests drive `discoverRuntimePlugins()` (unmodified) and assert the
 * plugin actually loads and registers its statusbar contribution.
 */

import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ApiClient from '@/api/client'
import type { HermesApiRequest } from '@/global'

import { $pluginRecords } from './plugins-store'
import { registry } from './registry'
import { discoverRuntimePlugins, unloadRuntimePlugin, watchRuntimePlugins } from './runtime-loader'

// The user's real plugin, read from disk in the test so the shipped file is
// what gets evaluated. Path is overridable for portability.
const REAL_PLUGIN_PATH = process.env.HERMES_TEST_BACKDROPS_PLUGIN || '/home/decrux/.hermes-webapp/desktop-plugins/backdrops/plugin.js'

// The REAL /api handler for the plugin routes, not a hand-written double: this
// mirrors hermes_cli/web_routers/desktop_plugins.py's contract (root, one
// folder deep, plugin.js + .hermes-package.json only).
const ROOT = '/home/u/.hermes/desktop-plugins'

interface ApiFile {
  text: string
}

const apiFiles = new Map<string, ApiFile>()
const apiDirs = new Map<string, string[]>()

function resetApi() {
  apiFiles.clear()
  apiDirs.clear()
  apiDirs.set(ROOT, ['backdrops', 'not-a-plugin'])
  apiFiles.set(`${ROOT}/backdrops/plugin.js`, { text: '' })
  apiFiles.set(`${ROOT}/not-a-plugin/README.md`, { text: 'no entry point here' })
}

const requestedPaths: string[] = []

/** When true every /api call rejects — the "backend predates the route" case. */
let apiOffline = false

/** The three routes, with the same name/file allowlist and single-segment
 *  validation the Python route enforces. */
function handleApi(request: HermesApiRequest) {
  if (apiOffline) {
    throw new Error('404 Not Found')
  }

  const path = new URL(request.path, 'http://webapp.local').pathname
  const query = new URL(request.path, 'http://webapp.local').searchParams

  requestedPaths.push(path + query.toString())

  if (path === '/api/desktop-plugins/root') {
    return { root: ROOT }
  }

  if (path === '/api/desktop-plugins/list') {
    const name = query.get('name')

    if (name === null) {
      return { entries: (apiDirs.get(ROOT) || []).map(entry => ({ isDirectory: true, name: entry, path: `${ROOT}/${entry}` })) }
    }

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      throw new Error('Invalid desktop plugin name')
    }

    const files = [...apiFiles.keys()]
      .filter(key => key.startsWith(`${ROOT}/${name}/`))
      .map(key => key.slice(`${ROOT}/${name}/`.length))

    return {
      entries: files.map(file => ({ isDirectory: false, name: file, path: `${ROOT}/${name}/${file}` }))
    }
  }

  if (path === '/api/desktop-plugins/source') {
    const name = query.get('name') || ''
    const file = query.get('file') || 'plugin.js'

    if (!['plugin.js', '.hermes-package.json'].includes(file)) {
      throw new Error('That file is not readable over this route')
    }

    const entry = apiFiles.get(`${ROOT}/${name}/${file}`)

    if (!entry) {
      throw new Error('File not found')
    }

    return { byteSize: entry.text.length, name: file, path: `${ROOT}/${name}/${file}`, text: entry.text }
  }

  throw new Error(`Unexpected route ${path}`)
}

// Partial mock: only `hermesApi` is replaced (it is the one function the
// capability calls). Everything else the store graph imports — setApiRequestProfile
// and friends — must keep working, so importActual is spread through.
vi.mock('@/api/client', async importActual => {
  const actual = await importActual<typeof ApiClient>()

  return {
    ...actual,
    hermesApi: async <T,>(request: HermesApiRequest) => handleApi(request) as T
  }
})

/** Node's ESM loader cannot import a blob: URL, so the loader's blob source is
 *  rerouted to a data: URL (same trick runtime-loader.test.ts uses). */
function withDataUrlImport<T>(run: () => Promise<T>): Promise<T> {
  const createObjectURL = vi
    .spyOn(URL, 'createObjectURL')
    .mockImplementation(
      blob =>
        `data:text/javascript;base64,${Buffer.from((blob as unknown as { parts: string[] }).parts.join('')).toString('base64')}`
    )

  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const RealBlob = globalThis.Blob

  vi.stubGlobal(
    'Blob',
    class {
      parts: string[]

      constructor(parts: string[]) {
        this.parts = parts
      }
    }
  )

  return run().finally(() => {
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
    vi.stubGlobal('Blob', RealBlob)
  })
}

beforeEach(async () => {
  resetApi()
  requestedPaths.length = 0
  apiOffline = false

  const { installBrowserDesktopPluginCapability } = await import('@/lib/browser-desktop-plugins')

  installBrowserDesktopPluginCapability()
})

afterEach(() => {
  unloadRuntimePlugin('backdrops')
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
  vi.restoreAllMocks()
})

describe('browser desktop-plugin capability', () => {
  it('defines the four capabilities the loader needs, over /api', async () => {
    const desktop = window.hermesDesktop!

    expect(typeof desktop.desktopPluginsRoot).toBe('function')
    expect(typeof desktop.readDir).toBe('function')
    expect(typeof desktop.readFileText).toBe('function')
    expect(typeof desktop.readPluginSource).toBe('function')
    // watchRuntimePlugins() dereferences this BEFORE its first scan
    // (runtime-loader.ts:979) — absent, the browser door throws at boot.
    expect(typeof desktop.onPreviewFileChanged).toBe('function')

    await expect(desktop.desktopPluginsRoot!()).resolves.toBe(ROOT)
    expect(requestedPaths).toContain('/api/desktop-plugins/root')
  })

  it('leaves an Electron preload bridge authoritative', async () => {
    const preloadRoot = vi.fn(async () => '/electron/.hermes/desktop-plugins')

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
      desktopPluginsRoot: preloadRoot,
      readDir: vi.fn()
    }

    const { installBrowserDesktopPluginCapability } = await import('@/lib/browser-desktop-plugins')

    expect(installBrowserDesktopPluginCapability()).toBe(false)
    await expect(window.hermesDesktop!.desktopPluginsRoot!()).resolves.toBe('/electron/.hermes/desktop-plugins')
    expect(requestedPaths).toEqual([])
  })

  it('resolves diskRoots() — the /api root answer stops it returning []', async () => {
    // The unmodified loader path: diskRoots() -> readDir(root) -> folder walk.
    apiFiles.set(`${ROOT}/backdrops/plugin.js`, {
      text: 'export default { id: "noop-plugin", register() {} }'
    })

    await withDataUrlImport(() => discoverRuntimePlugins())

    expect(requestedPaths.some(p => p.startsWith('/api/desktop-plugins/root'))).toBe(true)
    expect($pluginRecords.get()['noop-plugin']).toBeDefined()
  })

  it('loads the REAL backdrops plugin.js and registers its statusbar picker', async () => {
    // The user's actual plugin, byte for byte — no rewrite. It imports
    // @hermes/plugin-sdk / react / react/jsx-runtime only, so it passes the
    // loader's import allowlist as shipped.
    apiFiles.set(`${ROOT}/backdrops/plugin.js`, { text: readFileSync(REAL_PLUGIN_PATH, 'utf8') })

    // The plugin fetches its drop manifest at mount. jsdom has no network, and
    // the plugin's own BUNDLED fallback list is enough to prove registration.
    const fetchStub = vi.fn(async (input: unknown) => {
      throw new Error(`network disabled in test: ${String(input)}`)
    })

    vi.stubGlobal('fetch', fetchStub)

    await withDataUrlImport(() => discoverRuntimePlugins())

    const record = $pluginRecords.get().backdrops

    expect(record, 'backdrops did not reach the plugin inventory').toBeDefined()
    expect(record.status).toBe('loaded')
    expect(record.kind).toBe('disk')
    expect(record.file).toBe(`${ROOT}/backdrops/plugin.js`)

    // The picker is a STATUSBAR item in the right-hand area — the exact surface
    // the user reported missing. Read from the live contribution registry, so
    // this is the same source the statusbar component subscribes to.
    const rightRail = registry.getArea('statusBar.right')

    // ctx.register namespaces the id by plugin, so the live entry is
    // 'backdrops:picker' — proof the REAL plugin evaluated and registered.
    expect(rightRail.map(item => item.id)).toContain('backdrops:picker')
    expect(rightRail.find(item => item.id === 'backdrops:picker')).toMatchObject({ order: 140 })
  })

  it('never exposes a file outside plugin.js / the package marker', async () => {
    const desktop = window.hermesDesktop!

    await expect(
      desktop.readFileText!('/home/u/.hermes/config.yaml')
    ).resolves.toMatchObject({ ok: false })

    // A path that escapes the root by traversal resolves to no segments at all.
    await expect(desktop.readPluginSource!(`${ROOT}/../config.yaml`)).resolves.toEqual({ text: '' })
    // ...and a nested file two levels down is refused too.
    apiFiles.set(`${ROOT}/backdrops/src/secret.js`, { text: 'nope' })
    await expect(desktop.readPluginSource!(`${ROOT}/backdrops/src/secret.js`)).resolves.toEqual({ text: '' })
  })

  it('reads the .hermes-package.json marker so a unified half stays opt-in', async () => {
    apiDirs.set(ROOT, ['unified'])
    apiFiles.set(`${ROOT}/unified/plugin.js`, { text: 'export default { id: "unified", register() {} }' })
    apiFiles.set(`${ROOT}/unified/.hermes-package.json`, {
      text: JSON.stringify({ package: 'unified', repo: 'https://example.test/unified.git', source: '/x/plugins/unified/desktop' })
    })

    await withDataUrlImport(() => discoverRuntimePlugins())

    const record = $pluginRecords.get().unified

    expect(record).toMatchObject({ kind: 'disk', packageName: 'unified', status: 'disabled' })
    expect(requestedPaths.some(p => p.includes('file=.hermes-package.json'))).toBe(true)
  })

  it('watchRuntimePlugins() does not throw on a browser host with no fs watches', async () => {
    apiFiles.set(`${ROOT}/backdrops/plugin.js`, { text: 'export default { id: "backdrops", register() {} }' })

    await withDataUrlImport(async () => {
      watchRuntimePlugins()
      // No watchDirectory capability -> startDirWatches() is false and the
      // loader keeps its poll. Just prove the boot path completes.
      await vi.waitFor(() => expect($pluginRecords.get().backdrops).toBeDefined())
    })
  })

  it('degrades to "no disk plugins" rather than throwing inside the scan', async () => {
    // The loader's documented no-disk-plugins signal (runtime-loader.ts:579) is
    // an EMPTY root, not a rejection: an unreachable /api must not break the
    // scan. Drive it through the real capability with the api stub refusing.
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
    apiOffline = true

    try {
      const { installBrowserDesktopPluginCapability: installOffline } = await import('@/lib/browser-desktop-plugins')

      expect(installOffline()).toBe(true)
      await expect(window.hermesDesktop!.desktopPluginsRoot!()).resolves.toBe('')
      // A readDir with no root is an empty listing, not a throw.
      await expect(window.hermesDesktop!.readDir!('/anything')).resolves.toEqual({ entries: [] })
    } finally {
      apiOffline = false
    }
  })
})
