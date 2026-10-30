/**
 * Offline Bot Mode screenshot harness runner.
 *
 * Serves apps/desktop with the Vite dev server (its own port — the :9120
 * gateway is never touched), loads the botmode preview page that mounts the
 * REAL Bot Mode components with fixture data, and writes PNGs at 1440x900
 * and 1024x768 into preview/botmode/shots/.
 *
 * Re-run from apps/desktop:
 *   node scripts/capture-botmode.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = dirname(here) // apps/desktop
const shotsDir = join(appRoot, 'preview', 'botmode', 'shots')
const PORT = 5177
const PAGE = `http://127.0.0.1:${PORT}/preview/botmode/botmode.html`
const EXPECTED = ['Research', 'Design Room', 'Morning brief', 'Nightly audit']

const viteBin = join(appRoot, '..', '..', 'node_modules', 'vite', 'bin', 'vite.js')

async function waitForServer() {
  const deadline = Date.now() + 120_000
  for (;;) {
    try {
      const res = await fetch(PAGE)
      if (res.ok) return
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`vite dev server never came up on :${PORT}`)
    await new Promise(r => setTimeout(r, 1000))
  }
}

const server = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: appRoot,
  stdio: ['ignore', 'pipe', 'pipe']
})
let serverOutput = ''
server.stdout.on('data', d => {
  serverOutput += String(d)
})
server.stderr.on('data', d => {
  serverOutput += String(d)
})

let failures = []
try {
  await waitForServer()
  const { chromium } = await import('@playwright/test')
  // The repo's pinned Playwright wants a newer headless shell than the cache
  // holds; drive the cached full Chromium instead (screenshots don't care).
  const browser = await chromium.launch({
    executablePath: '/home/decrux/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'
  })

  try {
    const consoleErrors = []
    const pageErrors = []
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => pageErrors.push(String(err)))
    await page.goto(PAGE, { timeout: 180_000, waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      expected => expected.every(s => document.body.innerText.includes(s)),
      EXPECTED,
      { timeout: 60_000 }
    )
    await page.waitForTimeout(1500) // theme paint + avatar/layout settle

    mkdirSync(shotsDir, { recursive: true })
    const wide = join(shotsDir, 'botmode-1440x900.png')
    await page.screenshot({ path: wide })
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.waitForTimeout(800)
    const narrow = join(shotsDir, 'botmode-1024x768.png')
    await page.screenshot({ path: narrow })

    const innerText = await page.evaluate(() => document.body.innerText)
    const theme = await page.evaluate(() => ({
      hermesTheme: document.documentElement.dataset.hermesTheme,
      hermesMode: document.documentElement.dataset.hermesMode
    }))
    const snippet = EXPECTED.map(s => {
      const i = innerText.indexOf(s)
      return i === -1 ? `${s}: MISSING` : `${s}: …${innerText.slice(Math.max(0, i - 60), i + s.length + 60).replace(/\n/g, ' / ')}…`
    })

    console.log(JSON.stringify({ theme, snippet }, null, 2))
    console.log('--- console.errors ---')
    console.log(consoleErrors.length ? consoleErrors.slice(0, 20).join('\n') : '(none)')
    console.log('--- page.errors ---')
    console.log(pageErrors.length ? pageErrors.slice(0, 20).join('\n') : '(none)')

    for (const png of [wide, narrow]) {
      const size = statSync(png).size
      console.log(`${png}: ${size} bytes`)
      if (size <= 20_000) failures.push(`${png} is only ${size} bytes (expected > 20000)`)
    }
    if (consoleErrors.length || pageErrors.length) {
      console.log('NOTE: console/page errors present — see above; screenshots still written.')
    }
  } finally {
    await browser.close()
  }
} catch (err) {
  failures.push(String(err?.stack || err))
  console.log('--- vite output (tail) ---')
  console.log(serverOutput.slice(-4000))
} finally {
  server.kill('SIGTERM')
}

if (failures.length) {
  console.error('FAIL:')
  for (const f of failures) console.error(`- ${f}`)
  process.exit(1)
}
console.log('OK: harness screenshots verified.')
