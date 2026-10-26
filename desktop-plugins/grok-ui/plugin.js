// grok-ui — Hermes desktop plugin: switchable Grok/ChatGPT-style conversational surface.
// Layers ON TOP of Hermes (keeps every pet, theme, plugin, feature). Adds:
//   • a /grok full-page route (Grok-style chat shell over the real gateway)
//   • a sidebar nav row ("Grok") to switch between Classic chat and Grok view
//   • a statusbar chip + ⌘K command
// Plain ESM, NO JSX. Imports ONLY from @hermes/plugin-sdk and react/jsx-runtime.
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import * as React from 'react'
import {
  cn,
  host,
  useQuery,
  useValue,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  PALETTE_AREA,
  STATUSBAR_AREAS,
  THEMES_AREA,
  Button,
  Input,
  StatusDot,
  Skeleton,
  EmptyState,
  ErrorState,
} from '@hermes/plugin-sdk'

const ID = 'grok-ui'

const EMPTY_GROK = `Start a thread — your agent streams here in a Grok-style
unboxed canvas. Same Hermes engine, same pets, new look.`

// Grok palette (mirrors the Aug-13 Grok AI-native overhaul: near-black canvas,
// hairline borders, warm-white text, gold accent). All via tokens where the
// SDK exposes them; hardcoded only where no semantic token exists.
const COLORS = {
  canvas: '#0d0e12',
  panel: '#13151b',
  card: '#181a22',
  border: 'rgba(255,255,255,0.08)',
  text: '#f4f4f5',
  muted: 'rgba(244,244,245,0.6)',
  dim: 'rgba(244,244,245,0.38)',
  accent: '#ffbf00',
  userBubble: '#21232d',
}

function GrokPage() {
  // host.activeSessionId is a nanostore atom; useValue subscribes in the leaf.
  // Guard: on runtimes where the atom is undefined, fall back to no session.
  const [sidBox, setSidBox] = React.useState(() => Boolean(host.activeSessionId?.get))
  React.useEffect(() => { setSidBox(Boolean(host.activeSessionId?.get)) }, [])
  const sid = sidBox ? (useValue(host.activeSessionId) ?? null) : null
  const [input, setInput] = React.useState('')
  const [thinking, setThinking] = React.useState(false)
  const [turn, setTurn] = React.useState(0)
  const feedRef = React.useRef(null)

  const { data: sessions, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['grok-ui', 'sessions'],
    queryFn: () => host.request('session.list', { limit: 1 }),
    enabled: Boolean(sid),
    refetchInterval: 4000,
    staleTime: 2000,
  })

  // Real active-session messages come off the gateway event stream; we also
  // render whatever the last stored session exposes so the canvas isn't empty
  // on first paint. (Verified RPC doors: prompt.submit / session.create /
  // session.list / session.resume / session.set_hidden — no 'session.get'.)
  const msgs = Array.isArray(sessions)
    ? (sessions[0]?.messages ?? [])
    : (sessions?.messages ?? sessions?.turns ?? [])

  // Stream deltas straight from the gateway so the canvas stays live.
  React.useEffect(() => {
    if (!sid) return
    const sub = host.onEvent?.('*', (e) => {
      const t = e?.type ?? ''
      if (t?.includes('delta') || t?.includes('token')) setTurn((n) => n + 1)
      if (t?.includes('complete') || t?.includes('tool')) setThinking(false)
    })
    return () => sub?.()
  }, [sid])

  const send = () => {
    const q = input.trim()
    if (!q || !sid) return
    setThinking(true)
    setInput('')
    void host.request('prompt.submit', { id: sid, text: q })
      .finally(() => setTimeout(() => setThinking(false), 900))
  }

  const model = host.model?.get?.()

  return jsx('div', {
    style: { background: COLORS.canvas, color: COLORS.text },
    className: 'flex flex-col h-full w-full text-[13px]',
    children: [
      // Top bar — slim, Grok/Linear style
      jsxs('div', {
        className: 'flex items-center justify-between px-5 h-12 border-b shrink-0',
        style: { borderColor: COLORS.border },
        children: [
          jsxs('div', { className: 'flex items-center gap-2 text-[13px]', children: [
            jsx('span', { style: { color: COLORS.accent, fontWeight: 700 }, children: 'Grok' }),
            jsx('span', { style: { color: COLORS.dim }, children: '· Hermes engine' }),
          ]}),
          jsxs('div', { className: 'flex items-center gap-3 text-[11px]', children: [
            model ? jsx('span', { style: { color: COLORS.muted, fontFamily: 'monospace' }, children: model }) : null,
            jsx(StatusDot, { tone: sid ? 'success' : 'muted' }),
          ]}),
        ],
      }),

      // Message canvas — unboxed, streaming
      jsx('div', {
        ref: feedRef,
        className: 'flex-1 overflow-y-auto px-6',
        children:
          sid === null
            ? jsx(EmptyState, {
                title: 'Start or open a session',
                message: 'Use ⌘K → Grok: Open session, or head to the sidebar and open any existing chat — it renders here in Grok view.',
              })
            : isLoading
              ? jsxs('div', { className: 'space-y-3 py-4', children: [
                  jsx(Skeleton, { style: { height: 40, width: '60%' } }),
                  jsx(Skeleton, { style: { height: 80, width: '85%' } }),
                  jsx(Skeleton, { style: { height: 40, width: '45%' } }),
                ]})
              : isError
                ? jsx(ErrorState, { title: 'Could not load session', message: error?.message, onRetry: () => refetch() })
                : (msgs.length === 0
                    ? jsx('div', { className: 'py-10 text-center', style: { color: COLORS.dim }, children: EMPTY_GROK })
                    : jsx('div', { className: 'py-4 space-y-4 max-w-3xl', children: msgs.map((m, i) => {
                        const user = m.role === 'user' || m.role === 'human'
                        const text = m.content ?? m.text ?? ''
                        return jsxs('div', {
                          key: i,
                          className: 'flex gap-3 ' + (user ? 'justify-end' : 'justify-start'),
                          children: [
                            user
                              ? jsx('div', {
                                  className: 'max-w-[78%] px-4 py-2 rounded-2xl text-[13.5px] leading-relaxed whitespace-pre-wrap',
                                  style: { background: COLORS.userBubble, color: COLORS.text, border: '1px solid ' + COLORS.border },
                                  children: text,
                                })
                              : jsxs(Fragment, { children: [
                                  jsx('div', {
                                    className: 'w-7 h-7 rounded-lg shrink-0 mt-0.5 flex items-center justify-center text-[11px] font-bold',
                                    style: { background: COLORS.panel, color: COLORS.accent, border: '1px solid ' + COLORS.border },
                                    children: 'H',
                                  }),
                                  jsx('div', {
                                    className: 'w-full text-[14px] leading-relaxed whitespace-pre-wrap',
                                    style: { color: COLORS.text },
                                    children: text,
                                  }),
                                ]}),
                          ],
                        })
                      })})),
      }),

      // Floating pill composer — Grok signature
      jsx('div', { className: 'shrink-0 px-6 py-4', children:
        jsx('div', {
          className: 'flex items-center gap-2 rounded-3xl border px-4 py-2.5 focus-within:ring-2',
          style: { background: COLORS.card, borderColor: COLORS.border, boxShadow: '0 12px 32px -12px rgba(0,0,0,0.6)' },
          children: [
            jsx(Input, {
              value: input,
              placeholder: thinking ? 'Agent is working…' : 'Ask your agent anything…',
              onChange: (e) => setInput(e.target?.value ?? ''),
              onKeyDown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } },
              className: 'flex-1 bg-transparent border-0 outline-none text-[14px]',
              style: { color: COLORS.text, background: 'transparent' },
              disabled: !sid || thinking,
            }),
            jsx(Button, {
              onClick: send,
              disabled: !sid || !input.trim() || thinking,
              style: { background: COLORS.accent, color: '#0d0e12', borderRadius: 999, fontWeight: 700, padding: '6px 18px' },
              children: thinking ? '…' : jsx('span', { children: '↑' }),
            }),
          ],
        }),
      }),
    ],
  })
}

