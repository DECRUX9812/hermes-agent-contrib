/**
 * Pixel Pets — status bar chip + popover, plus a /pixel-pets page.
 *
 * Simple mode hides the status bar, so the page is also reachable from a
 * sidebar row (no tier: shown in both modes) and from Ctrl+K. The row stays
 * quiet: it only carries a badge while a pet is waiting on the user.
 *
 * Live pet office: a small "🐾 N" chip in the status bar opens a popover
 * showing every Hermes agent as a pixel-art pet with mood animations
 * (working = typing, idle = zZz, etc). It used to be a bottom-docked pane
 * that took a fixed 220px from every chat; now it costs one chip, and
 * nothing at all when the office backend is off.
 * Click a pet to chat with it — a real conversation with that profile's
 * canonical "Bot Chat" session (backend resumes it and captures the reply).
 * "⧉" pops the chat into its own browser window
 * (http://127.0.0.1:8113/chat.html?profile=X).
 *
 * v1.3.0: data comes from the plugin's own backend namespace
 * (/api/plugins/pixel-office/...): every 2.5s while the popover is open,
 * every 10s while closed, backing off to 60s while the backend is down.
 */

import {
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  haptic,
  host,
  Popover,
  PopoverContent,
  PopoverTrigger,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
  useQuery,
  useQueryClient
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'

const ID = 'pixel-office'
const PAGE = '/pixel-pets'
const ATTN_MS = 30_000
const ATTN_DOWN_MAX_MS = 300_000

// Pet roster — every Hermes profile is a named pet with species + color.
const PET = {
  default: ['Hermes', '🐱', '#5aa7ff', 'cat'],
  researcher: ['Scout', '🦊', '#b48cff', 'fox'],
  trader: ['Maverick', '🐂', '#3ddc97', 'bull'],
  scribe: ['Quill', '🐧', '#4ec9b0', 'penguin'],
  ops: ['Wrench', '🐶', '#ff9f5a', 'puppy'],
  manager: ['Director', '🦉', '#ff5c6c', 'owl']
}
const WORKER_PET = ['Worker', '🐹', '#8b93a7', 'hamster']
function petFor(a) { return PET[a.profile] || WORKER_PET }

// Pixel sprites: '.' = transparent, B = body, W = white, A = accent,
// E = eye, P = pink.  Same chibi pets as the web office.
const SPRITES = {
  cat: [
    "...BBBB...",
    "..BBBBBB..",
    "..BBBBBB..",
    ".BBBBBBBB.",
    ".BBEBBEBB.",
    ".BBWWWWBB.",
    "AB......BA",
    ".BBBBBBBB.",
    "..BBBBBB..",
    "...BBBB...",
    "...BBBB...",
    "...B..B...",
  ],
  fox: [
    ".WWW..WWW.",
    ".WBB..BBW.",
    ".BBB..BBB.",
    ".BBBBBBBB.",
    ".BBWWWWBB.",
    ".BEWWWWEB.",
    ".BBWWWWBB.",
    ".BBWWWWBB.",
    "..BWWWWB..",
    "..BBBBBB..",
    "...BBBB...",
    "...B..B...",
  ],
  bull: [
    "AA......AA",
    ".AB....BA.",
    ".ABB..BBA.",
    ".BBBBBBBB.",
    ".BBWWWWBB.",
    ".BBEBBEBB.",
    ".BBBBBBBB.",
    ".BBBBBBBB.",
    ".BBA..ABB.",
    ".BBBBBBBB.",
    "...BBBB...",
    "...B..B...",
  ],
  penguin: [
    "..BBBBBB..",
    ".BBBBBBBB.",
    ".BBWWWWBB.",
    ".BBEBBEBB.",
    "....AA....",
    "....AA....",
    ".BBWWWWBB.",
    ".BBWWWWBB.",
    ".BBWWWWBB.",
    "..BBBBBB..",
    "...BBBB...",
    "...B..B...",
  ],
  puppy: [
    "BBB....BBB",
    "BBB....BBB",
    "BBBBBBBBBB",
    ".BBEBBEBB.",
    ".BBBBBBBB.",
    ".BBWWWWBB.",
    ".BBWWWWBB.",
    "....PP....",
    "....PP....",
    "..BBBBBB..",
    "...BBBB...",
    "...B..B...",
  ],
  owl: [
    "..BBBBBB..",
    ".BBBBBBBB.",
    ".BBBBBBBB.",
    ".BWWWWWWB.",
    ".BEWWWWEB.",
    ".BWWWWWWB.",
    ".BBBBBBBB.",
    "....AA....",
    "..BBBBBB..",
    "..BBBBBB..",
    "...BBBB...",
    "...B..B...",
  ],
  hamster: [
    ".B......B.",
    "..BBBBBB..",
    ".BBBBBBBB.",
    ".BBEBBEBB.",
    ".BBPBBPBB.",
    ".BBBBBBBB.",
    ".BBBBBBBB.",
    ".BBBBBBBB.",
    "..BBBBBB..",
    "...BBBB...",
    "...BBBB...",
    "...B..B...",
  ],
};
const EYE = '#1b2233'
const PINK = '#ff8fa3'

function spriteSvg(species, color, px) {
  const rows = SPRITES[species] || SPRITES.hamster
  let s = '<svg width="' + rows[0].length * px + '" height="' + rows.length * px +
    '" viewBox="0 0 ' + rows[0].length + ' ' + rows.length +
    '" shape-rendering="crispEdges" aria-hidden="true">'
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x]
      if (ch === '.') continue
      const fill = ch === 'A' ? '#ffffff' : ch === 'W' ? '#ffffff' : ch === 'E' ? EYE : ch === 'P' ? PINK : color
      s += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + fill + '"/>'
    }
  }
  return s + '</svg>'
}

