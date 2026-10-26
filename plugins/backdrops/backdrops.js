/**
 * backdrops — Hermes Desktop (browser-hosted) chat background picker.
 *
 * WHY THIS SHAPE
 * --------------
 * The browser-hosted Desktop renderer loads chat backdrops through its OWN
 * native store, not through the desktop-plugin runtime:
 *
 *   src/store/backdrop.ts        $backdropScene / $backdropStrength / $backdropImage
 *   src/lib/backdrop-scenes.ts   backdropLayer(scene, strength, mode, customImage, asset)
 *   src/components/Backdrop.tsx  paints layer.image / layer.background
 *
 * The 'custom' scene paints exactly one image, held as a data URL in
 * localStorage under 'hermes.desktop.backdrop.image.v1'
 * (src/store/backdrop.ts IMAGE_KEY), with the scene itself under
 * 'hermes.desktop.backdrop.scene.v2' (SCENE_KEY).
 *
 * So this file does not need — and cannot use — the desktop-plugin SDK: it
 * drives the SAME native path the Settings > Appearance > Chat Background
 * picker drives, which means the backdrop survives reloads and is visible to
 * the app exactly as if the user had picked the file by hand.
 *
 * USAGE
 * -----
 * Paste the whole file into the browser devtools console on the Hermes Desktop
 * tab (or run it via a bookmarklet). It renders a picker; pick a drop and the
 * page reloads with that backdrop live.
 *
 * Exported for tests: window.__hermesBackdrops
 */
