// Minimal CDP Runtime.evaluate helper for the dev-loop verification.
// Usage: node cdp-eval.mjs <expression>
import WebSocket from '/home/decrux/.hermes/hermes-agent/node_modules/ws/index.js'

const expr = process.argv[2]
const list = await (await fetch('http://127.0.0.1:9344/json/list')).json()
const page = list.find(t => t.type === 'page')
if (!page) { console.error('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
let id = 0
const pending = new Map()
const send = (method, params) => new Promise((res, rej) => {
  const n = ++id
  pending.set(n, { res, rej })
  ws.send(JSON.stringify({ id: n, method, params }))
})
const logs = []
ws.on('message', raw => {
  const m = JSON.parse(raw.toString())
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  } else if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '))
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text))
  }
})
await new Promise(r => ws.on('open', r))
await send('Runtime.enable')
const out = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
console.log(JSON.stringify(out.result?.value ?? out.result, null, 2))
if (logs.length) console.error('\n--- console ---\n' + logs.slice(-40).join('\n'))
ws.close()