// Moods — emoji + theme color per status.
const MOOD = { working: '💻', thinking: '💭', waiting: '🤔', idle: '😴', done: '✅', gone: '👻' }
const STATUS_COLORS = {
  working: 'var(--ui-accent)',
  thinking: 'var(--ui-text-secondary)',
  waiting: 'var(--ui-accent)',
  idle: 'var(--ui-text-tertiary)',
  done: 'var(--ui-accent)',
  gone: 'var(--ui-text-tertiary)'
}

function ago(ts) {
  if (!ts) return ''
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  return Math.floor(s / 3600) + 'h'
}

function AgentCard({ a, now, onChat }) {
  const whipped = a.whipped_at && now - a.whipped_at < 15
  const pet = petFor(a)
  const status = whipped ? 'whipped' : (a.status || 'idle')
  const chatable = a.kind !== 'subagent' && !!a.profile
  return jsxs('div', {
    role: chatable ? 'button' : undefined,
    tabIndex: chatable ? 0 : undefined,
    onClick: chatable ? () => onChat(a.profile) : undefined,
    onKeyDown: chatable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChat(a.profile) } } : undefined,
    title: chatable ? 'Click to chat with ' + pet[0] : a.label,
    className: cn(
      'group relative flex items-center gap-2 rounded-lg border px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)',
      'border-(--ui-stroke-secondary) bg-(--chrome-action-hover)',
      'pet-' + status,
      whipped && 'pet-whipped border-(--ui-accent)',
      chatable && 'cursor-pointer transition-colors hover:border-(--ui-accent)'
    ),
    children: [
      // the pet sprite — animated by CSS based on .pet-<status>
      jsx('div', {
        className: 'pet-sprite shrink-0',
        style: { filter: 'drop-shadow(0 2px 0 rgba(0,0,0,.35))' },
        dangerouslySetInnerHTML: { __html: spriteSvg(pet[3], pet[2], 3) }
      }),
      jsxs('div', { className: 'min-w-0 flex-1', children: [
        jsxs('div', { className: 'flex items-center gap-1', children: [
          jsx('span', { className: 'truncate text-xs font-semibold', style: { color: pet[2] }, children: pet[1] + ' ' + pet[0] }),
          a.kind === 'subagent' && jsx('span', { className: 'rounded border border-(--ui-stroke-secondary) px-1 text-[0.6875rem] text-(--ui-text-tertiary)', children: 'sub' }),
          whipped && jsx('span', { children: '💥' })
        ]}),
        jsx('div', { className: 'truncate font-mono text-[0.6875rem] text-(--ui-text-tertiary)', children: (a.tool || a.detail || (a.platform || 'hermes')) + ' · ' + ago(a.updated_at) }),
        jsxs('div', { className: 'flex items-center gap-1', children: [
          jsx('span', { className: 'inline-block size-1.5 rounded-full', style: { background: STATUS_COLORS[status] || STATUS_COLORS.idle } }),
          jsx('span', {
            className: cn('text-[0.6875rem] font-medium text-(--ui-text-tertiary)', status === 'working' && 'text-(--ui-accent)', status === 'thinking' && 'text-(--ui-text-secondary)', status === 'waiting' && 'text-(--ui-accent)'),
            children: (MOOD[status] ? MOOD[status] + ' ' : '') + status
          })
        ]})
      ]}),
      chatable && jsx('span', { className: 'ml-0.5 shrink-0 text-xs opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70', children: '💬' })
    ]
  })
}

