// Teknium special footage ("We heard you"), recorded in the REAL desktop app at 1.5x (1920x1200 px).
// VS Code beside the chat, Hermes edits the project, then the same chat continues in Hermes CLI.
// usage: node record4.cjs [dry]   (dry: no capture, saves v_*.png)
const { boot } = require('./boot.cjs')
const cp = require('child_process'), fs = require('fs'), path = require('path')
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const OUT = __dirname + '/raw5.mp4', DRY = process.argv[2] === 'dry'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const CURSOR_JS = () => {
  if (document.getElementById('demo-cursor')) return
  const s = document.createElement('style')
  s.textContent = `#demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;
    transform:translate(640px,420px);transition:transform .7s cubic-bezier(.22,.9,.24,1);filter:drop-shadow(0 2px 5px rgba(0,0,0,.35))}
    .demo-ripple{position:fixed;z-index:2147483646;pointer-events:none;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;
    background:rgba(124,92,255,.5);animation:demoRipple .6s ease-out forwards}
    @keyframes demoRipple{to{transform:scale(4.2);opacity:0}}`
  document.head.appendChild(s)
  const c = document.createElement('div'); c.id = 'demo-cursor'
  c.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l16 9.5-7.2 1.6L9.6 21z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  document.body.appendChild(c)
}

async function main() {
  const { app, page, home } = await boot({ hire: true, scale: 1.2, W: 1920, H: 1200 })
  for (let t = 0; t < 60; t++) {
    const txt = await page.evaluate(() => document.body.innerText).catch(() => '')
    if (/Good (morning|afternoon|evening)/.test(txt) && t > 3) break
    await sleep(2000)
  }
  await page.getByRole('button', { name: 'No thanks' }).first().click().catch(() => {})
  // A small site for Hermes and VS Code to work on together.
  const proj = path.join(path.dirname(home), 'projects', 'launch-site')
  fs.writeFileSync(path.join(proj, 'index.html'), '<!doctype html>\n<title>Launch</title>\n<button id="theme-toggle">Theme</button>\n<script type="module" src="theme.js"></script>\n')
  fs.writeFileSync(path.join(proj, 'styles.css'), ':root { color-scheme: light dark }\n[data-theme=dark] body { background: #0b0d12; color: #e8e8ea }\n')
  fs.writeFileSync(path.join(proj, 'README.md'), '# Launch site\n\nThe page for Thursday.\n')
  await sleep(6000) // MCP discovery + backend warm + plugin load
  // The thread gets the full width, so the floating Pulse pane sits beside it, not on it.
  await page.getByRole('button', { name: 'Hide sidebar' }).first().click().catch(() => console.log('no sidebar toggle'))
  await sleep(800)
  await page.evaluate(CURSOR_JS)
  const markers = []; let t0 = 0
  const mark = name => { markers.push({ name, t: (Date.now() - t0) / 1000 }); console.log('mark', name, markers.at(-1).t) }
  const point = async (loc, dx = 0.5, dy = 0.5) => {
    const b = await loc.boundingBox(); if (!b) throw new Error('no box'); const x = b.x + b.width * dx, y = b.y + b.height * dy
    await page.evaluate(([x, y]) => { document.getElementById('demo-cursor').style.transform = `translate(${x - 3}px,${y - 2}px)` }, [x, y])
    await sleep(750); return { x, y }
  }
  const click = async loc => {
    const { x, y } = await point(loc)
    await page.evaluate(([x, y]) => { const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700) }, [x, y])
    await loc.click({ force: true }); await sleep(400)
  }
  const shot = async n => DRY && page.screenshot({ path: `${__dirname}/k_${n}.png` })
  const waitText = async (text, ms = 60000) => page.getByText(text, { exact: false }).last().waitFor({ timeout: ms }).catch(() => console.log('missing:', text))
  let ff = null
  if (!DRY) {
    ff = cp.spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30', '-video_size', '1920x1200',
      '-i', process.env.DISPLAY + '.0+0,0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', OUT], { stdio: ['pipe', 'inherit', 'inherit'] })
    await sleep(1500)
  }
  t0 = Date.now(); mark('start')

  // 1. Into the project.
  await click(page.getByText('Launch site', { exact: true }).last()); mark('project'); await sleep(2500); await shot('project')
  // 2. One click: VS Code + terminal beside the chat.
  await click(page.getByRole('button', { name: 'Panels' }).first()); await sleep(900)
  await click(page.locator('[data-arrangement="code"]').first()); mark('arranged')
  await page.mouse.click(300, 700)
  await waitText('VS Code', 15000); await sleep(9000); mark('vscode_ready'); await shot('vscode')
  // 3. Hermes edits the project; the file lands in VS Code.
  const composer = page.getByRole('textbox').first()
  await click(composer); await composer.pressSequentially('Add a dark mode toggle to the site.', { delay: 42 }); await sleep(400)
  await page.keyboard.press('Enter'); mark('ask_sent')
  await waitText('open in VS Code next to us'); mark('edit_done'); await sleep(4000); await shot('edited')
  // 4. Same chat, in Hermes CLI.
  await click(page.getByRole('button', { name: 'Hermes CLI' }).first()); mark('cli_open')
  if (process.env.CLI_WARM) { await sleep(Number(process.env.CLI_WARM)) }
  await sleep(9000); await shot('cli')
  await click(page.locator('.xterm').last()); await page.keyboard.type('Now write the tests for it.', { delay: 55 }); await sleep(400)
  await page.keyboard.press('Enter'); mark('cli_sent')
  await sleep(9000); await shot('cli_done'); mark('end')

  if (ff) { ff.stdin.write('q'); await new Promise(r => ff.on('close', r)) }
  fs.writeFileSync(__dirname + '/markers5.json', JSON.stringify({ markers }, null, 1))
  await app.close()
}
main().catch(e => { console.error(e); process.exit(1) })
