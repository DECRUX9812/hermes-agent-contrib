import { chromium } from '/home/user/hermes-agent-contrib/node_modules/playwright-core/index.mjs'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } })
await p.goto('http://127.0.0.1:5301/vertical-overlay.html', { waitUntil: 'networkidle' })
await p.evaluate(() => document.fonts.ready)
await p.screenshot({ path: 'out/vertical-overlay.png', omitBackground: true })
await b.close()
