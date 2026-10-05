import { hermesApi } from '@/api/client'
import type { HermesReadDirResult, HermesReadFileErrorResult } from '@/global'

// The browser-hosted Desktop's desktop-plugin door.
//
// Electron answers `desktopPluginsRoot` / `readDir` / `readFileText` /
// `readPluginSource` from the main process (apps/desktop/electron/preload.ts:491,
// fs-ipc.ts:121-129). A browser-hosted renderer has no main process, so without
// this module `runtime-loader.ts`'s `diskRoots()` gets `undefined` from
// `window.hermesDesktop?.desktopPluginsRoot?.()` and returns `[]` — every disk
// plugin silently vanishes (no error, no inventory row). Installing the four
// capabilities below over `/api` lets the EXISTING loader run unmodified.
//
// Deliberately the MINIMUM slice: the loader needs a root, a directory read and
// a full-source read. No watch IPC (the loader's 5s poll already covers
// reconciliation — `watchRuntimePlugins` only upgrades to fs watches when
// `watchDirectory` exists, runtime-loader.ts:1002-1029), no install/uninstall,
// no git, no clipboard. Each of those is a separate decision with its own
// security posture.
//
// SECURITY: the backend narrows these routes to `<root>/<name>/plugin.js` (plus
// the `.hermes-package.json` marker) — see
// hermes_cli/web_routers/desktop_plugins.py. A desktop plugin is JavaScript the
// renderer EVALUATES, so any surface handing the browser plugin source is
// equivalent in power to handing it code to run; this module adds no privilege
// Electron's identical IPC does not already have. What it must never do is
// become a general file reader, which is why every call here names a FOLDER
// (single path segment) and a fixed FILENAME — never a caller-supplied path.
//
// Electron stays authoritative: `installBrowserDesktopPluginCapability()` is a
// no-op when a preload bridge already provides `desktopPluginsRoot`, so a
// packaged build can never have its main-process answers overridden.

/** Absolute desktop-plugin root, or '' when the backend has none (the loader's
 *  documented "no disk plugins" signal — runtime-loader.ts:579). */
async function fetchDesktopPluginsRoot(): Promise<string> {
  try {
    const { root } = await hermesApi<{ root?: string }>({ path: '/api/desktop-plugins/root' })

    return root || ''
  } catch {
    // No route / offline backend — degrade to "no disk plugins" exactly like a
    // shell without the capability, rather than throwing inside the scan.
    return ''
  }
}

interface PluginEntriesResponse {
  entries?: HermesReadDirResult['entries']
}

/** Entries of one folder under the root. `name` omitted lists the root itself
 *  (the loader's first readDir, runtime-loader.ts:834); named lists the plugin
 *  folder (the metadata walk at :761). */
async function listDesktopPluginFolder(name?: string): Promise<HermesReadDirResult> {
  const path =
    name === undefined
      ? '/api/desktop-plugins/list'
      : `/api/desktop-plugins/list?name=${encodeURIComponent(name)}`

  const response = await hermesApi<PluginEntriesResponse>({ path })

  return { entries: response.entries || [] }
}

interface PluginSourceResponse {
  byteSize?: number
  text?: string
}

/** A completed read carries the full text; `ok: false` is the structured
 *  "not on disk" answer. `ok` is the discriminant both call sites narrow on. */
type PluginSourceRead = { ok: false } | { byteSize: number; ok: true; text: string }

/** Full, untruncated source of one allowlisted file in one plugin folder.
 *  Returns the loader's structured "not on disk" result instead of rejecting so
 *  a folder that vanished mid-scan reads as absence (readPackageMarker already
 *  try/catches, loadDiskPlugin treats a rejection as unloadable). */
async function readDesktopPluginSource(
  name: string,
  file: '.hermes-package.json' | 'plugin.js'
): Promise<PluginSourceRead> {
  try {
    const response = await hermesApi<PluginSourceResponse>({
      path: `/api/desktop-plugins/source?name=${encodeURIComponent(name)}&file=${encodeURIComponent(file)}`
    })

    if (typeof response.text !== 'string') {
      return { ok: false }
    }

    return { ok: true, byteSize: response.byteSize ?? response.text.length, text: response.text }
  } catch {
    return { ok: false }
  }
}

/** Split `<root>/<name>[/<file>]` back into its parts. Returns null for a path
 *  that is not under the root, so an absolute path from anywhere else can never
 *  be turned into a request for an arbitrary folder. */
function splitUnderRoot(root: string, path: string): null | { file?: string; name?: string } {
  const normalizedRoot = root.replace(/\/+$/, '')

  if (!normalizedRoot || !path.startsWith(`${normalizedRoot}/`)) {
    return null
  }

  const segments = path.slice(normalizedRoot.length + 1).split('/')

  if (segments.length === 1) {
    return { name: segments[0] }
  }

  if (segments.length === 2) {
    return { file: segments[1], name: segments[0] }
  }

  return null
}

