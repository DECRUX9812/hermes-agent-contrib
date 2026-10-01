// v2 film footage ("We heard you"), recorded in the REAL desktop app at 1.5x (1920x1200 px).
// Hermes answers six complaints with live plugins: Synthwave reskin, an in-chat focus timer,
// a Pulse remix by talking to it, an editable flow, a Spend page, and Mission Control over busy chats.
// usage: node record4.cjs [dry]   (dry: no capture, saves v_*.png)
const { boot } = require('./boot.cjs')
const cp = require('child_process'), fs = require('fs'), path = require('path')
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const OUT = __dirname + '/raw4.mp4', DRY = process.argv[2] === 'dry'
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
  const { app, page, home } = await boot({ hire: true, history: true, scale: 1.5, W: 1920, H: 1200 })
  for (let t = 0; t < 60; t++) {
    const txt = await page.evaluate(() => document.body.innerText).catch(() => '')
    if (/Good (morning|afternoon|evening)/.test(txt) && t > 3) break
    await sleep(2000)
  }
  await page.getByRole('button', { name: 'No thanks' }).first().click().catch(() => {})
  for (const id of ['pulse', 'demo-driver']) {
    const dir = path.join(home, 'desktop-plugins', id); fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(path.join(__dirname, 'plugins', id, 'plugin.js'), path.join(dir, 'plugin.js'))
  }
  await sleep(6000) // MCP discovery + backend warm + plugin load
  // The thread gets the full width, so the floating Pulse pane sits beside it, not on it.
  await page.getByRole('button', { name: 'Hide sidebar' }).first().click().catch(() => console.log('no sidebar toggle'))
  await sleep(800)
  await page.evaluate(CURSOR_JS)
  const markers = []; let t0 = 0
  const mark = name => { markers.push({ name, t: (Date.now() - t0) / 1000 }); console.log('mark', name, markers.at(-1).t) }
  const box = async loc => { const b = await loc.boundingBox(); if (!b) throw new Error('no box for ' + loc); return b }
  const point = async (loc, dx = 0.5, dy = 0.5) => {
    const b = await box(loc); const x = b.x + b.width * dx, y = b.y + b.height * dy
    await page.evaluate(([x, y]) => { document.getElementById('demo-cursor').style.transform = `translate(${x - 3}px,${y - 2}px)` }, [x, y])
    await sleep(750); return { x, y }
  }
  const click = async (loc, opts = {}) => {
    const { x, y } = await point(loc)
    await page.evaluate(([x, y]) => { const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700) }, [x, y])
    await loc.click({ force: true, ...opts }); await sleep(400)
  }
  const type = async (loc, text, delay = 45) => { await click(loc); await loc.pressSequentially(text, { delay }) }
  const boxes = {}
  const remember = async (name, loc) => { boxes[name] = await loc.boundingBox().catch(() => null) }

  let ff = null
  if (!DRY) {
    ff = cp.spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30', '-video_size', '1920x1200',
      '-i', process.env.DISPLAY + '.0+0,0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', OUT], { stdio: ['pipe', 'inherit', 'inherit'] })
    await sleep(1500)
  }
  t0 = Date.now(); mark('start')
  const shot = async n => DRY && page.screenshot({ path: `${__dirname}/v_${n}.png` })

  const composer = () => page.getByRole('textbox').last()
  const ask = async (text, name, delay = 42) => {
    await type(composer(), text, delay); await sleep(450)
    await page.keyboard.press('Enter'); mark(name + '_sent')
  }
  const waitText = async (text, ms = 60000) => page.getByText(text, { exact: false }).last().waitFor({ timeout: ms }).catch(() => console.log('missing:', text))

  // ── 1. "Every AI app looks the same" → one ask reskins the app ──
  mark('s_vibe'); await sleep(1200); await shot('home')
  await remember('composer', composer())
  await ask('Make it feel like a synthwave night drive.', 'vibe', 40)
  await waitText('Same app, new world')
  mark('vibe_done'); await sleep(3000); await shot('vibe')

  // ── 2. "I just want it to do one thing" → a live timer inside the chat ──
  mark('s_timer')
  await ask('Give me a 25 minute focus timer.', 'timer', 42)
  const startBtn = page.getByRole('button', { name: 'Start', exact: true }).last()
  await startBtn.waitFor({ timeout: 60000 }).catch(() => console.log('no timer'))
  mark('timer_shown'); await sleep(1600)
  await remember('timer', startBtn.locator('../../..'))
  await click(startBtn); mark('timer_started'); await sleep(3500); await shot('timer')

  // ── 3. "Plugins mean learning an API" → talk to the plugin ──
  mark('s_remix')
  await remember('pulse', page.getByText('listening', { exact: true }).first().locator('..'))
  await ask('Make the orb gold and twice as fast.', 'remix', 42)
  await waitText('Plugins are just files')
  mark('remix_done'); await sleep(3200); await shot('remix')

  // ── 4. "Its charts are just pictures" → a flow you change where it stands ──
  mark('s_flow')
  await ask('Map our launch as a flow I can edit.', 'flow', 42)
  await waitText('click a step to rename')
  mark('flow_shown'); await sleep(1800)
  const card = page.getByText('click a step to rename', { exact: false }).last().locator('../..')
  await remember('flow', card)
  const add = card.getByRole('button', { name: 'Add a step here' }).last()
  await point(add.locator('..')); await sleep(500)
  await click(add); mark('flow_added'); await sleep(500)
  await page.keyboard.type('Test', { delay: 90 }); await sleep(400)
  await page.keyboard.press('Enter'); mark('flow_renamed')
  await remember('flow_after', card)
  await sleep(2600); await shot('flow')

  // ── 5. "I have no idea what this costs me" → a Spend page ──
  mark('s_spend')
  await ask('Show me where my money goes.', 'spend', 42)
  await waitText('under Spend')
  mark('spend_built'); await sleep(900)
  await click(page.locator('[aria-label="Spend"]').first()); mark('spend_open')
  await sleep(5500); await shot('spend')
  await page.evaluate(() => history.back()); await sleep(1500); mark('back_to_chat')

  // ── 6. "I can't see what my agents are doing" → Mission Control over real background work ──
  mark('s_mission')
  const jobs = ['Research competitor pricing', 'Draft the launch email', 'Review the open PRs', 'Summarize this week in Slack', 'Audit the docs for broken links']
  await page.evaluate(async jobs => {
    const host = window.__demoHost
    for (const text of jobs) {
      const s = await host.request('session.create', {})
      await host.request('prompt.submit', { session_id: s.session_id, text })
    }
  }, jobs).catch(e => console.log('background jobs failed', e.message))
  mark('jobs_started')
  await ask('I want to see what my agents are doing.', 'mission', 42)
  await waitText('Every chat is a star')
  mark('mission_built'); await sleep(900)
  await click(page.locator('[aria-label="Mission Control"]').first()); mark('mission_open')
  await sleep(7000); await shot('mission')
  mark('end')

  if (ff) { ff.stdin.write('q'); await new Promise(r => ff.on('close', r)) }
  fs.writeFileSync(__dirname + '/markers4.json', JSON.stringify({ markers, boxes, scale: 1.5 }, null, 1))
  await app.close()
}
main().catch(e => { console.error(e); process.exit(1) })
