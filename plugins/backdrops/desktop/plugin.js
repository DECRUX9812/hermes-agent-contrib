// Backdrops — a Hermes desktop plugin. A rolling gallery of backdrop art for
// the chat background (fresh drops arrive through a remote manifest, the
// bundled list below is the offline floor), plus your own photo. Applying a
// drop writes the same 'custom' Chat Background slot the Appearance page's
// upload tile writes — the app's blend/strength machinery paints it, so this
// plugin stays a picker, not a second backdrop engine.
//
// Installs off: enable in Capabilities → Plugins, then look under
// Settings → Appearance → "Backdrop gallery".
import { APPEARANCE_AREAS, atom, cn, haptic, host, icons, Popover, PopoverContent, PopoverTrigger, STATUSBAR_AREAS, useValue } from '@hermes/plugin-sdk'
import { useRef } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

// The manifest the gallery refreshes from — newest drops land here without a
// plugin update. Relative entry paths resolve against this URL. For a local
// checkout or a fork, point `manifestUrl` (ctx.storage) at any backdrops.json.
const MANIFEST_URL =
  'https://raw.githubusercontent.com/DECRUX9812/hermes-agent-contrib/main/plugins/backdrops/backdrops.json'

// Same list as backdrops.json at release time: the offline floor and the
// first-paint gallery. Keep in sync when shipping a drop.
const BUNDLED = [
  { id: 'nebula-drift', title: 'Nebula Drift', url: 'backgrounds/nebula-drift.jpg', thumb: 'backgrounds/thumbs/nebula-drift.jpg', added: '2026-10-03' },
  { id: 'aurora-summit', title: 'Aurora Summit', url: 'backgrounds/aurora-summit.jpg', thumb: 'backgrounds/thumbs/aurora-summit.jpg', added: '2026-10-03' },
  { id: 'abyssal-garden', title: 'Abyssal Garden', url: 'backgrounds/abyssal-garden.jpg', thumb: 'backgrounds/thumbs/abyssal-garden.jpg', added: '2026-10-03' },
  { id: 'ember-dunes', title: 'Ember Dunes', url: 'backgrounds/ember-dunes.jpg', thumb: 'backgrounds/thumbs/ember-dunes.jpg', added: '2026-10-03' },
  { id: 'rainline-city', title: 'Rainline City', url: 'backgrounds/rainline-city.jpg', thumb: 'backgrounds/thumbs/rainline-city.jpg', added: '2026-10-03' },
  { id: 'ink-tide', title: 'Ink Tide', url: 'backgrounds/ink-tide.jpg', thumb: 'backgrounds/thumbs/ink-tide.jpg', added: '2026-10-03' },
  { id: 'glowcap-forest', title: 'Glowcap Forest', url: 'backgrounds/glowcap-forest.jpg', thumb: 'backgrounds/thumbs/glowcap-forest.jpg', added: '2026-10-03' },
  { id: 'topo-waves', title: 'Topo Waves', url: 'backgrounds/topo-waves.jpg', thumb: 'backgrounds/thumbs/topo-waves.jpg', added: '2026-10-03' }
]

const NEW_DAYS = 30
const MAX_EDGE = 1920 // same downscale edge as the native upload tile
const FETCH_MS = 6000
const REFRESH_MS = 6 * 60 * 60 * 1000

const $origin = atom('loading') // 'live' | 'bundled' | 'cached' | 'loading'
/** Native paint strength behind the popover toggle (soft → subtle). */
const $strength = atom('balanced')
const $backdrop = atom({ image: null, scene: 'off' })
let $own // the stored photo atom, seeded from ctx.storage at register

const isHttp = url => /^https?:\/\//i.test(url)
const isAbsolute = url => /^[a-z][a-z0-9+.-]*:/i.test(url)

// Older Desktop builds have no backdrop.* keys — degrade to a read-only card
// instead of a load failure (the host.settings doc tells plugins to feature-
// detect). Writes notify once.
let warnedWrite = false

const getSetting = key => {
  try {
    return host.settings.get(key)
  } catch {
    return null
  }
}

const setSetting = (key, value) => {
  try {
    host.settings.set(key, value)
    return true
  } catch {
    if (!warnedWrite) {
      warnedWrite = true
      host.notify({ kind: 'error', message: 'Update Hermes Desktop to apply gallery backdrops.' })
    }
    return false
  }
}