/**
 * The resolved root for this install, or '' when the backend has none.
 *
 * Cached because the loader calls readDir once per folder (runtime-loader.ts:761)
 * and a per-call /api round trip per folder would be wasteful. VALIDATED on
 * every read: a path outside the cached root re-resolves once, so a root that
 * changed under a long-lived session (or a second install) can never make a
 * legitimate path look like an escape — and vice versa. Electron re-resolves
 * the root on every pass (fs-ipc.ts:121-127); this is the cheap equivalent.
 */
let installedRoot = ''

/** The root to answer path-scoped reads against: the cache when `path` sits
 *  under it, otherwise a freshly resolved one. */
async function rootFor(path: string): Promise<string> {
  const cached = installedRoot

  if (cached && (path === cached.replace(/\/+$/, '') || splitUnderRoot(cached, path))) {
    return cached
  }

  const fresh = await fetchDesktopPluginsRoot()

  installedRoot = fresh

  return fresh
}

export interface BrowserDesktopPluginCapability {
  desktopPluginsRoot: () => Promise<string>
  /** Only the desktop-plugin root is served here; anything else is refused
   *  rather than forwarded to a general fs read. */
  readDir: (path: string) => Promise<HermesReadDirResult>
  readFileText: (path: string) => Promise<HermesReadFileErrorResult | { text: string }>
  /** Untruncated full-source read (global.d.ts:335-338). Preferring this over
   *  readFileText is what keeps a >512 KiB plugin from being evaluated
   *  truncated (runtime-loader.ts:670-690). */
  readPluginSource: (path: string) => Promise<{ text: string }>
  /** No fs watch on a browser host. The loader only uses this to react to
   *  change TICKS; with none arriving it keeps its visibility-gated poll
   *  (runtime-loader.ts:1038-1052), so this must EXIST or `watchRuntimePlugins`
   *  throws before its first scan (runtime-loader.ts:979). */
  onPreviewFileChanged: (listener: (payload: { id: string }) => void) => void
}

function createCapability(): BrowserDesktopPluginCapability {
  return {
    async desktopPluginsRoot() {
      const root = await fetchDesktopPluginsRoot()

      installedRoot = root

      return root
    },

    onPreviewFileChanged: () => {
      // Nothing to report: the loader's poll owns reconciliation here.
    },

    async readDir(path: string) {
      const root = await rootFor(path)

      if (!root) {
        return { entries: [] }
      }

      if (path.replace(/\/+$/, '') === root.replace(/\/+$/, '')) {
        return listDesktopPluginFolder()
      }

      const under = splitUnderRoot(root, path)

      if (!under?.name) {
        // Outside the plugin root — the loader treats a throw here as "skip
        // this folder and retry next tick" (runtime-loader.ts:836, :848).
        throw new Error('Path outside the desktop plugins root')
      }

      return listDesktopPluginFolder(under.name)
    },

    async readFileText(path: string) {
      const root = await rootFor(path)

      const under = root ? splitUnderRoot(root, path) : null

      if (!under?.name || !under.file) {
        return { ok: false, error: 'ENOENT', message: 'Path outside the desktop plugins root' }
      }

      const source = await readDesktopPluginSource(under.name, under.file as '.hermes-package.json')

      return source.ok ? { text: source.text } : { ok: false, error: 'ENOENT', message: 'File not found' }
    },

    async readPluginSource(path: string) {
      const root = await rootFor(path)

      const under = root ? splitUnderRoot(root, path) : null

      if (!under?.name || under.file !== 'plugin.js') {
        return { text: '' }
      }

      const source = await readDesktopPluginSource(under.name, 'plugin.js')

      return { text: source.ok ? source.text : '' }
    }
  }
}

/** Define the desktop-plugin capabilities over `/api` when nothing else has.
 *
 *  Returns true when the capability was installed, false when an existing
 *  bridge already answered (Electron, or a second install) and nothing was
 *  touched. Idempotent.
 */
export function installBrowserDesktopPluginCapability(): boolean {
  const desktop = window.hermesDesktop as (Window['hermesDesktop'] & Record<string, unknown>) | undefined

  // Electron is authoritative: never shadow a preload bridge that already
  // resolves the root (or already defines these functions).
  if (desktop?.desktopPluginsRoot) {
    return false
  }

  // A second install must not inherit the first install's cached root.
  installedRoot = ''

  if (!desktop) {
    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {}
  }

  const capability = createCapability()
  const target = window.hermesDesktop as unknown as Record<string, unknown>

  for (const [key, value] of Object.entries(capability)) {
    target[key] = value
  }

  return true
}
