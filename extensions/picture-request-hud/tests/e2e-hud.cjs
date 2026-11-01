/**
 * Live end-to-end proof for the Picture Request HUD extension.
 *
 * Real Chrome (headful), the real unpacked extension, a real Document-PiP
 * window, and real screen capture. Chrome's own source picker cannot be
 * scripted — which is precisely why it is a trustworthy consent gate — so the
 * source is pre-selected with Chrome's own test flag, and every assertion after
 * that is read from the live DOM of both surfaces.
 *
 * Run: DISPLAY=:101 node extensions/picture-request-hud/tests/e2e-hud.cjs
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const { chromium } = require('/home/decrux/Code/hermes-webapp/node_modules/playwright')

const EXT = path.resolve(__dirname, '..')
const SHOTS = path.join(EXT, 'tests', 'shots')
const results = []
const step = (name, ok, detail) => {
  results.push({ detail, name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const shot = name => {
  try {
    execSync(`DISPLAY=:101 scrot -o ${path.join(SHOTS, name)}`)
    return true
  } catch {
    return false
  }
}

;(async () => {
  fs.mkdirSync(SHOTS, { recursive: true })
  const context = await chromium.launchPersistentContext(
    '/home/decrux/.hermes-webapp/cache/scratch/hud-proto/profile-e2e-' + Date.now(),
    {
      args: [
        '--no-sandbox',
        '--use-gl=swiftshader',
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        '--auto-select-desktop-capture-source=Entire screen',
        '--window-size=1200,860',
      ],
      headless: false,
    }
  )

  let [worker] = context.serviceWorkers()
  if (!worker) {worker = await context.waitForEvent('serviceworker', { timeout: 30_000 })}
  const id = new URL(worker.url()).host
  step('extension service worker registered', !!id, `id=${id}`)

  const dock = await context.newPage()
  dock.on('pageerror', e => console.log('  [dock error]', e.message))
  await dock.goto(`chrome-extension://${id}/dock.html`)
  await dock.waitForSelector('#popout')

  const boot = await dock.evaluate(() => ({
    hint: document.getElementById('popout-hint').textContent.trim().slice(0, 50),
    pip: 'documentPictureInPicture' in window,
    popoutDisabled: document.getElementById('popout').disabled,
  }))
  step('dock loads in Chrome with Document-PiP available', boot.pip && !boot.popoutDisabled, JSON.stringify(boot))
  shot('01-dock.png')

  /* ------------------------------------- the top-level launch control exists */
  const prominence = await dock.evaluate(() => {
    const btn = document.getElementById('launch-hud')
    const share = document.getElementById('share')
    if (!btn || !share) {return { exists: false }}
    const rect = btn.getBoundingClientRect()
    const shareRect = share.getBoundingClientRect()
    const panel = document.body.getBoundingClientRect()
    return {
      aboveEverything: rect.bottom <= shareRect.top,
      enabled: !btn.disabled,
      exists: true,
      height: Math.round(rect.height),
      label: document.getElementById('launch-label').textContent,
      visible: rect.width > 0 && rect.height > 0 && getComputedStyle(btn).display !== 'none',
      widthRatio: +(rect.width / panel.width).toFixed(2),
    }
  })
  step('a prominent top-level launch button sits above every other control',
    prominence.exists && prominence.visible && prominence.enabled && prominence.widthRatio > 0.9 && prominence.aboveEverything,
    JSON.stringify(prominence))

  /* ------------------------- ONE CLICK, HUD CLOSED → a real window appears */
  const before = context.pages().length
  await dock.click('#launch-hud')
  await dock.waitForTimeout(2500)
  step('one click on the launch button opens the HUD window', context.pages().length === before + 1, `${before} → ${context.pages().length}`)

  const afterLaunch = await dock.evaluate(() => ({
    label: document.getElementById('launch-label').textContent,
    note: document.getElementById('launch-note').textContent.slice(0, 44),
    open: document.getElementById('launch-hud').dataset.open,
    status: document.getElementById('status').textContent,
  }))
  step('the button switches to "bring to front" once the HUD is up',
    afterLaunch.open === 'true' && /front/i.test(afterLaunch.label) && /open/i.test(afterLaunch.status),
    JSON.stringify(afterLaunch))

  const hud = await dock.evaluate(() => {
    const win = documentPictureInPicture.window
    if (!win) {return { exists: false }}
    const doc = win.document
    const btn = doc.querySelector('#share')
    return {
      exists: true,
      closed: win.closed,
      href: win.location.href,
      hasHudFlag: doc.documentElement.dataset.hud === 'pip',
      hasShare: !!btn,
      hasPreview: !!doc.querySelector('#preview'),
      hasLog: !!doc.querySelector('#log'),
      cssApplied: btn ? getComputedStyle(btn).borderRadius : null,
      themeVar: doc.documentElement.style.getPropertyValue('--accent'),
      title: doc.title,
      size: [win.outerWidth, win.outerHeight],
    }
  })
  step('the window is PiP-owned and chromeless (about:blank, not a tab)', hud.exists && !hud.closed && hud.href === 'about:blank', JSON.stringify({ href: hud.href, title: hud.title }))
  step('the HUD surface was built inside that window (same markup contract)', hud.hasHudFlag && hud.hasShare && hud.hasPreview && hud.hasLog, JSON.stringify(hud))
  step('the extension stylesheet applies inside the PiP document', hud.cssApplied === '9px', `border-radius=${hud.cssApplied}`)
  step('geometry is applied from inside the window (not the advisory hint)', Math.abs(hud.size[0] - 420) < 90 || Math.abs(hud.size[1] - 560) < 90, `size=${hud.size}`)
  shot('02-hud-open.png')

  /* ------------------------------------------------------- consent gate */
  const pre = await dock.evaluate(() => ({
    dockBadge: !document.getElementById('live').classList.contains('hidden'),
    hudBadge: !documentPictureInPicture.window.document.getElementById('live').classList.contains('hidden'),
    hudVideo: !!documentPictureInPicture.window.document.getElementById('preview').srcObject,
    titles: [document.title, documentPictureInPicture.window.document.title],
  }))
  step('nothing captured and no live indicator before consent', !pre.dockBadge && !pre.hudBadge && !pre.hudVideo && !pre.titles.some(t => t.startsWith('●')), JSON.stringify(pre))

  await dock.click('#share')
  await dock.waitForTimeout(3500)

  const live = await dock.evaluate(() => {
    const hudDoc = documentPictureInPicture.window.document
    const hudVideo = hudDoc.getElementById('preview')
    return {
      dockBadge: document.getElementById('live-label').textContent,
      dockLiveClass: document.body.classList.contains('is-live'),
      dockTitle: document.title,
      hudBadge: hudDoc.getElementById('live-label').textContent,
      hudLiveClass: hudDoc.body.classList.contains('is-live'),
      hudTitle: hudDoc.title,
      hudPlaying: !!hudVideo.srcObject && hudVideo.videoWidth > 0 && !hudVideo.paused,
      hudFrame: [hudVideo.videoWidth, hudVideo.videoHeight],
      track: hudVideo.srcObject?.getVideoTracks?.()[0]?.getSettings?.().displaySurface ?? null,
    }
  })
  step('sharing starts only after the explicit click', live.dockBadge.startsWith('● LIVE') && live.hudPlaying, JSON.stringify({ frame: live.hudFrame, surface: live.track }))
  step('the HUD renders the shared screen (frames flowing in the other document)', live.hudPlaying && live.hudFrame[0] > 0, JSON.stringify(live.hudFrame))
  step('privacy indicator is visible in BOTH surfaces and both window titles', live.dockBadge.startsWith('● LIVE') && live.hudBadge.startsWith('● LIVE') && live.dockTitle.startsWith('● LIVE') && live.hudTitle.startsWith('● LIVE'), JSON.stringify({ dock: live.dockTitle, hud: live.hudTitle }))
  step('the live edge tint is applied while frames flow', live.dockLiveClass && live.hudLiveClass, `dock=${live.dockLiveClass} hud=${live.hudLiveClass}`)
  shot('03-hud-live.png')

  /* ------------------------------------------------------------- stopping */
  await dock.click('#stop')
  await dock.waitForTimeout(800)
  const stopped = await dock.evaluate(() => {
    const hudDoc = documentPictureInPicture.window.document
    return {
      dockBadge: document.getElementById('live').classList.contains('hidden'),
      dockTitle: document.title,
      hudBadge: hudDoc.getElementById('live').classList.contains('hidden'),
      hudTitle: hudDoc.title,
      hudVideo: !!hudDoc.getElementById('preview').srcObject,
    }
  })
  step('Stop ends the share and clears both indicators', stopped.dockBadge && stopped.hudBadge && !stopped.dockTitle.startsWith('●') && !stopped.hudTitle.startsWith('●') && !stopped.hudVideo, JSON.stringify(stopped))
  shot('04-hud-stopped.png')

  /* --------------------------------------------------- backend error state */
  await dock.fill('#task', 'this looks cool — can you build this for me?')
  await dock.click('#ask')
  await dock.waitForTimeout(4000)
  const offline = await dock.evaluate(() => ({
    body: document.getElementById('error-body').textContent.slice(0, 80),
    hidden: document.getElementById('error').classList.contains('hidden'),
    title: document.getElementById('error-title').textContent,
  }))
  step('a missing gateway produces a named error state, not a silent failure', !offline.hidden && /Hermes|offline/i.test(offline.title), JSON.stringify(offline))
  shot('05-backend-offline.png')

  /* ------------------------------------------- activation + one-HUD rules */
  // Fresh document, no interaction at all: this is the honest no-activation case
  // (the dock above has sticky activation from the clicks we just made, and
  // Chrome correctly honours that).
  const fresh = await context.newPage()
  await fresh.goto(`chrome-extension://${id}/dock.html`)
  // Playwright's evaluate passes userGesture: true, so ask CDP for a call with
  // activation explicitly withheld — the state a background script is in.
  const cdp = await context.newCDPSession(fresh)
  const raw = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    expression: `(async () => { try { await documentPictureInPicture.requestWindow({ width: 300, height: 300 }); return 'opened'; } catch (e) { return 'threw:' + e.name; } })()`,
    returnByValue: true,
    userGesture: false,
  })
  const outcome = String(raw.result?.value ?? 'unknown')
  const noGesture = { name: outcome.replace('threw:', ''), threw: outcome.startsWith('threw') }
  await fresh.close()
  step('a PiP request without a click fails loudly (NotAllowedError)', noGesture.threw && noGesture.name === 'NotAllowedError', JSON.stringify(noGesture))

  const beforeSecond = context.pages().length
  await dock.click('#popout')
  await dock.waitForTimeout(1500)
  const second = await dock.evaluate(() => ({
    hudStillOpen: !!documentPictureInPicture.window && !documentPictureInPicture.window.closed,
    status: document.getElementById('status').textContent,
  }))
  step('re-clicking "Pop out" re-homes the existing HUD instead of a second one', context.pages().length === beforeSecond && second.hudStillOpen, JSON.stringify(second))

  /* --------------------------- a SECOND PANEL must reuse, never duplicate */
  const panel2 = await context.newPage()
  await panel2.goto(`chrome-extension://${id}/dock.html`)
  await panel2.waitForSelector('#launch-hud')
  await panel2.waitForTimeout(900) // the initial probe settles
  const p2boot = await panel2.evaluate(() => ({ label: document.getElementById('launch-label').textContent }))
  const beforeCross = context.pages().length
  await panel2.click('#launch-hud')
  await panel2.waitForTimeout(1200)
  const p2 = await panel2.evaluate(() => ({
    label: document.getElementById('launch-label').textContent,
    status: document.getElementById('status').textContent,
  }))
  const hudAlive = await dock.evaluate(() => !!documentPictureInPicture.window && !documentPictureInPicture.window.closed)
  step('a second panel sees the HUD already open on its first paint', /front/i.test(p2boot.label), JSON.stringify(p2boot))
  step('launching from a second panel reuses that window instead of a duplicate',
    context.pages().length === beforeCross && hudAlive && /front/i.test(p2.status),
    JSON.stringify({ ...p2, alive: hudAlive, pages: context.pages().length }))
  await panel2.close()

  /* ------------------------------------- closing the HUD resets the dock UI */
  await dock.evaluate(() => documentPictureInPicture.window.close())
  await dock.waitForTimeout(900)
  const closed = await dock.evaluate(() => ({ status: document.getElementById('status').textContent }))
  step('closing the HUD updates the dock without an error', /closed/i.test(closed.status), JSON.stringify(closed))

  /* ---------------------------------- a refused launch is never silent */
  // Inject the honest failure a browser gives when it will not hand out a
  // window: the API is there, the call throws. Nothing is mocked beyond that.
  await dock.evaluate(() => {
    const pip = window.documentPictureInPicture
    window.__hudOriginalRequest = pip.requestWindow.bind(pip)
    pip.requestWindow = async () => {
      const error = new Error('refused for this test')
      error.name = 'NotAllowedError'
      throw error
    }
  })
  const beforeFail = context.pages().length
  await dock.click('#launch-hud')
  await dock.waitForTimeout(900)
  const failure = await dock.evaluate(() => ({
    body: document.getElementById('error-body').textContent.slice(0, 70),
    hidden: document.getElementById('error').classList.contains('hidden'),
    status: document.getElementById('status').textContent,
    title: document.getElementById('error-title').textContent,
  }))
  step('a refused launch shows a visible, named error instead of a silent no-op',
    !failure.hidden && failure.title.length > 0 && /could not/i.test(failure.status) && context.pages().length === beforeFail,
    JSON.stringify(failure))
  shot('06-launch-error.png')

  await dock.evaluate(() => {
    if (window.__hudOriginalRequest) {window.documentPictureInPicture.requestWindow = window.__hudOriginalRequest}
  })
  await dock.click('#launch-hud')
  await dock.waitForTimeout(2200)
  const recovered = await dock.evaluate(() => ({
    errorHidden: document.getElementById('error').classList.contains('hidden'),
    label: document.getElementById('launch-label').textContent,
  }))
  step('the next click after a failure recovers and opens the HUD',
    context.pages().length === beforeFail + 1 && recovered.errorHidden && /front/i.test(recovered.label),
    JSON.stringify(recovered))

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  fs.writeFileSync(path.join(SHOTS, 'e2e-results.json'), JSON.stringify(results, null, 2))
  await context.close()
  process.exit(failed.length ? 1 : 0)
})().catch(error => {
  console.error('E2E FATAL', error)
  process.exit(2)
})