const manifestBase = ctx => ctx.storage.get('manifestUrl', MANIFEST_URL)

/** Entry url/thumb may be relative to the manifest's own directory. */
const resolveAgainst = (base, path) => {
  try {
    return isAbsolute(path) ? path : new URL(path, base).href
  } catch {
    return null
  }
}

/** Shape-check a manifest drop; remote JSON is untrusted. */
const readDrop = (base, value) => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const { id, title, url, thumb, added } = value

  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    return null
  }
  if (typeof title !== 'string' || !title.trim()) {
    return null
  }

  const image = typeof url === 'string' ? resolveAgainst(base, url) : null

  if (!image || !isHttp(image)) {
    return null
  }

  const preview = typeof thumb === 'string' ? resolveAgainst(base, thumb) : null
  const stamp = typeof added === 'string' && !Number.isNaN(Date.parse(added)) ? added : null

  return { id, title: title.trim().slice(0, 60), url: image, thumb: preview && isHttp(preview) ? preview : image, added: stamp }
}

const byNewest = (a, b) => (b.added ?? '').localeCompare(a.added ?? '') || a.title.localeCompare(b.title)

const isNew = drop => Boolean(drop.added) && Date.now() - Date.parse(drop.added) < NEW_DAYS * 86400_000

const normalize = (base, drops) => {
  const read = (Array.isArray(drops) ? drops : []).map(value => readDrop(base, value)).filter(Boolean)

  return read.slice(0, 60).sort(byNewest)
}

// Normalized at startup, never raw BUNDLED: entry paths are relative to the
// manifest's directory, and a tile click before the first refresh would
// otherwise store a relative path in backdrop.image — a URL that 404s
// against the app base and persists, leaving the background blank.
const $drops = atom(normalize(MANIFEST_URL, BUNDLED))

/** Same downscale the Appearance page applies (1920px JPEG → a few hundred KB). */
const downscaled = async file => {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  return canvas.toDataURL('image/jpeg', 0.82)
}

const tileClass = active =>
  cn(
    'w-full p-1.5 text-left rounded-lg border transition-colors',
    active
      ? 'border-primary bg-primary/[0.06] ring-2 ring-primary/20'
      : 'border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) hover:bg-(--chrome-action-hover)'
  )

const swatchClass =
  'relative grid h-14 place-items-center overflow-hidden rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background) text-(--ui-text-quaternary)'

const captionClass = 'mt-1.5 truncate px-0.5 text-[length:var(--conversation-caption-font-size)] font-medium'

const newBadge = () =>
  jsx('span', {
    className:
      'absolute left-2 top-2 rounded px-1 py-px text-[length:0.5625rem] font-semibold uppercase tracking-wide bg-(--ui-bg-elevated)/85 text-(--ui-accent) backdrop-blur-sm',
    children: 'New'
  })

const appliedBadge = () =>
  jsx('span', {
    className:
      'absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground',
    children: jsx(icons.Check, { className: 'size-3' })
  })

/** One door for every apply surface (gallery tile, statusbar quick-pick). */
const applyDrop = (ctx, url) => {
  haptic('tap')

  // A photo the user dropped through the native tile is worth keeping —
  // stash it as "Your photo" before the gallery claim takes the slot.
  const current = getSetting('backdrop.image')

  if (typeof current === 'string' && current.startsWith('data:') && current !== ctx.storage.get('own', null)) {
    ctx.storage.set('own', current)
    $own?.set(current)
  }

  setSetting('backdrop.image', url)
}

function DropTile({ ctx, drop }) {
  const bd = useValue($backdrop)
  const active = bd.scene === 'custom' && bd.image === drop.url

  const apply = () => applyDrop(ctx, drop.url)

  return jsxs('div', {
    className: 'group relative',
    children: [
      jsxs('button', {
        type: 'button',
        'aria-pressed': active,
        className: tileClass(active),
        onClick: apply,
        children: [
          jsxs('div', {
            className: swatchClass,
            children: [
              jsx('img', {
                alt: '',
                className: 'absolute inset-0 size-full object-cover',
                decoding: 'async',
                loading: 'lazy',
                src: drop.thumb
              }),
              isNew(drop) ? newBadge() : null
            ]
          }),
          jsx('div', { className: captionClass, children: drop.title })
        ]
      }),
      active ? appliedBadge() : null
    ]
  })
}