function ChatModal({ profile, onClose }) {
  const qc = useQueryClient()
  const bot = PET[profile] || WORKER_PET
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const { data } = useQuery({
    queryKey: [ID, 'chat', profile],
    queryFn: async () => ctxRest('/chat/history', { method: 'POST', body: { profile } }),
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    enabled: !!profile
  })

  const msgs = (data && data.messages) || []
  const pending = !!(data && data.pending)

  const send = ev => {
    ev.preventDefault()
    const text = input.trim()
    if (!text || sending || pending) return
    haptic('tap')
    setSending(true)
    setInput('')
    void (async () => {
      try {
        await ctxRest('/chat', { method: 'POST', body: { profile, message: text } })
        qc.invalidateQueries({ queryKey: [ID, 'chat', profile] })
      } catch (e) {
        host.notify({ kind: 'error', message: 'Could not reach the pet: ' + (e && e.message) })
      }
      setSending(false)
    })()
  }

  const popOut = () => {
    void (async () => {
      try {
        const u = await ctxRest('/url', { method: 'GET' })
        const base = (u && u.url) || 'http://127.0.0.1:8113'
        await ctxOs.openExternal(base + '/chat.html?profile=' + encodeURIComponent(profile))
      } catch (e) {
        host.notify({ kind: 'error', message: 'Could not open chat window: ' + (e && e.message) })
      }
    })()
  }

  const busy = sending || pending

  // SDK Dialog: portalled above the app, focus-trapped, Escape closes, and on
  // the shared modal layer instead of a private z-[9999].
  return jsx(Dialog, {
    open: true,
    onOpenChange: next => { if (!next) onClose() },
    children: jsxs(DialogContent, {
        showCloseButton: false,
        className: 'max-w-[calc(100vw-1rem)]',
        style: { width: '460px' },
        bodyClassName: 'flex flex-col gap-0 overflow-hidden p-0',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2.5 border-b border-(--ui-stroke-secondary) px-3.5 py-2.5',
            children: [
              jsx('div', {
                className: 'grid size-9 shrink-0 place-items-center rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-quaternary)',
                dangerouslySetInnerHTML: { __html: spriteSvg(bot[3], bot[2], 3) }
              }),
              jsxs('div', {
                className: 'min-w-0 flex-1',
                children: [
                  jsx(DialogTitle, {
                    className: 'truncate text-sm font-semibold',
                    style: { color: bot[2] },
                    children: bot[1] + ' ' + bot[0]
                  }),
                  jsx('div', {
                    className: 'truncate font-mono text-[0.6875rem] text-(--ui-text-tertiary)',
                    children: profile + ' · Bot Chat'
                  })
                ]
              }),
              jsx('span', {
                className: 'rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium ' +
                  (pending ? 'border-(--ui-accent) text-(--ui-accent)' : 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary)'),
                children: pending ? 'typing…' : 'online'
              }),
              jsx('button', {
                type: 'button', onClick: popOut, title: 'Open in its own window', 'aria-label': 'Open in its own window',
                className: 'rounded-md border border-(--ui-stroke-secondary) px-2 py-1 text-xs text-(--ui-text-tertiary) transition-colors hover:text-(--ui-text-primary)',
                children: '⧉'
              }),
              jsx('button', {
                type: 'button', onClick: onClose, title: 'Close', 'aria-label': 'Close',
                className: 'rounded-md border border-(--ui-stroke-secondary) px-2 py-1 text-xs text-(--ui-text-tertiary) transition-colors hover:text-(--ui-text-primary)',
                children: '✕'
              })
            ]
          }),
          jsx('div', {
            className: 'flex flex-1 flex-col gap-2 overflow-y-auto px-3.5 py-3',
            children: [
              msgs.length === 0 && !pending &&
                jsx('div', { className: 'py-12 text-center text-xs text-(--ui-text-tertiary)', children: '🐾 Say hi — the pet picks up its Bot Chat session.' }),
              msgs.map((m, i) => jsxs('div', {
                style: { maxWidth: '85%' },
                className: cn(
                  'rounded-lg border border-(--ui-stroke-secondary) px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap',
                  m.role === 'user' ? 'self-end bg-(--ui-bg-quinary)' : 'self-start bg-(--ui-bg-quaternary)'
                ),
                children: [
                  jsx('div', {
                    className: 'mb-0.5 text-[0.6875rem] font-semibold opacity-80',
                    style: m.role === 'user' ? undefined : { color: bot[2] },
                    children: m.role === 'user' ? 'you' : bot[0]
                  }),
                  jsx('div', { children: m.text })
                ]
              }, i)),
              pending &&
                jsx('div', {
                  className: 'self-start rounded-lg border border-dashed border-(--ui-stroke-secondary) px-2.5 py-1.5 font-mono text-xs text-(--ui-text-tertiary)',
                  children: bot[0] + ' is thinking…'
                })
            ]
          }),
          jsx('form', {
            className: 'flex gap-2 border-t border-(--ui-stroke-secondary) p-3',
            onSubmit: send,
            children: [
              jsx('input', {
                value: input,
                onChange: e => setInput(e.target.value),
                placeholder: 'Message the pet…',
                'aria-label': 'Message ' + bot[0],
                disabled: busy,
                autoFocus: true,
                className: 'min-w-0 flex-1 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-input) px-2.5 py-1.5 text-xs text-(--ui-text-primary) outline-none focus:border-(--ui-accent)'
              }),
              jsx('button', {
                type: 'submit', disabled: busy,
                className: 'rounded-md border border-(--ui-accent) px-3 py-1.5 text-xs font-semibold text-(--ui-accent) transition-colors hover:bg-(--chrome-action-hover)',
                children: 'Send'
              })
            ]
          }),
          jsx('div', {
            className: 'border-t border-(--ui-stroke-secondary) px-3.5 py-1.5 text-center text-[0.6875rem] text-(--ui-text-tertiary)',
            children: pending
              ? bot[0] + ' is working on it — watch the office.'
              : 'Real Bot Chat session · ⧉ opens its own window.'
          })
        ]
    })
  })
}

