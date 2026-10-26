/**
 * Plugin Dock — one place to see and toggle EVERY extension in the app.
 *
 * Surfaces:
 *   • Statusbar chip (🧩 N) — visible proof the plugin loaded; click = hub
 *   • Composer button (🧩 in the chat input row) — click = hub
 *   • Hub page (/plugin-dock, also in sidebar):
 *       – Agent/backend plugins: live list + toggles + install-from-GitHub
 *         (gateway plugins.manage RPC: list / toggle / install)
 *       – Desktop UI plugins: instant hot-reload toggles (localStorage door
 *         the app itself reads: hermes.desktop.pluginDecisions.v2)
 *
 * Deliberately dependency-light: no React Query — plain useState/useEffect,
 * so the hub renders even if provider context is unavailable.
 */
import {
  COMPOSER_AREAS,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
  host,
  Button,
  Input,
  Badge,
  Switch,
  SearchField,
  EmptyState,
  Separator,
  cn,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState, useEffect, useCallback } from 'react'

const DECISIONS_KEY = 'hermes.desktop.pluginDecisions.v2'
const KNOWN_UI_PLUGINS = [
  'advance-mode-toggle',
  'co-driver',
  'code-workspace',
  'file-manager',
  'floating-preview',
  'grok-ui',
  'hermes-bots',
  'langchain-rag',
  'master-harness',
  'pixel-office',
  'subscription-hub',
]