/** One door for photo uploads (gallery tile, statusbar quick-pick). */
const uploadPhoto = async (ctx, file) => {
  if (!file) {
    return
  }

  try {
    const dataUrl = await downscaled(file)
    ctx.storage.set('own', dataUrl)
    $own.set(dataUrl)
    setSetting('backdrop.image', dataUrl)
  } catch (error) {
    host.notifyError(error, 'Could not read that image.')
  }
}

function PhotoTile({ ctx }) {
  const bd = useValue($backdrop)
  const own = useValue($own)
  const input = useRef(null)
  const active = bd.scene === 'custom' && own !== null && bd.image === own

  const upload = file => void uploadPhoto(ctx, file)

  const pick = () => {
    haptic('tap')

    if (own) {
      setSetting('backdrop.image', own)
    } else {
      input.current?.click()
    }
  }

  const remove = event => {
    event.stopPropagation()
    haptic('tap')
    ctx.storage.remove('own')
    $own.set(null)

    if (getSetting('backdrop.image') === own) {
      setSetting('backdrop.image', null)
    }
  }

  return jsxs('div', {
    className: 'group relative',
    children: [
      jsxs('button', {
        type: 'button',
        'aria-pressed': active,
        className: tileClass(active),
        onClick: pick,
        title: own ? 'Apply your photo' : 'Upload a photo',
        children: [
          jsxs('div', {
            className: swatchClass,
            children: [
              own
                ? jsx('img', { alt: '', className: 'absolute inset-0 size-full object-cover', src: own })
                : jsx(icons.FileImage, { className: 'size-4' })
            ]
          }),
          jsx('div', { className: captionClass, children: own ? 'Your photo' : 'Upload photo…' })
        ]
      }),
      own
        ? jsx('button', {
            type: 'button',
            'aria-label': 'Remove your photo',
            className:
              'absolute right-2.5 top-2.5 grid size-5 place-items-center rounded-md bg-(--ui-bg-elevated)/85 text-(--ui-text-tertiary) opacity-0 backdrop-blur-sm transition hover:text-(--ui-red) focus-visible:opacity-100 group-hover:opacity-100',
            onClick: remove,
            children: jsx(icons.X, { className: 'size-3' })
          })
        : null,
      jsx('input', {
        accept: 'image/*',
        className: 'hidden',
        onChange: event => {
          void upload(event.target.files?.[0])
          event.target.value = ''
        },
        ref: input,
        type: 'file'
      })
    ]
  })
}

/** Soft/vivid veil from the old picker, now driving the native strength slot
 *  (soft → subtle; the middle balanced stays reachable in Appearance). */
const STRENGTH_LEVELS = [['soft', 'subtle'], ['vivid', 'vivid']]

function StrengthToggle() {
  const strength = useValue($strength)

  return jsx('div', {
    role: 'group',
    'aria-label': 'Backdrop strength',
    className: 'flex items-center gap-0.5 rounded-lg border border-(--ui-stroke-tertiary) p-0.5',
    children: STRENGTH_LEVELS.map(([label, value]) =>
      jsx('button', {
        type: 'button',
        'aria-pressed': strength === value,
        className: cn(
          'rounded-md px-2.5 py-1 text-xs capitalize transition',
          strength === value
            ? 'bg-primary text-primary-foreground'
            : 'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)'
        ),
        onClick: () => {
          haptic('tap')
          setSetting('backdrop.strength', value)
        },
        children: label
      }, value)
    )
  })
}

