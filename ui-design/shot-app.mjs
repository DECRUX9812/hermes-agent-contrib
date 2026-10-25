// Before/after shots of the real Desktop app (the hot-reload dev server), by skin.
//
//   node ui-design/shot-app.mjs [--url=http://127.0.0.1:5174/] [--out=ui-design/shots] [--port=9344]
//
// Talks to a dedicated headless Chrome (a shared one hits Chrome's per-renderer
// resource cap on a dev page's ~1.5k module requests, and the app never mounts).
//
// Auth: the dev server proxies /api to the gated backend, so the hermes-plus
// session cookie is installed on the dev origin first. The value is read from
// `ui-design/.session-cookie` (written by the login step, 0600, never printed).
//
// The skin is set through the SAME localStorage keys the Appearance picker
// writes, then the page reloads so the boot-time paint uses it. Nothing here is
// faked: real renderer, real backend, real session list.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire('/home/decrux/.hermes/hermes-agent/')
let WebSocket
try {
  WebSocket = require('ws')
} catch {
  WebSocket = (await import('ws')).default
}

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}

const URL = opt('url', 'http://127.0.0.1:5174/')
const OUT = opt('out', 'ui-design/shots')
const PORT = opt('port', '9344')
const sleep = ms => new Promise(r => setTimeout(r, ms))

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = targets.find(t => t.type === 'page')
if (!page) throw new Error(`no page target on :${PORT}`)

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 })
await new Promise((res, rej) => {
  ws.on('open', res)
  ws.on('error', rej)
})

let id = 0
const pending = new Map()
ws.on('message', raw => {
  const m = JSON.parse(raw.toString())
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
})
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id
    pending.set(n, { res, rej })
    ws.send(JSON.stringify({ id: n, method, params }))
  })

const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result?.value
}

await send('Page.enable')
await send('Network.enable')

const host = new globalThis.URL(URL).hostname
const cookie = (await readFile('ui-design/.session-cookie', 'utf8')).trim()
const set = await send('Network.setCookie', {
  name: 'hermes_plus_session',
  value: cookie,
  domain: host,
  path: '/',
  httpOnly: true,
  sameSite: 'Lax'
})
console.log(`cookie for ${host}: ${set.success ? 'installed' : JSON.stringify(set)}`)

/** Wait until React has mounted and the app is past its "waking up" splash. */
async function waitForApp(timeoutMs = 120_000) {
  const started = Date.now()
  let state = { root: 0, text: '' }
  while (Date.now() - started < timeoutMs) {
    try {
      const raw = await evaluate(`JSON.stringify({
        root: document.getElementById('root')?.childElementCount ?? 0,
        text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400)
      })`)
      state = JSON.parse(raw)
    } catch {
      state = { root: 0, text: '' }
    }
    const ready = state.root > 2 && state.text.length > 80 && !/Waking up|Backend connecting/i.test(state.text)
    if (ready) return state
    await sleep(1000)
  }
  return state
}

const SHOTS = [
  { name: 'before-current-light', skin: null, mode: 'light', width: 1440, height: 900 },
  { name: 'after-paper-light', skin: 'paper', mode: 'light', width: 1440, height: 900 },
  { name: 'after-paper-light-1130', skin: 'paper', mode: 'light', width: 1130, height: 820 },
  { name: 'after-paper-dark', skin: 'paper', mode: 'dark', width: 1440, height: 900 }
]

await mkdir(join(OUT, 'app'), { recursive: true })

// `--only=paper` re-captures just the skins whose name matches, so iterating on
// one skin does not re-shoot the whole set.
const only = opt('only', '')
const queue = only ? SHOTS.filter(s => s.name.includes(only)) : SHOTS

for (const shot of queue) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: 1,
    mobile: false
  })

  await send('Page.navigate', { url: URL })
  let state = await waitForApp()

  if (shot.skin) {
    // Seeding localStorage is not enough: the backend announces its own skin on
    // connect and the seed/reload race lets it repaint over the pick. Switch
    // through the app's own imperative door instead — `requestTheme` /
    // `requestMode` are the exact functions the gateway and the picker use, so
    // this is a real switch through the real store, not a DOM hack. Importing the
    // module by its Vite URL hands back the same singleton instance the app holds.
    const switched = await evaluate(`(async () => {
      const theme = await import('/src/themes/request.ts');
      const modeOk = theme.requestMode(${JSON.stringify(shot.mode)}) === undefined;
      const skinOk = theme.requestTheme(${JSON.stringify(shot.skin)});
      return JSON.stringify({ skinOk, modeOk });
    })()`)
    console.log(`  switch: ${switched}`)

    let matched = false
    for (let i = 0; i < 24; i += 1) {
      await sleep(500)
      const now = await evaluate(
        "JSON.stringify([document.documentElement.dataset.hermesTheme, document.documentElement.dataset.hermesMode])"
      )
      const [gotSkin, gotMode] = JSON.parse(now)
      if (gotSkin === shot.skin && gotMode === shot.mode) {
        matched = true
        break
      }
    }

    // The runtime mode switch can lose to a persisted per-profile preference.
    // Fall back to the boot path: write the pick, reload, and let the first
    // paint resolve it (the skin is a built-in, so the backend's announcement
    // is a seed that does not repaint).
    if (!matched) {
      await evaluate(`
        localStorage.setItem('hermes-desktop-theme-v2', ${JSON.stringify(shot.skin)});
        localStorage.setItem('hermes-desktop-mode-v1', ${JSON.stringify(shot.mode)});
        localStorage.setItem('hermes-desktop-profile-themes-v1', JSON.stringify({ default: ${JSON.stringify(shot.skin)} }));
        localStorage.setItem('hermes-desktop-profile-modes-v1', JSON.stringify({ default: ${JSON.stringify(shot.mode)} }));
        'seeded'
      `)
      await send('Page.reload', { ignoreCache: false })
      state = await waitForApp()
      await sleep(2000)
    }
  }

  await sleep(1800)

  const meta = await evaluate(`JSON.stringify({
    theme: document.documentElement.dataset.hermesTheme,
    mode: document.documentElement.dataset.hermesMode,
    bg: getComputedStyle(document.documentElement).getPropertyValue('--dt-background').trim(),
    skinCSS: Boolean(document.getElementById('hermes-desktop-custom-css'))
  })`)

  const png = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: shot.width, height: shot.height, scale: 1 }
  })
  const file = join(OUT, 'app', `${shot.name}.png`)
  await writeFile(file, Buffer.from(png.data, 'base64'))
  console.log(`${file}\n  ${meta}\n  text: ${state.text.slice(0, 120)}`)
}

ws.close()
