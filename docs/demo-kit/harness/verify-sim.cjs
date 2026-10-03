const { chromium } = require('playwright-core')
const sleep = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'] })
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message))
  await page.goto('http://127.0.0.1:5199/?auto=1&speed=8&cam=task_wall', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__studio, { timeout: 30000 })
  // wait for goal done or timeout 240s
  let state = null
  for (let i = 0; i < 120; i++) {
    state = await page.evaluate(() => {
      const st = window.__studio.store
      return { goal: st.goal?.status, tasks: [...st.tasks.values()].map(t => `${t.id}:${t.state}`),
        decisions: [...st.decisions.values()].map(d => `${d.key}:${d.status}:${d.answer?.option ?? '-'}`) }
    })
    if (state.goal === 'done') break
    await sleep(2000)
  }
  console.log('goal:', state.goal)
  console.log('tasks:', state.tasks.join(' '))
  console.log('decisions:', state.decisions.join(' | '))
  console.log('console errors:', errors.length ? errors.join('\n') : 'none')
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