/** Upload/apply row for the quick-pick: your photo beside the strength veil. */
function QuickPhoto({ ctx }) {
  const bd = useValue($backdrop)
  const own = useValue($own)
  const input = useRef(null)
  const active = bd.scene === 'custom' && own !== null && bd.image === own

  return jsxs('div', {
    className: 'flex items-center gap-1.5',
    children: [
      own
        ? jsx('button', {
            type: 'button',
            'aria-label': 'Apply your photo',
            title: 'Apply your photo',
            'aria-pressed': active,
            className: cn(
              'size-8 overflow-hidden rounded-lg border transition',
              active ? 'border-primary ring-2 ring-primary/30' : 'border-(--ui-stroke-tertiary) hover:opacity-90'
            ),
            onClick: () => applyDrop(ctx, own),
            children: jsx('img', { alt: '', className: 'size-full object-cover', src: own })
          })
        : jsx('button', {
            type: 'button',
            'aria-label': 'Upload a photo',
            title: 'Upload a photo',
            className:
              'grid size-8 place-items-center rounded-lg border border-dashed border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) transition hover:bg-(--chrome-action-hover)',
            onClick: () => {
              haptic('tap')
              input.current?.click()
            },
            children: jsx(icons.Plus, { className: 'size-4' })
          }),
      jsx('input', {
        accept: 'image/*',
        className: 'hidden',
        onChange: event => {
          void uploadPhoto(ctx, event.target.files?.[0])
          event.target.value = ''
        },
        ref: input,
        type: 'file'
      })
    ]
  })
}

/** The statusbar quick-pick: the same gallery drops one click away, no detour
 *  through Settings. Thin by design — it applies through the same native
 *  'custom' slot as the gallery card, so both surfaces always agree. */
function QuickPick({ ctx }) {
  const bd = useValue($backdrop)
  const drops = useValue($drops)
  const live = bd.scene === 'custom' && bd.image !== null

  return jsxs(Popover, {
    children: [
      jsx(PopoverTrigger, {
        asChild: true,
        children: jsx('button', {
          type: 'button',
          title: 'Pick a chat backdrop',
          'aria-label': 'Pick a chat backdrop',
          className: cn(
            'inline-flex h-full items-center gap-1.5 px-1.5 text-[0.6875rem] hover:bg-(--chrome-action-hover) hover:text-foreground',
            live ? 'text-foreground' : 'text-(--ui-text-tertiary)'
          ),
          children: jsx(icons.ImageIcon, { className: 'size-3.5' })
        })
      }),
      jsx(PopoverContent, {
        align: 'end',
        side: 'top',
        className: 'w-72 p-2',
        children: jsxs('div', {
          className: 'flex flex-col gap-2',
          children: [
            jsxs('div', {
              className: 'grid grid-cols-4 gap-1.5',
              children: drops.map(drop => {
            const active = bd.scene === 'custom' && bd.image === drop.url

            return jsx('button', {
              type: 'button',
              'aria-label': drop.title,
              title: drop.title,
              'aria-pressed': active,
              className: cn(
                'overflow-hidden rounded-md border transition',
                active ? 'border-primary ring-2 ring-primary/30' : 'border-(--ui-stroke-tertiary) hover:opacity-90'
              ),
              onClick: () => applyDrop(ctx, drop.url),
              children: jsx('img', {
                alt: '',
                className: 'aspect-square size-full object-cover',
                decoding: 'async',
                loading: 'lazy',
                src: drop.thumb
              })
            }, drop.id)
            })
          }),
          jsxs('div', {
            className: 'flex items-center justify-between gap-2 border-t border-(--ui-stroke-tertiary) pt-2',
            children: [jsx(QuickPhoto, { ctx }), jsx(StrengthToggle, {})]
          })
        ]
        })
      })
    ]
  })
}

function BackdropsCard({ ctx }) {
  const drops = useValue($drops)
  const origin = useValue($origin)

  const status =
    origin === 'live'
      ? `${drops.length} drops`
      : origin === 'cached'
        ? `${drops.length} drops · offline`
        : origin === 'bundled'
          ? 'Bundled set · offline'
          : 'Refreshing…'

  return jsxs('section', {
    className: 'mt-8',
    'aria-label': 'Backdrop gallery',
    children: [
      jsxs('div', {
        className: 'mb-2 flex items-baseline justify-between gap-3',
        children: [
          jsxs('div', {
            children: [
              jsx('h3', { className: 'text-sm font-medium', children: 'Backdrop gallery' }),
              jsx('p', {
                className: 'mt-0.5 text-xs text-(--ui-text-tertiary)',
                children: 'Fresh drops and your own photo — strength and scenes live in Chat Background above.'
              })
            ]
          }),
          jsxs('div', {
            className: 'flex items-center gap-2 text-xs text-(--ui-text-tertiary)',
            children: [
              jsx('span', { children: status }),
              jsx('button', {
                type: 'button',
                'aria-label': 'Refresh drops',
                className:
                  'grid size-6 place-items-center rounded-md text-(--ui-text-tertiary) transition hover:bg-(--ui-control-hover-background) hover:text-(--ui-text-secondary)',
                onClick: () => {
                  haptic('tap')
                  void refresh(ctx)
                },
                children: jsx(icons.RefreshCw, { className: 'size-3.5' })
              })
            ]
          })
        ]
      }),
      jsxs('div', {
        className: 'grid grid-cols-4 gap-2',
        children: [
          jsx(PhotoTile, { ctx }, 'photo'),
          ...drops.map(drop => jsx(DropTile, { ctx, drop }, drop.id))
        ]
      })
    ]
  })
}

