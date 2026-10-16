/**
 * Shared helpers for the real-backend reload lane (`e2e/reload/*.reload.spec.ts`).
 *
 * Every spec boots the real Electron app against the checkout's own `hermes serve`
 * (core sandbox, real HOME/HERMES_HOME under a temp root); the only fake is the LLM
 * (`../core/provider.ts`). Run it under Xvfb, serialized with the build lock:
 *   flock /tmp/hermes-build.lock xvfb-run -a -s "-screen 0 1440x900x24" npx playwright test -c e2e/reload/playwright.config.ts
 *
 * `HERMES_E2E_PYTHON` pins the backend interpreter. The desktop backend spawns with
 * PYTHONPATH scrubbed (electron/backend-env.ts), so the interpreter must carry its own
 * site-packages: use the venv `bin/python` of the Hermes environment that
 * `scripts/run-in-hermes-env` activates (its site-packages is the second PYTHONPATH
 * entry; three directories up from it is the venv root). `coreAppEnv` forwards it as
 * HERMES_DESKTOP_PYTHON.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'

import {
  coreAppEnv,
  type CoreSandbox,
  createCoreSandbox,
  launchCoreApp,
  waitForInteractive,
  writeProviderHome
} from '../core/harness'
import { type ScriptedProvider, startScriptedProvider } from '../core/provider'

/** How long Ctrl+R gets to start a navigation before the main-process reload runs. */
const KEY_RELOAD_WINDOW_MS = 3_000

export interface BootOptions {
  /** Extra profiles; each gets its own provider home under `<hermesHome>/profiles/<name>`. */
  profiles?: string[]
  /** Approval policy for turns that exercise the terminal gate. */
  approvals?: 'manual' | 'off'
  /** Seed the sandbox HERMES_HOME before the app (and its backend) boots —
   *  e.g. installing a Hermes plugin the spec exercises. */
  setupHome?: (hermesHome: string) => void
}

export interface RealApp {
  app: ElectronApplication
  page: Page
  box: CoreSandbox
  provider: ScriptedProvider
  close: () => Promise<void>
}

export async function bootReal(label: string, opts: BootOptions = {}): Promise<RealApp> {
  const provider = await startScriptedProvider()
  const box = createCoreSandbox(label)
  let app: ElectronApplication | null = null

  const close = async () => {
    try {
      await app?.close()
    } finally {
      await provider.close()
      box.cleanup()
    }
  }

  try {
    writeProviderHome(box.hermesHome, provider.url, '', opts.approvals ?? 'off')
    opts.setupHome?.(box.hermesHome)

    for (const name of opts.profiles ?? []) {
      writeProviderHome(path.join(box.hermesHome, 'profiles', name), provider.url, '', opts.approvals ?? 'off')
    }

    const launched = await launchCoreApp(coreAppEnv(box))
    app = launched.app
    await waitForInteractive(launched.app, launched.page)

    return { app: launched.app, page: launched.page, box, provider, close }
  } catch (error) {
    await close()
    throw error
  }
}

export type ReloadMethod = 'Control+R' | 'main-process reload'

/**
 * Reloads the window the way Ctrl+R does and waits for the new document to be
 * interactive. The key press goes first; the main-process reload runs only if no
 * navigation starts within KEY_RELOAD_WINDOW_MS. Returns which one ran.
 */
export async function reloadWindow(app: ElectronApplication, page: Page): Promise<ReloadMethod> {
  const keyLoad = page.waitForEvent('load', { timeout: KEY_RELOAD_WINDOW_MS }).then(
    () => true,
    () => false
  )

  await page.keyboard.press('Control+R')

  let method: ReloadMethod = 'Control+R'

  if (!(await keyLoad)) {
    method = 'main-process reload'
    const load = page.waitForEvent('load', { timeout: 60_000 })

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

      if (!win) {
        throw new Error('no window to reload')
      }

      win.webContents.reload()
    })

    await load
  }

  await waitForInteractive(app, page)
  console.log(`[reload] window reloaded with ${method}`)

  return method
}

/** Screenshot into the real home's Videos/next-shots/<step>/ (the test process's home, not the sandbox HOME). */
export async function shot(page: Page, step: string, name: string): Promise<string> {
  const dir = path.join(os.homedir(), 'Videos', 'next-shots', step)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.png`)
  await page.screenshot({ path: file })

  return file
}

/** The `data-rail-entry` keys of the activity rail, in DOM order. */
export async function railEntryKeys(page: Page): Promise<string[]> {
  const rail = page.locator('[data-slot="activity-rail"]')
  await rail.waitFor({ state: 'visible' })

  return rail.locator('[data-rail-entry]').evaluateAll(els => els.map(el => el.getAttribute('data-rail-entry') ?? ''))
}

/**
 * A gateway JSON-RPC call from the renderer over its own socket to the primary
 * backend (the same endpoint the app's gateway client dials; the app does not
 * expose its client on `window`). Used to read backend truth after a reload.
 */
export async function rpc<T = unknown>(page: Page, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const reply = await page.evaluate(
    async ({ method, params }) => {
      const conn = await (window as any).hermesDesktop.getGatewayWsUrl()

      if (!conn?.ok) {
        throw new Error(`no gateway url: ${conn?.error ?? 'unknown'}`)
      }

      return await new Promise<{ error?: { message?: string }; id?: unknown; result?: unknown }>((resolve, reject) => {
        const id = `reload-${Math.random().toString(36).slice(2)}`
        const socket = new WebSocket(conn.wsUrl)

        const timer = setTimeout(() => {
          socket.close()
          reject(new Error(`${method} timed out`))
        }, 30_000)

        socket.onopen = () => socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))

        socket.onerror = () => {
          clearTimeout(timer)
          reject(new Error(`${method}: socket error`))
        }

        socket.onmessage = event => {
          const msg = JSON.parse(String(event.data))

          if (msg.id !== id) {
            return
          }

          clearTimeout(timer)
          socket.close()
          resolve(msg)
        }
      })
    },
    { method, params }
  )

  if (reply.error) {
    throw new Error(`${method}: ${reply.error.message ?? JSON.stringify(reply.error)}`)
  }

  return reply.result as T
}