;(function installBackdrops(global) {
  'use strict'

  var MANIFEST =
    'https://raw.githubusercontent.com/DECRUX9812/hermes-backdrops/main/backdrops.json'
  var MANIFEST_BASE = MANIFEST.slice(0, MANIFEST.lastIndexOf('/') + 1)

  // The exact keys the app reads (src/store/backdrop.ts).
  var SCENE_KEY = 'hermes.desktop.backdrop.scene.v2'
  var LEGACY_KEY = 'hermes.desktop.backdrop.v1'
  var STRENGTH_KEY = 'hermes.desktop.backdrop.strength.v1'
  var IMAGE_KEY = 'hermes.desktop.backdrop.image.v1'

  // Must match MAX_EDGE / quality in src/app/settings/backdrop-setting.tsx so a
  // drop chosen here is indistinguishable from one chosen in Settings.
  var MAX_EDGE = 1920
  var JPEG_QUALITY = 0.82

  /** Last-resort catalogue if the manifest fetch fails (same 8 drops). */
  var BUNDLED = [
    'nebula-drift',
    'aurora-summit',
    'abyssal-garden',
    'ember-dunes',
    'rainline-city',
    'ink-tide',
    'glowcap-forest',
    'topo-waves'
  ].map(function (id) {
    return {
      id: id,
      title: id.replace(/(^|-)([a-z])/g, function (_, sep, ch) {
        return (sep ? ' ' : '') + ch.toUpperCase()
      }),
      url: 'backgrounds/' + id + '.jpg',
      thumb: 'backgrounds/thumbs/' + id + '.jpg'
    }
  })

  function absolute(rel) {
    return /^https?:/i.test(rel) ? rel : MANIFEST_BASE + rel
  }

  /** The manifest, normalised to {id,title,url,thumb} with absolute URLs. */
  function fetchDrops() {
    return fetch(MANIFEST)
      .then(function (r) {
        if (!r.ok) throw new Error('manifest HTTP ' + r.status)
        return r.json()
      })
      .then(function (json) {
        var list = (json && json.drops) || []
        if (!list.length) throw new Error('manifest had no drops')
        return list.map(function (d) {
          return {
            id: d.id,
            title: d.title || d.id,
            url: absolute(d.url || 'backgrounds/' + d.id + '.jpg'),
            thumb: absolute(d.thumb || 'backgrounds/thumbs/' + d.id + '.jpg')
          }
        })
      })
      .catch(function () {
        return BUNDLED.map(function (d) {
          return {
            id: d.id,
            title: d.title,
            url: absolute(d.url),
            thumb: absolute(d.thumb)
          }
        })
      })
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image()
      // The manifest host is cross-origin; canvas needs the pixel bytes.
      img.crossOrigin = 'anonymous'
      img.onload = function () {
        resolve(img)
      }
      img.onerror = function () {
        reject(new Error('image load failed: ' + url))
      }
      img.src = url
    })
  }

  /**
   * Downscale to a JPEG data URL exactly as the Settings picker does
   * (src/app/settings/backdrop-setting.tsx `downscaled`). Storing a data URL is
   * what makes the backdrop survive a reload without any server round-trip.
   */
  function toDataUrl(img) {
    var scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    var canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)

    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  }

  /** Apply a backdrop the way the app's own store would. */
  function applyBackdrop(dataUrl, scene, strength) {
    global.localStorage.setItem(IMAGE_KEY, dataUrl)
    global.localStorage.setItem(SCENE_KEY, scene || 'custom')
    // v1 boolean view of the same state (src/store/backdrop.ts LEGACY_KEY).
    global.localStorage.setItem(LEGACY_KEY, String(scene !== 'off'))
    if (strength) global.localStorage.setItem(STRENGTH_KEY, strength)

    return {
      scene: scene || 'custom',
      imageKey: IMAGE_KEY,
      sceneKey: SCENE_KEY,
      bytes: dataUrl.length
    }
  }

  function clearBackdrop() {
    global.localStorage.removeItem(IMAGE_KEY)
    global.localStorage.setItem(SCENE_KEY, 'off')
    global.localStorage.setItem(LEGACY_KEY, 'false')
  }

  /** Build the picker overlay. `pick(drop)` is injectable so tests can drive it. */
  function renderPicker(host, drops, pick, onError) {
    host.innerHTML = ''

    var root = document.createElement('div')
    root.setAttribute('data-backdrops-root', '')
    root.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483000',
      'display:grid',
      'place-items:center',
      'background:rgba(8,10,14,.72)',
      'backdrop-filter:blur(6px)',
      'font:13px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif',
      'color:#e8ecf4'
    ].join(';')

    var panel = document.createElement('div')
    panel.style.cssText =
      'max-width:760px;width:min(92vw,760px);max-height:86vh;overflow:auto;padding:18px;border-radius:14px;background:#141821;border:1px solid #2a3240;box-shadow:0 24px 60px rgba(0,0,0,.5)'

    var title = document.createElement('div')
    title.textContent = 'Backdrops'
    title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:12px'

    var grid = document.createElement('div')
    grid.style.cssText =
      'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px'

    drops.forEach(function (drop) {
      var card = document.createElement('button')
      card.type = 'button'
      card.setAttribute('data-backdrop-drop', drop.id)
      card.style.cssText = [
        'display:block',
        'padding:0',
        'border:1px solid #2a3240',
        'border-radius:10px',
        'overflow:hidden',
        'background:#0d1017',
        'color:inherit',
        'cursor:pointer',
        'text-align:left'
      ].join(';')

      var img = document.createElement('img')
      img.src = drop.thumb
      img.alt = drop.title
      img.loading = 'lazy'
      img.style.cssText = 'display:block;width:100%;height:96px;object-fit:cover'

      var label = document.createElement('div')
      label.textContent = drop.title
      label.style.cssText = 'padding:7px 9px;font-size:12px'

      card.appendChild(img)
      card.appendChild(label)
      card.addEventListener('click', function () {
        pick(drop).catch(function (error) {
          if (onError) onError(error)
        })
      })
      grid.appendChild(card)
    })

    var foot = document.createElement('div')
    foot.style.cssText = 'display:flex;gap:8px;margin-top:14px'

    var off = document.createElement('button')
    off.type = 'button'
    off.setAttribute('data-backdrop-off', '')
    off.textContent = 'No backdrop'
    off.style.cssText =
      'padding:6px 12px;border-radius:8px;border:1px solid #2a3240;background:#0d1017;color:#e8ecf4;cursor:pointer'
    off.addEventListener('click', function () {
      clearBackdrop()
      global.location.reload()
    })

    var close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Close'
    close.style.cssText = off.style.cssText
    close.addEventListener('click', function () {
      root.remove()
    })

    foot.appendChild(off)
    foot.appendChild(close)
    panel.appendChild(title)
    panel.appendChild(grid)
    panel.appendChild(foot)
    root.appendChild(panel)

    host.appendChild(root)

    return root
  }

  /** Fetch a drop's full image, store it, and reload into the new backdrop. */
  function install(drop) {
    return loadImage(drop.url).then(function (img) {
      var dataUrl = toDataUrl(img)
      var applied = applyBackdrop(dataUrl, 'custom', null)
      global.location.reload()

      return applied
    })
  }

  var api = {
    MANIFEST: MANIFEST,
    BUNDLED_IDS: BUNDLED.map(function (d) {
      return d.id
    }),
    KEYS: {
      scene: SCENE_KEY,
      legacy: LEGACY_KEY,
      strength: STRENGTH_KEY,
      image: IMAGE_KEY
    },
    MAX_EDGE: MAX_EDGE,
    JPEG_QUALITY: JPEG_QUALITY,
    fetchDrops: fetchDrops,
    toDataUrl: toDataUrl,
    applyBackdrop: applyBackdrop,
    clearBackdrop: clearBackdrop,
    renderPicker: renderPicker,
    install: install,
    /** Mount the picker. Returns a promise resolving once it's on screen. */
    mount: function mount() {
      return fetchDrops().then(function (drops) {
        var host = document.body || document.documentElement
        renderPicker(host, drops, install, function (error) {
          global.console && global.console.error('[backdrops]', error)
        })

        return drops
      })
    }
  }

  global.__hermesBackdrops = api

  // Auto-mount when loaded as a plain <script>, stay inert under a bundler/test.
  if (typeof document !== 'undefined' && !global.__HERMES_BACKDROPS_NO_AUTOMOUNT) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        api.mount()
      })
    } else {
      api.mount()
    }
  }
})(typeof window !== 'undefined' ? window : globalThis)