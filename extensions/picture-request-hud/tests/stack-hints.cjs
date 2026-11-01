/** Reads the X11 stacking/type hints Chrome puts on the PiP window: that is what
 *  a window manager (or compositor) uses to keep it above other windows. */
const { execSync } = require('child_process')
const path = require('path')
const { chromium } = require('/home/decrux/Code/hermes-webapp/node_modules/playwright')
const EXT = path.resolve(__dirname, '..')
const sh = cmd => { try { return execSync(cmd, { env: { ...process.env, DISPLAY: ':101' } }).toString().trim() } catch (e) { return 'ERR ' + e.message.split('\n')[0] } }
;(async () => {
  const ctx = await chromium.launchPersistentContext('/home/decrux/.hermes-webapp/cache/scratch/hud-proto/profile-hints-' + Date.now(), {
    args: ['--no-sandbox', '--use-gl=swiftshader', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1000,760'],
    headless: false,
  })
  let [sw] = ctx.serviceWorkers()
  if (!sw) {sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 })}
  const id = new URL(sw.url()).host
  const dock = await ctx.newPage()
  await dock.goto(`chrome-extension://${id}/dock.html`)
  await dock.waitForSelector('#popout')
  await dock.click('#popout')
  await dock.waitForTimeout(2000)
  const line = sh('xwininfo -root -tree').split('\n').find(l => /\b420x560\b/.test(l))
  const winId = line?.trim().split(' ')[0]
  console.log('hud window:', winId, line?.trim().slice(0, 90))
  if (winId) {
    console.log(sh(`xprop -id ${winId} _NET_WM_STATE _NET_WM_WINDOW_TYPE WM_CLASS _MOTIF_WM_HINTS`))
    console.log('--- transient/role hints ---')
    console.log(sh(`xprop -id ${winId} WM_TRANSIENT_FOR WM_WINDOW_ROLE`))
  }
  await ctx.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