function readDecisions() {
  try {
    const raw = window.localStorage.getItem(DECISIONS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeDecision(id, on) {
  const next = { ...readDecisions(), [id]: on }
  try {
    window.localStorage.setItem(DECISIONS_KEY, JSON.stringify(next))
  } catch {
    // storage blocked — nonfatal
  }
  return next
}

async function fetchBackendPlugins() {
  const res = await host.request('plugins.manage', { action: 'list' })
  return res && Array.isArray(res.plugins) ? res.plugins : []
}

/** One backend-plugin row with a live toggle. */
function BackendRow({ p, busy, onToggle }) {
  return jsxs(
    'div',
    {
      className: cn('flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--ui-hover)]'),
      children: [
        jsx(
          'div',
          {
            className: 'min-w-0 flex-1',
            children: jsxs('div', {
              className: 'flex items-center gap-2',
              children: [
                jsx('span', {
                  className: 'truncate text-sm font-medium text-[var(--ui-text)]',
                  children: p.name,
                }),
                p.version && p.version !== '?'
                  ? jsx(Badge, { children: String(p.version) })
                  : null,
                p.source && p.source !== 'user'
                  ? jsx(Badge, { variant: 'outline', children: String(p.source) })
                  : null,
              ],
            }),
          }
        ),
        jsx(Switch, {
          checked: p.status === 'enabled',
          disabled: busy,
          onCheckedChange: (v) => onToggle(p, v),
        }),
      ],
    }
  )
}

/** One desktop-UI-plugin row (instant hot-reload toggle). */
function UiRow({ id, on, onToggle }) {
  return jsxs(
    'div',
    {
      className: cn('flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--ui-hover)]'),
      children: [
        jsx('div', {
          className: 'min-w-0 flex-1 truncate text-sm font-medium text-[var(--ui-text)]',
          children: id,
        }),
        jsx(Badge, { variant: 'outline', children: 'ui' }),
        jsx(Switch, { checked: on, onCheckedChange: (v) => onToggle(id, v) }),
      ],
    }
  )
}

function InstallBox({ onInstalled }) {
  const [repo, setRepo] = useState('')
  const [busy, setBusy] = useState(false)

  const install = async () => {
    const r = repo.trim()
    if (!r || busy) return
    setBusy(true)
    try {
      await host.request('plugins.manage', { action: 'install', repo: r, enable: true })
      host.notify({ kind: 'success', message: `Install requested: ${r}` })
      setRepo('')
      onInstalled()
    } catch (e) {
      host.notifyError(`Install failed: ${e && e.message ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return jsxs('div', {
    className: 'flex items-center gap-2 px-1 py-2',
    children: [
      jsx(Input, {
        value: repo,
        placeholder: 'owner/repo — install a plugin from GitHub',
        onChange: (e) => setRepo(e.target.value),
        className: 'flex-1',
      }),
      jsx(Button, {
        size: 'sm',
        disabled: busy || !repo.trim(),
        onClick: install,
        children: busy ? 'Installing…' : 'Install',
      }),
    ],
  })
}

function Hub() {
  const [backend, setBackend] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [toggling, setToggling] = useState(false)
  const [filter, setFilter] = useState('')
  const [uiState, setUiState] = useState(readDecisions)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setBackend(await fetchBackendPlugins())
    } catch (e) {
      setError(e && e.message ? e.message : String(e))
      setBackend([])
    }
  }, [])

  useEffect(() => {
    console.info('[plugin-dock] hub mounted')
    void refresh()
  }, [refresh])

  const toggleBackend = async (p, enable) => {
    setToggling(true)
    try {
      await host.request('plugins.manage', { action: 'toggle', key: p.key || p.name, enable })
      host.notify({ kind: 'success', message: `${p.name} ${enable ? 'enabled' : 'disabled'}` })
      await refresh()
    } catch (e) {
      host.notifyError(`Toggle failed: ${e && e.message ? e.message : String(e)}`)
    } finally {
      setToggling(false)
    }
  }

  const toggleUi = (id, on) => {
    setUiState(writeDecision(id, on))
    host.notify({ kind: 'success', message: `${id} ${on ? 'enabled' : 'disabled'} — applies instantly` })
  }

  const f = filter.trim().toLowerCase()
  const rows = (backend || []).filter((p) => !f || p.name.toLowerCase().includes(f))
  const uiIds = Array.from(new Set([...KNOWN_UI_PLUGINS, ...Object.keys(uiState)])).filter(
    (id) => !f || id.toLowerCase().includes(f)
  )

  return jsxs('div', {
    className: 'mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto p-6',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsx('h1', { className: 'text-lg font-semibold text-[var(--ui-text)]', children: 'Plugin Dock' }),
          jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => void refresh(), children: 'Refresh' }),
        ],
      }),
      jsx(SearchField, { value: filter, onChange: setFilter, placeholder: 'Filter plugins…' }),

      jsxs('section', {
        className: 'flex flex-col gap-1',
        children: [
          jsxs('h2', {
            className: 'px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--ui-text-secondary)]',
            children: ['Agent & backend plugins', ' ', backend ? jsx(Badge, { children: String(backend.length) }) : null],
          }),
          backend === null && jsx(EmptyState, { title: 'Loading…' }),
          error && jsx(EmptyState, { title: 'Could not reach the gateway', description: error }),
          backend !== null && !error && rows.length === 0 && jsx(EmptyState, { title: 'No matches' }),
          rows.map((p) =>
            jsx(BackendRow, { key: p.key || p.name, p, busy: toggling, onToggle: toggleBackend })
          ),
          jsx(InstallBox, { onInstalled: () => void refresh() }),
        ],
      }),

      jsx(Separator, {}),

      jsxs('section', {
        className: 'flex flex-col gap-1',
        children: [
          jsxs('h2', {
            className: 'px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--ui-text-secondary)]',
            children: ['Desktop UI plugins', ' ', jsx(Badge, { variant: 'outline', children: 'hot-reload' })],
          }),
          uiIds.map((id) => jsx(UiRow, { key: id, id, on: uiState[id] !== false, onToggle: toggleUi })),
          jsx('p', {
            className: 'px-1 pt-1 text-xs text-[var(--ui-text-tertiary)]',
            children:
              'Drop a folder with plugin.js into ~/.hermes/desktop-plugins/ — it appears here after ⌘K → Reload desktop plugins. UI toggles apply instantly.',
          }),
        ],
      }),
    ],
  })
}

export default {
  id: 'plugin-dock',
  name: 'Plugin Dock',
  description: 'One hub + composer/statusbar shortcuts to manage every plugin (backend & UI).',
  register(ctx) {
    console.info('[plugin-dock] registering')

    // Full hub page
    ctx.register({
      id: 'hub',
      area: ROUTES_AREA,
      data: { path: '/plugin-dock' },
      title: 'Plugin Dock',
      render: () => jsx(Hub),
    })

    // Sidebar entry
    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      data: { path: '/plugin-dock', label: 'Plugin Dock', codicon: 'extensions' },
    })

    // Statusbar chip — visible heartbeat + quick access
    ctx.register({
      id: 'statusbar',
      area: STATUSBAR_AREAS.right,
      order: 80,
      render: () =>
        jsx(
          'button',
          {
            title: 'Plugin Dock',
            onClick: () => host.navigate('/plugin-dock'),
            className: cn(
              'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--ui-text-secondary)]',
              'transition-colors hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)]'
            ),
          },
          '🧩'
        ),
    })

    // 🧩 button living right in the chat composer
    ctx.register({
      id: 'composer-shortcut',
      area: COMPOSER_AREAS.actions,
      order: 90,
      render: () =>
        jsx(Button, {
          variant: 'ghost',
          size: 'sm',
          title: 'Plugin Dock',
          onClick: () => host.navigate('/plugin-dock'),
          children: '🧩',
        }),
    })

    console.info('[plugin-dock] registered OK')
  },
}