export default {
  id: ID,
  name: 'Grok UI',
  register(ctx) {
    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: '/grok' },
      title: 'Grok',
      render: () => jsx(GrokPage, {}),
    })
    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      order: 45,
      data: { codicon: 'comment-discussion', label: 'Grok', path: '/grok' },
    })
    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      order: 45,
      render: () => jsx(GrokChip, {}),
    })
    ctx.register({
      id: 'open',
      area: PALETTE_AREA,
      data: {
        id: 'grok-ui.open',
        label: 'Grok: Open Grok view',
        keywords: ['grok', 'chatgpt', 'skin', 'style', 'view'],
        run: () => host.navigate?.('/grok'),
      },
    })
    // THEMES_AREA data contribution: a DesktopTheme. The desktop app renders
    // from its own DesktopTheme model (not CLI display.skin), so this is what
    // actually turns the whole desktop dark-Grok. Appears in Appearance / ⌘K.
    ctx.register({
      id: 'theme',
      area: THEMES_AREA,
      data: {
        name: 'grok',
        label: 'Grok (dark)',
        description: 'Grok/ChatGPT AI-native — near-black canvas, gold accent',
        colors: {
          background: '#0d0e12', foreground: '#e7e7ea',
          card: '#13151b', cardForeground: '#e7e7ea',
          muted: '#181a22', mutedForeground: '#8b8f9c',
          popover: '#13151b', popoverForeground: '#e7e7ea',
          primary: '#ffbf00', primaryForeground: '#0d0e12',
          secondary: '#181a22', secondaryForeground: '#d0d2d8',
          accent: '#c9a227', accentForeground: '#0d0e12',
          border: 'rgba(255,255,255,0.09)', input: '#1c1e26',
          ring: '#ffbf00', midground: '#ffbf00', composerRing: '#ffbf00',
          destructive: '#e5484d', destructiveForeground: '#ffffff',
          sidebarBackground: '#121318', sidebarBorder: 'rgba(255,255,255,0.08)',
          userBubble: '#21232d', userBubbleBorder: 'rgba(255,255,255,0.12)'
        }
      },
    })
  },
}

function GrokChip() {
  const sid = host.activeSessionId?.get?.() ?? null
  return jsxs('span', { className: 'flex items-center gap-1 text-xs', children: [
    jsx(StatusDot, { tone: sid ? 'success' : 'muted' }),
    jsx('span', { children: host.model?.get?.() ?? 'Grok' }),
  ]})
}
