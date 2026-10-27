/**
 * room-theme — group-room appearance controls for Hermes Desktop.
 *
 * WHAT IT IS: a CSS-only theme layer over the group chat (the multi-bot
 * room), driven entirely by anchors the room already ships. No React patch,
 * no tree wrap, no core edit — and it cannot touch Bot Mode chats or
 * Sessions, because every rule is scoped by a group-room-only anchor.
 *
 * WHY A PLUGIN, NOT CORE: the catalog already holds Bubble Mode (Bot Mode
 * chats only, `[data-chat-surface]`) and Grok UI (its own route); nothing in
 * it themes the group room, so this is a new capability, not a rename. The
 * room's density, meta contrast and speaker voice are taste, not behaviour —
 * keeping them here leaves the fork's markup shipping only its tokens while
 * this file re-pitches them.
 *
 * ANCHORS — all five verified present in the SHIPPED bundle
 * (dist-webapp/assets/index-*.js) and unique to the group room:
 *
 *   [data-pane-host^="plugin-workspace:hermes-bots:group:"]  the room pane
 *   [data-testid="group-speaker-dot"]                        the run dot
 *   [class*="text-(--speaker-color)"]                        the run name
 *   [data-slot="group-chat-message-content"]                 a message body
 *   div.grid:has(> div.group)                               the log grid
 *
 * SPEAKER VOICE: the room sets `--speaker-color` on each row (inline) and
 * its two consumers — the dot and the run name — read it. This plugin
 * restyles those consumers directly rather than re-declaring the variable,
 * because one mechanism has to cover both modes: `accent` could override the
 * row's inline value with `!important`, but `soft` needs the ORIGINAL hue to
 * mix against and a custom property may not reference itself. Restyling the
 * two consumers supports both, with no cascade fight against the inline row.
 * The avatar keeps the bot's own hue in every mode — it is the identity
 * chip, and its colour is a React prop, not this variable.
 *
 * META CONTRAST: quaternary is the app's 3:1 "incidental" tier (placeholders,
 * separators' labels — see themes/text-ramp.ts TEXT_CONTRAST_FLOOR), while
 * tertiary is the 4.5:1 body-adjacent tier. The room's timestamps render at
 * 0.625rem in quaternary — the smallest text on the faintest tier. Overriding
 * the TOKEN inside the room (not the `color` declarations) keeps every
 * `hover:text-foreground` rule working, since those set `color` outright.
 *
 * DENSITY: the log grid's row gap plus bubble padding, adjusted together so
 * both sides of the conversation move at once and the shared 85% content
 * column keeps lining up — never one side alone.
 */

import { ListRow, PALETTE_AREA, SegmentedControl, atom, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const PLUGIN_ID = 'room-theme'
const STYLE_ID = 'hermes-room-theme-style'

// The room pane, as the workspace door names it:
// openWorkspace(`${ID}:group:${slug}`) -> pane id `plugin-workspace:${that}`.
const ROOM = '[data-pane-host^="plugin-workspace:hermes-bots:group:"]'
const DOT = '[data-testid="group-speaker-dot"]'
const NAME = '[class*="text-(--speaker-color)"]'
const BODY = '[data-slot="group-chat-message-content"]'
const LOG_GRID = 'div.grid:has(> div.group)'
const BUBBLE = `div:has(> ${BODY})`

const VOICES = ['per-bot', 'soft', 'accent']
const DENSITIES = ['comfortable', 'compact', 'roomy']
const METAS = ['raised', 'stock']

const VOICE_LABEL = { accent: 'accent', 'per-bot': 'per-bot', soft: 'soft' }
const opts = (list) => list.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }))

const PLUGIN_CSS = /* css */ `
/* ---- meta contrast -------------------------------------------------- */
body.rt-meta-raised ${ROOM} {
  --ui-text-quaternary: var(--ui-text-tertiary);
}

/* ---- density -------------------------------------------------------- */
body.rt-density-compact ${ROOM} ${LOG_GRID} { gap: 0.125rem; }
body.rt-density-roomy ${ROOM} ${LOG_GRID} { gap: 0.5rem; }

body.rt-density-compact ${ROOM} ${BUBBLE} { padding: 0.25rem 0.75rem; }
body.rt-density-roomy ${ROOM} ${BUBBLE} { padding: 0.625rem 0.875rem; }

/* ---- speaker voice -------------------------------------------------- */
/* soft keeps every bot's own hue, mixed toward the surface so a room of
   saturated voices reads calmer without losing who is talking. */
body.rt-voice-soft ${ROOM} ${DOT} {
  background-color: color-mix(in srgb, var(--speaker-color) 75%, var(--ui-bg-primary)) !important;
}
body.rt-voice-soft ${ROOM} ${NAME} {
  color: color-mix(in srgb, var(--speaker-color) 75%, var(--ui-bg-primary)) !important;
}

body.rt-voice-accent ${ROOM} ${DOT} { background-color: var(--ui-accent) !important; }
body.rt-voice-accent ${ROOM} ${NAME} { color: var(--ui-accent) !important; }
`