// Poll fast only while someone is looking; back off while the backend is down
// so an office that is switched off costs (almost) nothing.
const OPEN_MS = 2500
const CLOSED_MS = 10_000
const DOWN_MAX_MS = 60_000

function useOffice(open) {
  return useQuery({
    queryKey: [ID, 'state'],
    queryFn: async () => ctxRest('/state', { method: 'GET' }),
    retry: false,
    refetchInterval: query => {
      const fails = query.state.fetchFailureCount || 0
      if (query.state.status === 'error' && fails > 0) {
        return Math.min(DOWN_MAX_MS, CLOSED_MS * 2 ** (fails - 1))
      }
      return open ? OPEN_MS : CLOSED_MS
    },
    refetchIntervalInBackground: false
  })
}

function OfficePanel({ data, onChat, page = false }) {
  const qc = useQueryClient()
  const agents = (data && data.agents) || []
  const whip = (data && data.whip) || { count: 0, last: null }

  const crack = () => {
    void (async () => {
      haptic('tap')
      try {
        await ctxRest('/whip', { method: 'POST', body: { by: 'desktop', target: '' } })
        host.notify({ kind: 'success', message: '💥 Crack! Every pet is back at work.' })
        qc.invalidateQueries({ queryKey: [ID, 'state'] })
      } catch {
        host.notify({ kind: 'error', message: 'Could not crack the whip. Is the Pixel Pets backend on?' })
      }
    })()
  }

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    style: page ? undefined : { maxHeight: 'min(28rem, 70vh)' },
    children: [
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx('span', { className: 'text-sm font-semibold text-(--ui-text-primary)', children: '🐾 Pixel Pets' }),
          jsx('span', {
            className: 'text-xs text-(--ui-text-tertiary)',
            children: agents.length + ' pet' + (agents.length === 1 ? '' : 's') + ' · ' + whip.count + ' whip' + (whip.count === 1 ? '' : 's')
          }),
          jsx('span', { className: 'flex-1' }),
          jsx('button', {
            type: 'button',
            onClick: crack,
            className: cn(
              'rounded-md border border-(--ui-accent) px-2 py-0.5 text-xs font-medium',
              'text-(--ui-accent) transition-colors hover:bg-(--chrome-action-hover) focus-visible:ring-2 focus-visible:ring-(--ui-accent) outline-none'
            ),
            children: 'Crack the whip'
          })
        ]
      }),
      agents.length === 0
        ? jsx('div', { className: 'py-4 text-center text-xs text-(--ui-text-tertiary)', children: 'No pets in the office yet. Start a Hermes session.' })
        : jsx('div', {
            className: page ? 'grid grid-cols-2 gap-2 sm:grid-cols-3' : 'grid grid-cols-2 gap-1.5 overflow-y-auto',
            style: { gridAutoRows: 'min-content' },
            children: agents.map(a => jsx(AgentCard, { a, now: (data && data.ts) || Date.now() / 1000, onChat }, a.id))
          }),
      agents.length > 0 && jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: 'Click a pet to chat with it.' }),
      whip.last &&
        jsx('div', {
          className: 'truncate border-t border-(--ui-stroke-secondary) pt-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
          children: '💥 "' + whip.last.line + '" · ' + whip.last.by + ', ' + ago(whip.last.ts) + ' ago'
        })
    ]
  })
}