/** Fetch the remote manifest and fold it over the bundled list. Never throws:
 *  a bad reach leaves the last good list (or the bundled floor) on the wall. */
const refresh = async ctx => {
  const base = manifestBase(ctx)

  try {
    const controller = new AbortController()
    const cancel = ctx.setTimeout(() => controller.abort(), FETCH_MS)
    const response = await fetch(base, { cache: 'no-store', signal: controller.signal })
    cancel()

    if (!response.ok) {
      throw new Error(`manifest ${response.status}`)
    }

    const body = await response.json()
    const remote = normalize(base, body?.drops)

    if (remote.length === 0) {
      throw new Error('manifest carried no usable drops')
    }

    const merged = new Map(remote.map(drop => [drop.id, drop]))

    for (const drop of BUNDLED) {
      if (!merged.has(drop.id)) {
        const read = readDrop(base, drop)

        if (read) {
          merged.set(read.id, read)
        }
      }
    }

    const drops = [...merged.values()].sort(byNewest)
    $drops.set(drops)
    $origin.set('live')
    ctx.storage.set('gallery', drops)
  } catch {
    const cached = ctx.storage.get('gallery', null)
    const drops = normalize(base, cached)

    if (drops.length > 0) {
      $drops.set(drops)
      $origin.set('cached')
    } else {
      $drops.set(normalize(base, BUNDLED))
      $origin.set('bundled')
    }
  }
}

export default {
  id: 'backdrops',
  name: 'Backdrops',
  description: 'A gallery of fresh chat backdrops plus your own photo.',
  register(ctx) {
    $own = atom(ctx.storage.get('own', null))

    // Heal a relative URL stored by a pre-normalization gallery click: it can
    // never paint (it 404s against the app base), so resolve it against the
    // manifest it came from — or clear it when it resolves to nothing usable.
    try {
      const stored = getSetting('backdrop.image')

      if (typeof stored === 'string' && !isAbsolute(stored)) {
        const healed = resolveAgainst(MANIFEST_URL, stored)
        setSetting('backdrop.image', healed && isHttp(healed) ? healed : null)
      }
    } catch {
      // Pre-backdrop-keys build: the card still renders; tiles stay inert.
    }

    const readBackdrop = () => ({
      image: getSetting('backdrop.image'),
      scene: getSetting('backdrop.scene')
    })

    $backdrop.set(readBackdrop())

    try {
      ctx.onDispose(host.settings.subscribe('backdrop.image', () => $backdrop.set(readBackdrop())))
      ctx.onDispose(host.settings.subscribe('backdrop.scene', () => $backdrop.set(readBackdrop())))
      $strength.set(getSetting('backdrop.strength') ?? 'balanced')
      ctx.onDispose(host.settings.subscribe('backdrop.strength', value => $strength.set(value)))
    } catch {
      // Pre-backdrop-keys build: the card still renders; tiles stay inert.
    }

    ctx.register({
      id: 'gallery',
      area: APPEARANCE_AREAS.extra,
      render: () => jsx(BackdropsCard, { ctx })
    })

    ctx.register({
      id: 'picker',
      area: STATUSBAR_AREAS.right,
      order: 140,
      render: () => jsx(QuickPick, { ctx })
    })

    void refresh(ctx)
    ctx.setInterval(() => void refresh(ctx), REFRESH_MS)
  }
}