let pluginCtx = null
let voice = 'per-bot'
let density = 'comfortable'
let meta = 'raised'
// Mirrors the three choices for the Settings page; the palette rows and the page both write through set().
const $choice = atom({ voice, density, meta })

function set(key, value) {
  if (key === 'voice') voice = value
  if (key === 'density') density = value
  if (key === 'meta') meta = value
  writeSetting(pluginCtx, key, value)
  applyClasses()
  $choice.set({ voice, density, meta })
}

// Settings › Plugins › Room theme (audit m10): the same three choices as the palette rows, discoverable.
function RoomThemeSettings() {
  const c = useValue($choice)
  const row = (key, title, description, list) =>
    jsx(ListRow, {
      title,
      description,
      action: jsx(SegmentedControl, { options: opts(list), value: c[key], onChange: (v) => set(key, v), sizing: 'content' }),
    })
  return jsxs('div', {
    className: 'flex flex-col',
    children: [
      row('density', 'Message density', 'Spacing between messages in group rooms.', DENSITIES),
      row('meta', 'Timestamp contrast', 'Raised makes room timestamps and meta text easier to read.', METAS),
      row('voice', 'Speaker colour', "Per-bot keeps each bot's colour; soft calms it; accent uses one colour for everyone.", VOICES),
    ],
  })
}

function readSetting(ctx, key, allowed, fallback) {
  try {
    const value = ctx.storage?.get?.(key, fallback)
    return allowed.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}

function writeSetting(ctx, key, value) {
  try {
    ctx.storage?.set?.(key, value)
  } catch {
    /* storage unavailable — holds for this window */
  }
}

function cycle(list, current) {
  const index = list.indexOf(current)
  return list[(index + 1) % list.length]
}

function applyClasses() {
  if (typeof document === 'undefined' || !document.body) return

  const body = document.body
  for (const name of [...body.classList]) {
    if (name.startsWith('rt-')) body.classList.remove(name)
  }
  body.classList.add(`rt-voice-${voice}`, `rt-density-${density}`, `rt-meta-${meta}`)
}

function injectStyle() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = PLUGIN_CSS
  ;(document.head || document.documentElement).appendChild(el)
}

function removeStyle() {
  if (typeof document === 'undefined') return
  document.getElementById(STYLE_ID)?.remove()
}

function dispose() {
  if (typeof document !== 'undefined' && document.body) {
    const body = document.body
    for (const name of [...body.classList]) {
      if (name.startsWith('rt-')) body.classList.remove(name)
    }
  }
  removeStyle()
}

function stateRow(ctx, spec) {
  ctx.register({
    id: spec.id,
    area: PALETTE_AREA,
    data: {
      id: `${PLUGIN_ID}.${spec.id}`,
      label: spec.label,
      keywords: spec.keywords,
      detail: spec.detail,
      detailVariant: 'state',
      keepOpen: true,
      run: spec.run
    }
  })
}

export default {
  id: PLUGIN_ID,
  name: 'Room theme',
  defaultEnabled: true,
  description:
    'Group-room appearance: message density, meta contrast and speaker voice. Group chats only; Bot Mode and Sessions untouched.',

  register(ctx) {
    pluginCtx = ctx
    voice = readSetting(ctx, 'voice', VOICES, 'per-bot')
    density = readSetting(ctx, 'density', DENSITIES, 'comfortable')
    meta = readSetting(ctx, 'meta', METAS, 'raised')

    injectStyle()
    applyClasses()
    $choice.set({ voice, density, meta })
    if (typeof ctx.registerSettingsPage === 'function') {
      ctx.registerSettingsPage({ id: 'settings', title: 'Room theme', icon: 'paintcan', render: () => jsx(RoomThemeSettings, {}) })
    }

    stateRow(ctx, {
      id: 'density',
      label: 'Room theme: message density',
      keywords: ['room', 'group', 'density', 'spacing', 'compact', 'roomy', 'tight', 'bubbles'],
      detail: () => density,
      run: () => set('density', cycle(DENSITIES, density))
    })

    stateRow(ctx, {
      id: 'meta',
      label: 'Room theme: meta contrast',
      keywords: ['room', 'group', 'contrast', 'timestamp', 'meta', 'readable', 'dim', 'tertiary'],
      detail: () => meta,
      run: () => set('meta', cycle(METAS, meta))
    })

    stateRow(ctx, {
      id: 'voice',
      label: 'Room theme: speaker voice',
      keywords: ['room', 'group', 'speaker', 'voice', 'accent', 'color', 'colour', 'dot', 'name'],
      detail: () => VOICE_LABEL[voice] || voice,
      run: () => set('voice', cycle(VOICES, voice))
    })

    if (typeof ctx.onDispose === 'function') ctx.onDispose(dispose)
  }
}
