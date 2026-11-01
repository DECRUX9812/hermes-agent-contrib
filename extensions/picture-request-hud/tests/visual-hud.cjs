/**
 * Visual capture of the HUD window exactly as the OS sees it: find the window in
 * the X tree, read its geometry, and crop the screen to it. This is also the
 * evidence that it is a distinct top-level window rather than a tab.
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const { chromium } = require('/home/decrux/Code/hermes-webapp/node_modules/playwright')

const EXT = path.resolve(__dirname, '..')
const SHOTS = path.join(EXT, 'tests', 'shots')
const sh = cmd => { try { return execSync(cmd, { env: { ...process.env, DISPLAY: ':101' } }).toString() } catch (e) { return String(e.stderr || e.message) } }

;(async () => {
  fs.mkdirSync(SHOTS, { recursive: true })
  const ctx = await chromium.launchPersistentContext(
    '/home/decrux/.hermes-webapp/cache/scratch/hud-proto/profile-visual-' + Date.now(),
    {
      args: ['--no-sandbox', '--use-gl=swiftshader', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
        '--auto-select-desktop-capture-source=Entire screen', '--window-size=1100,820', '--window-position=0,0'],
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
  await dock.click('#share')
  await dock.waitForTimeout(3500)

  console.log('--- X window tree (top levels) ---')
  const tree = sh('xwininfo -root -tree')
  console.log(tree.split('\n').filter(l => /Hermes|chrome|Chrome|0x/.test(l)).slice(0, 18).join('\n'))

  // Match by geometry, not title: Chrome titles its PiP window after the opener
  // tab, so the HUD window carries the dock's title. 420x560 is our clamped size.
  const line = tree.split('\n').find(l => /\b420x560\b/.test(l))
  let geo = null
  if (line) {
    const winId = line.trim().split(' ')[0]
    const info = sh(`xwininfo -id ${winId}`)
    geo = {
      height: Number(/Height:\s+(\d+)/.exec(info)?.[1]),
      id: winId,
      mapped: /Map State:\s+(\w+)/.exec(info)?.[1],
      overrideRedirect: /Override Redirect State:\s+(\w+)/.exec(info)?.[1],
      width: Number(/Width:\s+(\d+)/.exec(info)?.[1]),
      x: Number(/Absolute upper-left X:\s+(-?\d+)/.exec(info)?.[1]),
      y: Number(/Absolute upper-left Y:\s+(-?\d+)/.exec(info)?.[1]),
    }
    console.log('HUD window geometry:', JSON.stringify(geo))
  } else {
    console.log('no window titled "Hermes HUD" in the X tree')
  }

  // No window manager on this host, so stacking is ours to arrange: raise the
  // HUD above the dock before grabbing pixels, or the crop shows the dock.
  if (geo?.id) {
    sh(`xdotool windowraise ${geo.id}`)
    sh(`xdotool windowmove ${geo.id} 40 40`)
    await dock.waitForTimeout(700)
  }
  sh(`scrot -o ${path.join(SHOTS, '10-fullscreen.png')}`)
  if (geo && geo.width > 0) {
    const after = sh(`xwininfo -id ${geo.id}`)
    const ax = Number(/Absolute upper-left X:\s+(-?\d+)/.exec(after)?.[1])
    const ay = Number(/Absolute upper-left Y:\s+(-?\d+)/.exec(after)?.[1])
    sh(`ffmpeg -y -loglevel error -i ${path.join(SHOTS, '10-fullscreen.png')} -vf "crop=${geo.width}:${geo.height}:${ax}:${ay}" ${path.join(SHOTS, '11-hud-window.png')}`)
    console.log('cropped to', path.join(SHOTS, '11-hud-window.png'))
  }

  console.log('--- dock state ---')
  console.log(JSON.stringify(await dock.evaluate(() => ({
    hudSize: [documentPictureInPicture.window?.outerWidth, documentPictureInPicture.window?.outerHeight],
    live: document.getElementById('live-label').textContent,
  }))))
  await ctx.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