function waitingCount(data) {
  return ((data && data.agents) || []).filter(a => a.status === 'waiting').length
}

function PetsPage() {
  const [chatProfile, setChatProfile] = useState(null)
  const { data, isError, isPending } = useOffice(true)

  return jsxs('div', {
    className: 'flex h-full min-h-0 w-full flex-col overflow-y-auto',
    children: [
      jsx('div', {
        className: 'mx-auto w-full p-4 sm:p-6',
        style: { maxWidth: '56rem' },
        children: isError
          ? jsxs('div', {
              className: 'flex flex-col gap-1 py-10 text-center',
              children: [
                jsx('span', { className: 'text-sm font-semibold text-(--ui-text-primary)', children: '🐾 Pixel Pets' }),
                jsx('span', { className: 'text-xs text-(--ui-text-tertiary)', children: 'The Pixel Pets backend is not running, so there are no pets to show right now.' })
              ]
            })
          : isPending
            ? jsx('div', { className: 'py-10 text-center text-xs text-(--ui-text-tertiary)', children: 'Loading pets…' })
            : jsx(OfficePanel, { data, onChat: setChatProfile, page: true })
      }),
      chatProfile && jsx(ChatModal, { profile: chatProfile, onClose: () => setChatProfile(null) })
    ]
  })
}

function PetsChip() {
  const [open, setOpen] = useState(false)
  const [chatProfile, setChatProfile] = useState(null)
  const { data, isError } = useOffice(open)

  // Backend off or still loading: no chip, no error text in the chrome.
  if (isError || !data) {
    return chatProfile ? jsx(ChatModal, { profile: chatProfile, onClose: () => setChatProfile(null) }) : null
  }

  const agents = data.agents || []
  const busy = agents.filter(a => a.status === 'working' || a.status === 'thinking').length
  const waiting = waitingCount(data)
  const label =
    'Pixel Pets: ' + agents.length + ' pet' + (agents.length === 1 ? '' : 's') +
    (busy ? ', ' + busy + ' busy' : '') + (waiting ? ', ' + waiting + ' waiting for you' : '')

  return jsxs('span', {
    className: 'contents',
    children: [
      jsxs(Popover, {
        open,
        onOpenChange: setOpen,
        children: [
          jsx(PopoverTrigger, {
            asChild: true,
            children: jsxs('button', {
              type: 'button',
              title: label,
              'aria-label': label,
              className: cn(
                'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] outline-none',
                'hover:bg-(--chrome-action-hover) hover:text-foreground focus-visible:ring-2 focus-visible:ring-(--ui-accent)',
                open || busy ? 'text-foreground' : 'text-(--ui-text-tertiary)'
              ),
              children: [
                jsx('span', { 'aria-hidden': true, children: '🐾' }),
                jsx('span', { className: 'tabular-nums', children: String(agents.length) }),
                // Calm by default: a still dot only while a pet is waiting on the user.
                waiting > 0 && jsx('span', { 'aria-hidden': true, className: 'inline-block size-1.5 rounded-full bg-(--ui-accent)' })
              ]
            })
          }),
          jsx(PopoverContent, {
            align: 'end',
            side: 'top',
            // Inline sizes throughout: arbitrary classes used only by a plugin are not in the host stylesheet.
            className: 'p-3',
            style: { width: 'min(26rem, calc(100vw - 1rem))', maxWidth: 'calc(100vw - 1rem)' },
            children: jsx(OfficePanel, {
              data,
              onChat: profile => {
                setOpen(false)
                setChatProfile(profile)
              }
            })
          })
        ]
      }),
      chatProfile && jsx(ChatModal, { profile: chatProfile, onClose: () => setChatProfile(null) })
    ]
  })
}

