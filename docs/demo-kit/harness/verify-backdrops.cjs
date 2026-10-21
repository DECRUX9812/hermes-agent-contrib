// E2E verify for the backdrops plugin: boot the real app with the plugin in
// desktop-plugins, point its manifest at a local server, open Settings →
// Appearance, apply a drop, and check the native backdrop store keys.
const { boot } = require('./boot-mac.cjs')
const http = require('http'), fs = require('fs'), path = require('path')
const REPO = '/Users/devin/repos/hermes-agent-contrib'
const PKG = path.join(REPO, 'plugins', 'backdrops')

const MIME = { '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.js': 'text/javascript' }
const server = http.createServer((req, res) => {
  const p = path.join(PKG, decodeURIComponent(req.url.split('?')[0]))
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end('nf'); return }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'access-control-allow-origin': '*' })
    res.end(d)
  })
}).listen(8100, '127.0.0.1')

const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const { app, page } = await boot({ plugins: [{ id: 'backdrops', src: path.join(PKG, 'desktop', 'plugin.js') }] })
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text().slice(0, 240)) })

  // wait for the app shell
  for (let i = 0; i < 40; i++) {
    await sleep(2500)
    const t = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '')
    if (t.trim().length > 40) { console.log('boot text:', JSON.stringify(t.replace(/\s+/g, ' ').slice(0, 140))); break }
  }
  // point the gallery manifest at the local server, then reload so it refreshes
  await page.evaluate(() => {
    localStorage.setItem('hermes.plugin.backdrops.manifestUrl', JSON.stringify('http://127.0.0.1:8100/backdrops.json'))
    location.hash = '#/settings?tab=config:appearance'
  })
  await sleep(2500)
  await page.evaluate(() => location.reload())
  await sleep(9000)
  // Deep-link memory restores the last subpage (page=general); the plugin card
  // mounts only on the top-level appearance view — click the Appearance nav row.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('a,button')].find(e => e.textContent.trim() === 'Appearance')
    if (el) el.click()
  })
  await sleep(3000)

  const info = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('h3')].map(h => h.textContent)
    const imgs = [...document.querySelectorAll('img')].filter(i => i.src.includes('8100')).length
    return { texts, imgs, hash: location.hash, body: document.body.innerText.slice(0, 600) }
  })
  console.log('settings info:', JSON.stringify(info, null, 1).slice(0, 1400))
  await page.screenshot({ path: __dirname + '/verify-appearance.png' })

  // click the gallery refresh button (status → live), then a drop tile
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button[aria-label="Refresh drops"]')]
    if (btns[0]) btns[0].click()
    return btns.length
  })
  console.log('refresh buttons:', clicked)
  await sleep(3000)
  const tiles = await page.evaluate(() => {
    const t = [...document.querySelectorAll('button[aria-pressed]')].filter(b => b.querySelector('img'))
    return t.map(b => ({ pressed: b.getAttribute('aria-pressed'), src: b.querySelector('img').src.slice(-40), cap: b.textContent }))
  })
  console.log('tiles:', JSON.stringify(tiles.slice(0, 12), null, 0))
  // click the second tile (first gallery drop after the photo tile)
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('button[aria-pressed]')].filter(b => b.querySelector('img'))
    const drop = t.find(b => b.querySelector('img').src.includes('8100'))
    if (drop) drop.click()
  })
  await sleep(2500)
  const state = await page.evaluate(() => ({
    scene: localStorage.getItem('hermes.desktop.backdrop.scene.v2'),
    image: (localStorage.getItem('hermes.desktop.backdrop.image.v1') || '').slice(0, 90),
    strength: localStorage.getItem('hermes.desktop.backdrop.strength.v1')
  }))
  console.log('backdrop state:', JSON.stringify(state))
  await page.screenshot({ path: __dirname + '/verify-applied.png' })

  // The applied image should paint behind the chat via the native Backdrop layer.
  await page.evaluate(() => { location.hash = '#/' })
  await sleep(4000)
  const paint = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')]
      .find(d => (d.style.backgroundImage || d.style.background || '').includes('backgrounds/'))
    return el ? (el.style.backgroundImage || el.style.background).slice(0, 120) : null
  })
  console.log('chat backdrop paint:', paint)
  await page.screenshot({ path: __dirname + '/verify-chat.png' })
  await app.close()
  server.close()
})().catch(e => { console.error(e); process.exit(1) })
