/* AgentCraft Studio — take recorder.
 * Records webm takes of the standalone demo (vite :5199) via playwright recordVideo.
 * Usage: node docs/demo-kit/harness/record-ac.cjs [outDir]
 * Requires the demo server: cd apps/desktop && npx vite --config agentcraft-demo/vite.config.ts
 */
const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright-core')

const BASE = 'http://127.0.0.1:5199/'
const OUT = process.argv[2] || path.join(__dirname, '..', 'agentcraft-film', 'takes')
const VIEW = { width: 1280, height: 720 }

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function take(browser, name, url, script) {
  const ctx = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 1.5,
    recordVideo: { dir: OUT, size: { width: VIEW.width, height: VIEW.height } },
  })
  const page = await ctx.newPage()
  await page.goto(BASE + url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__studio, { timeout: 30000 })
  await sleep(1200) // world settle + HUD paint
  try {
    await script(page)
  } catch (e) {
    console.log('script error in', name, e.message)
  }
  const video = page.video()
  await ctx.close()
  const vpath = await video.path()
  fs.renameSync(vpath, path.join(OUT, name + '.webm'))
  console.log('take', name, '->', name + '.webm')
}

const fly = (page, preset) => page.evaluate(p => window.__studio.flyTo(p), preset)
const time = (page, t) => page.evaluate(t => window.__studio.setTime(t), t)

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'],
  })

  // t1: exterior hero, day — slow orbit feel
  await take(browser, 't1-hero-day', '?cam=exterior_hero&time=day&auto=1&speed=1.2', async page => {
    await sleep(6500)
  })

  // t2: interior work flythrough — hall -> wide -> desks -> library
  await take(browser, 't2-interior', '?cam=hall&auto=1&speed=4', async page => {
    await sleep(3500)
    await fly(page, 'wide_interior')
    await sleep(4000)
    await fly(page, 'library')
    await sleep(4000)
    await fly(page, 'hall')
    await sleep(3500)
  })

  // t3: atrium + task wall + podium
  await take(browser, 't3-atrium', '?cam=entrance_atrium&auto=1&speed=4', async page => {
    await sleep(3500)
    await fly(page, 'task_wall')
    await sleep(4500)
    await fly(page, 'decision_podium')
    await sleep(5000)
    await fly(page, 'entrance_atrium')
    await sleep(3000)
  })

  // t4: stations — console, merge, testbench
  await take(browser, 't4-stations', '?cam=console&auto=1&speed=6', async page => {
    await sleep(4500)
    await fly(page, 'merge_station')
    await sleep(4500)
    await fly(page, 'testbench')
    await sleep(4500)
  })

  // t5: golden hour exterior
  await take(browser, 't5-golden', '?cam=exterior_hero&time=golden&auto=1&speed=2', async page => {
    await sleep(5000)
  })

  // t6: night hero
  await take(browser, 't6-night', '?cam=night&time=night&auto=1&speed=2', async page => {
    await sleep(6000)
  })

  // t7: agent follow — pick whoever is walking
  await take(browser, 't7-follow', '?cam=hall&auto=1&speed=5', async page => {
    const id = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('.ac-chip')]
      return chips[0]?.dataset?.agent || null
    })
    if (id) await page.evaluate(i => window.__studio.followAgent(i), id)
    await sleep(6000)
  })

  // t8: full day time-lapse sweep
  await take(browser, 't8-sweep', '?cam=exterior_hero&auto=1&speed=6', async page => {
    await fly(page, 'night')
    await time(page, 'golden')
    await sleep(4000)
    await time(page, 'night')
    await sleep(4000)
    await time(page, 'day')
    await fly(page, 'exterior_hero')
    await sleep(4000)
  })

  await browser.close()
  console.log('done ->', OUT)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
