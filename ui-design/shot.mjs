// Full-page screenshot helper for the ui-design review loop.
//
//   node ui-design/shot.mjs <url> <width> <out.png> [--height=900] [--theme=dark]
//
// Chrome's `--screenshot` flag only captures the viewport, so a long preview
// page loses its bottom third and every "is the composer clipped?" question gets
// answered wrong. This drives CDP instead and captures beyond the viewport, so
// the PNG is the whole document at the width asked for.
//
// `--theme=dark` sets `data-theme` on <html> before the shot, for previews whose
// theme is driven by that attribute rather than by prefers-color-scheme.
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const require = createRequire('/home/decrux/.hermes/hermes-agent/')
let WebSocket
try {
  WebSocket = require('ws')
} catch {
  WebSocket = (await import('ws')).default
}

const [, , url, widthArg, out, ...rest] = process.argv
if (!url || !widthArg || !out) {
  console.error('usage: node shot.mjs <url> <width> <out.png> [--height=900] [--theme=dark]')
  process.exit(1)
}

const width = Number(widthArg)
const height = Number((rest.find(a => a.startsWith('--height=')) || '--height=900').split('=')[1])
const theme = (rest.find(a => a.startsWith('--theme=')) || '').split('=')[1]

const sleep = ms => new Promise(r => setTimeout(r, ms))

const CDP_PORT = (rest.find(a => a.startsWith('--port=')) || '--port=9344').split('=')[1]

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const page = targets.find(t => t.type === 'page')
  if (!page) throw new Error(`no page target on :${CDP_PORT}`)
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
  return { send, close: () => ws.close() }
}

const { send, close } = await connect()

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false
})
await send('Page.navigate', { url })
await sleep(2200)

if (theme) {
  await send('Runtime.evaluate', {
    expression: `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`
  })
  await sleep(200)
}

const { contentSize } = await send('Page.getLayoutMetrics')
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width, height: Math.ceil(contentSize.height), scale: 1 }
})

await mkdir(dirname(out), { recursive: true })
await writeFile(out, Buffer.from(shot.data, 'base64'))
console.log(`${out}  ${width}x${Math.ceil(contentSize.height)}${theme ? ` (${theme})` : ''}`)
close()
