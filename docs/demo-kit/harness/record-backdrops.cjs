// Backdrops film footage: the real app in dark mode + vivid strength, one
// continuous take. A local server fronts plugins/backdrops as the manifest so
// thumbs/drops load pre-merge (same paths as the raw.githubusercontent URL).
// usage: node record-backdrops.cjs [dry]
const { boot } = require('./boot-mac.cjs')
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process')
const REPO = '/Users/devin/repos/hermes-agent-contrib'
const PKG = path.join(REPO, 'plugins', 'backdrops')
const DRY = process.argv[2] === 'dry'
const OUT = __dirname + '/raw-backdrops.mp4'
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const MIME = { '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.js': 'text/javascript' }
const server = http.createServer((req, res) => {
  const p = path.join(PKG, decodeURIComponent(req.url.split('?')[0]))
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end('nf'); return }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream',
      'access-control-allow-origin': '*' }) // GitHub raw sends this too; fetch() is CORS-gated
    res.end(d)
  })
}).listen(8100, '127.0.0.1')

const CURSOR_JS = () => {
  if (document.getElementById('demo-cursor')) return
  const s = document.createElement('style')
  s.textContent = `#demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;
    transform:translate(640px,420px);transition:transform .7s cubic-bezier(.22,.9,.24,1);filter:drop-shadow(0 2px 5px rgba(0,0,0,.35))}
    .demo-ripple{position:fixed;z-index:2147483646;pointer-events:none;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;
    background:rgba(34,211,166,.55);animation:demoRipple .6s ease-out forwards}
    @keyframes demoRipple{to{transform:scale(4.2);opacity:0}}`
  document.head.appendChild(s)
  const c = document.createElement('div'); c.id = 'demo-cursor'
  c.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l16 9.5-7.2 1.6L9.6 21z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  document.body.appendChild(c)
}

async function main() {
  const { app, page } = await boot({
    plugins: [{ id: 'backdrops', src: path.join(PKG, 'desktop', 'plugin.js') }]
  })
  for (let t = 0; t < 60; t++) {
    const txt = await page.evaluate(() => document.body.innerText).catch(() => '')
    if (/Good (morning|afternoon|evening)/.test(txt) && t > 3) break
    await sleep(2000)
  }
  await page.getByRole('button', { name: 'No thanks' }).first().click().catch(() => {})
  // Point the gallery at the local manifest, max strength, dark mode — then reload.
  await page.evaluate(() => {
    localStorage.setItem('hermes.plugin.backdrops.manifestUrl', JSON.stringify('http://127.0.0.1:8100/backdrops.json'))
    localStorage.setItem('hermes.desktop.backdrop.strength.v1', 'vivid')
    localStorage.setItem('hermes-desktop-mode-v1', 'dark')
    location.reload()
  })
  for (let t = 0; t < 40; t++) {
    const txt = await page.evaluate(() => document.body.innerText).catch(() => '')
    if (/Good (morning|afternoon|evening)/.test(txt) && t > 2) break
    await sleep(2000)
  }
  await sleep(5000)
  await page.evaluate(CURSOR_JS)

  const markers = []; let t0 = Date.now()
  const mark = name => { markers.push({ name, t: (Date.now() - t0) / 1000 }); console.log('mark', name, markers.at(-1).t) }
  const point = async (loc, dx = 0.5, dy = 0.5) => {
    const b = await loc.boundingBox(); const x = b.x + b.width * dx, y = b.y + b.height * dy
    await page.evaluate(([x, y]) => { document.getElementById('demo-cursor').style.transform = `translate(${x - 3}px,${y - 2}px)` }, [x, y])
    await sleep(780); return { x, y }
  }
  const click = async loc => {
    const { x, y } = await point(loc)
    await page.evaluate(([x, y]) => { const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700) }, [x, y])
    await loc.click({ force: true }); await sleep(500)
  }
  const settingsBtn = () => page.locator('a[href*="settings"],button[aria-label="Settings"]').first()
  const openSettings = async () => {
    await page.evaluate(() => { location.hash = '#/settings?tab=config:appearance' })
    await sleep(1600)
  }
  const goChat = async () => { await page.evaluate(() => { location.hash = '#/' }); await sleep(1800) }
  const galleryCard = () => page.locator('section[aria-label="Backdrop gallery"]')
  const dropTile = cap => galleryCard().locator('button[aria-pressed]', { hasText: cap }).first()
  const shot = async n => DRY && page.screenshot({ path: `${__dirname}/rb_${n}.png` })

  let ff = null
  if (!DRY) {
    ff = cp.spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'avfoundation',
      '-capture_cursor', '1', '-framerate', '30', '-i', 'Capture screen 0:none',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', OUT],
      { stdio: ['pipe', 'inherit', 'inherit'] })
    await sleep(1500)
  }
  mark('start')
  await shot('plain'); await sleep(1200)

  // Reveal the gallery.
  await point(settingsBtn()).catch(() => {})
  await openSettings(); mark('settings')
  const card = galleryCard()
  await card.waitFor({ timeout: 15000 }).catch(() => console.log('no card'))
  await card.scrollIntoViewIfNeeded().catch(() => {})
  await sleep(1400); mark('gallery'); await shot('gallery')

  // Sweep two tiles, then commit Abyssal Garden.
  await point(dropTile('Nebula Drift')).catch(() => {})
  await point(dropTile('Rainline City')).catch(() => {})
  await click(dropTile('Abyssal Garden')); mark('apply1')
  await sleep(600)
  await goChat(); mark('reveal1'); await sleep(2800); await shot('abyssal')

  // Rainline City.
  await openSettings(); await sleep(500)
  await click(dropTile('Rainline City')); mark('apply2')
  await sleep(600)
  await goChat(); mark('reveal2'); await sleep(2400); await shot('rainline')

  // Ember Dunes.
  await openSettings(); await sleep(500)
  await click(dropTile('Ember Dunes')); mark('apply3')
  await sleep(600)
  await goChat(); mark('reveal3'); await sleep(2400); await shot('ember')

  // Your own photo: the upload tile takes a real file (native downscale path).
  await openSettings(); await sleep(400)
  await point(galleryCard().locator('button[aria-pressed]').first()).catch(() => {})
  const fileInput = galleryCard().locator('input[type="file"]').first()
  await page.evaluate(([x, y]) => { const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700) }, await fileInput.boundingBox().then(b => [b.x + 40, b.y + 40]).catch(() => [0, 0]))
  await fileInput.setInputFiles(path.join(__dirname, 'upload-photo.jpg'))
  mark('upload'); await sleep(1800)
  await goChat(); mark('reveal4'); await sleep(2800); await shot('ownphoto')

  // Montage: three rapid tile flips.
  for (const [cap, name] of [['Glowcap Forest', 'm1'], ['Nebula Drift', 'm2'], ['Topo Waves', 'm3']]) {
    await openSettings(); await sleep(300)
    await click(dropTile(cap)); mark('apply_' + name)
    await sleep(400)
    await goChat(); mark('reveal_' + name); await sleep(1600); await shot(name)
  }

  mark('end')
  fs.writeFileSync(__dirname + '/markers-backdrops.json', JSON.stringify(markers, null, 1))
  await sleep(800)
  if (ff) { ff.stdin.write('q'); await new Promise(r => ff.on('close', r)) }
  await app.close()
  server.close()
  console.log('recorded to', OUT)
}
main().catch(e => { console.error(e); process.exit(1) })