// ctx.rest + ctx.os are captured at register-time (see below) — plain
// closures keep the component signatures clean.
let ctxRest = async () => { throw new Error('not registered') }
let ctxOs = { openExternal: async () => false }

export default {
  id: ID,
  name: 'Pixel Pets',
  register(ctx) {
    ctxRest = (path, opts) => ctx.rest(path, opts)
    ctxOs = ctx.os || ctxOs

    // One injected stylesheet for pet animations — scoped to the pet cards.
    if (!document.getElementById('pixel-office-styles')) {
      const style = document.createElement('style')
      style.id = 'pixel-office-styles'
      style.textContent = [
        '@keyframes pixel-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }',
        '.pet-sprite { transition: transform .2s ease; }',
        '@media (prefers-reduced-motion: reduce) { .pet-sprite, .pixel-pulse { animation: none !important; } }',
        '.pet-working .pet-sprite { animation: pixel-bob .6s ease-in-out infinite; }',
        '.pet-thinking .pet-sprite { animation: pixel-tilt 1.8s ease-in-out infinite; }',
        '.pet-waiting .pet-sprite { animation: pixel-wobble 1.6s ease-in-out infinite; }',
        '.pet-idle .pet-sprite { animation: pixel-sleep 3.2s ease-in-out infinite; opacity: .82; }',
        '.pet-done .pet-sprite { animation: pixel-hop .55s ease; }',
        '.pet-gone .pet-sprite { opacity: .3; filter: grayscale(1); }',
        '.pet-whipped .pet-sprite { animation: pixel-hop .5s ease; }',
        '@keyframes pixel-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }',
        '@keyframes pixel-tilt { 0%,100% { transform: rotate(0); } 50% { transform: rotate(2deg) translateY(-1px); } }',
        '@keyframes pixel-wobble { 0%,100% { transform: rotate(0); } 30% { transform: rotate(-3deg); } 60% { transform: rotate(3deg); } }',
        '@keyframes pixel-sleep { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }',
        '@keyframes pixel-hop { 0% { transform: translateY(0); } 40% { transform: translateY(-10px); } 70% { transform: translateY(2px); } 100% { transform: translateY(0); } }'
      ].join('\n')
      document.head.appendChild(style)
    }

    // A status bar chip, not a docked pane: the office is a glance, so it
    // should not take a fixed slice of every chat. The page + palette row are
    // the second entry point (Simple mode has no status bar).
    ctx.registerMany([
      {
        id: 'chip',
        area: STATUSBAR_AREAS.right,
        order: 40,
        render: () => jsx(PetsChip, {})
      },
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: PAGE },
        render: () => jsx(PetsPage, {})
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'pixel-office.open',
          label: 'Open Pixel Pets',
          keywords: ['pets', 'pixel', 'office', 'agents'],
          run: () => host.navigate(PAGE)
        }
      }
    ])

    // Sidebar row. Re-registered only when the waiting count changes, so the
    // badge appears when a pet needs the user and disappears after.
    let waiting = 0
    const registerNav = () =>
      ctx.register({
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 60,
        data: { codicon: 'heart', label: 'Pixel Pets', path: PAGE, badge: waiting > 0 ? String(waiting) : undefined }
      })
    let disposeNav = registerNav()

    // Light attention poll: 30s, backing off to 5 min while the backend is
    // down, and skipped while the window is hidden.
    let timer = 0
    let fails = 0
    let stopped = false
    const tick = async () => {
      if (stopped) return
      if (document.visibilityState !== 'hidden') {
        try {
          const next = waitingCount(await ctxRest('/state', { method: 'GET' }))
          fails = 0
          if (next !== waiting) {
            waiting = next
            disposeNav()
            disposeNav = registerNav()
          }
        } catch {
          fails += 1
        }
      }
      if (!stopped) timer = setTimeout(tick, fails ? Math.min(ATTN_DOWN_MAX_MS, ATTN_MS * 2 ** fails) : ATTN_MS)
    }
    timer = setTimeout(tick, 1500)
    ctx.onDispose(() => {
      stopped = true
      clearTimeout(timer)
      disposeNav()
    })
  }
}
