/**
 * Floating Preview Panel — a tear-out preview that floats above the workspace.
 *
 * A fixed, draggable card you can point at ANYTHING — a URL, a file path, or
 * an artifact — that shows a compact tile and expands to full details. It
 * reuses the existing preview infra; it does NOT build a new preview engine:
 *
 *  - The float itself is core's `placement: 'floating'` pane role
 *    (FloatingPanes + floating-rect): the shell owns drag-by-header, viewport
 *    clamping, edge tracking, and position/collapse persistence — the plugin
 *    only supplies content.
 *  - Live pages render in a real `<webview>` on the SAME partition core's
 *    preview pane uses (`persist:hermes-preview`), so cookies, session state,
 *    and devtools follow the preview everywhere, including here.
 *  - Agent-driven opens (the `open_preview` desktop_ui tool) arrive as
 *    `preview.open` gateway events and land in the panel automatically
 *    (toggleable via the Follow control). The backend already scoped the
 *    event to this window, so the panel mirrors it without re-gating.
 *  - Dev-server restarts go through the one real gateway RPC,
 *    `preview.restart`, with progress/complete events rendered inline.
 *
 * There is intentionally NO `host.request('preview.open')` — `preview.open`
 * is an event emitted by the backend tool bridge (tools/desktop_ui.py), not a
 * JSON-RPC method. Opening the core rail preview from a plugin is not exposed
 * as an RPC; the floating panel is the plugin-shaped way to show something.
 *
 * Programmatic door for other surfaces / devtools:
 *   window.__floatingPreview.pointAt('https://cnn.com' | '/tmp/a.html' | { kind, label, url })
 */

import {
  atom,
  cn,
  Codicon,
  EmptyState,
  GlyphSpinner,
  host,
  Input,
  useValue
} from '@hermes/plugin-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'floating-preview'
const FLOAT_ANCHOR = 'top-right'
const FLOAT_WIDTH = '360px'
const FLOAT_HEIGHT = '440px'

/** The webview partition core's preview pane uses — REUSED, never invented,
 *  so a floated page shares cookies/session/devtools with the rail. */
const PREVIEW_PARTITION = 'persist:hermes-preview'
const WEBVIEW_PREFERENCES = 'contextIsolation=yes,nodeIntegration=no,sandbox=yes'

// ── pure target model (exported for tests) ─────────────────────────────────

const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.ico'])
const PDF_EXTENSIONS = new Set(['.pdf'])

function extensionOf(value) {
  const tail = String(value || '').split(/[\\/]/).filter(Boolean).at(-1) || ''
  const dot = tail.lastIndexOf('.')
  return dot > 0 ? tail.slice(dot).toLowerCase() : ''
}

function basenameOf(value) {
  const cleaned = String(value || '').replace(/\/+$/, '')
  const tail = cleaned.split(/[\\/]/).filter(Boolean).at(-1)
  return tail || cleaned || value || ''
}

function joinPath(cwd, relative) {
  const base = String(cwd || '').replace(/\/+$/, '')
  const rel = String(relative || '').replace(/^\/+/, '')
  return base ? `${base}/${rel}` : rel
}

function pathToFileUrl(path) {
  return `file://${String(path).split('/').map(encodeURIComponent).join('/')}`
}

function previewKindOf(path) {
  const ext = extensionOf(path)
  if (HTML_EXTENSIONS.has(ext)) return 'html'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  return 'text'
}

/** Compact one-line rendering of a target, matching the rail's `compactUrl`. */
function compactUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol === 'file:') {
      return decodeURIComponent(url.pathname)
    }
    return `${url.host}${url.pathname}${url.search}`
  } catch {
    return value
  }
}

function byteSizeHint(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

function kindLabel(kind) {
  if (kind === 'url') return 'URL'
  if (kind === 'file') return 'FILE'
  if (kind === 'artifact') return 'ARTIFACT'
  return 'PREVIEW'
}

/** URL and HTML-file targets render live in a webview; everything else gets
 *  a metadata card (artifacts have nothing on disk, other files no live
 *  renderer in this panel). */
function isLiveTarget(target) {
  if (!target) return false
  return target.kind === 'url' || (target.kind === 'file' && target.previewKind === 'html')
}

/** The webview contract — pure so the partition-reuse invariant is testable. */
function webviewProps(target) {
  return {
    partition: PREVIEW_PARTITION,
    src: target.url,
    webpreferences: WEBVIEW_PREFERENCES
  }
}

function targetTitle(target) {
  if (!target) return 'Preview'
  if (target.kind === 'artifact') return target.label || 'Artifact'
  return target.label || compactUrl(target.url) || basenameOf(target.path) || 'Preview'
}

function targetSubtitle(target) {
  if (!target) return ''
  if (target.kind === 'url') return compactUrl(target.url)
  if (target.kind === 'file') return target.path || target.url
  return target.url || target.label
}

function formatHint(target) {
  if (!target) return ''
  if (target.kind === 'url') return 'LIVE'
  if (target.kind === 'artifact') return 'ARTIFACT'
  const parts = [(target.previewKind || 'text').toUpperCase()]
  const size = byteSizeHint(target.byteSize)
  if (size) parts.push(size)
  return parts.join(' · ')
}

const KIND_ICON = { url: 'globe', file: 'file-code', artifact: 'sparkle' }

/**
 * Point-at-anything ladder (plugin-local; mirrors the renderer's
 * localPreviewTarget with the backend tool's localhost/domain rungs added):
 *   1. `https?://` → url kind
 *   2. `file://` → file kind (path decoded)
 *   3. localhost / 127.0.0.1 [:port] → http url
 *   4. absolute / ./ / ../ path → file kind
 *   5. cwd + (contains '/' or a known file extension) → file kind (cwd-joined)
 *   6. bare domain (tld, optional port/path) → https url
 *   7. cwd present → file kind (cwd-joined)
 *   8. otherwise → url kind as-is
 */
function normalizeTarget(raw, cwd) {
  const value = String(raw ?? '').trim().replace(/^`|`$/g, '')
  if (!value) return null

  if (/^https?:\/\//i.test(value)) {
    return { kind: 'url', label: basenameOf(value), source: value, url: value }
  }

  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(value)) {
    const url = `http://${value}`
    return { kind: 'url', label: basenameOf(url), source: value, url }
  }

  if (/^file:\/\//i.test(value)) {
    let path = value
    try {
      path = decodeURIComponent(new URL(value).pathname)
    } catch {
      path = value.replace(/^file:\/\//i, '')
    }
    return fileTarget(path, value)
  }

  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) {
    return fileTarget(value, value)
  }

  const looksLikePath = value.includes('/') || extensionOf(value) !== ''

  if (cwd && looksLikePath) {
    return fileTarget(joinPath(cwd, value), value)
  }

  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(value)) {
    const url = `https://${value}`
    return { kind: 'url', label: basenameOf(url), source: value, url }
  }

  if (cwd) {
    return fileTarget(joinPath(cwd, value), value)
  }

  return { kind: 'url', label: basenameOf(value), source: value, url: value }
}

function fileTarget(path, source) {
  return {
    kind: 'file',
    label: basenameOf(path),
    path,
    previewKind: previewKindOf(path),
    source,
    url: pathToFileUrl(path)
  }
}

/** Accept an already-normalized target object (from other surfaces): validates
 *  the shape and fills defaults. Artifacts carry nothing on disk — `url` is an
 *  id into the artifact registry. */
function coerceTarget(input) {
  if (!input || typeof input !== 'object') return null
  const kind = input.kind
  if (kind !== 'artifact' && kind !== 'file' && kind !== 'url') return null
  if (typeof input.url !== 'string' || !input.url) return null
  return {
    kind,
    label: typeof input.label === 'string' && input.label ? input.label : kind === 'url' ? compactUrl(input.url) : input.url,
    source: typeof input.source === 'string' && input.source ? input.source : input.url,
    path: typeof input.path === 'string' ? input.path : undefined,
    previewKind: typeof input.previewKind === 'string' ? input.previewKind : kind === 'file' ? previewKindOf(input.path || input.url) : undefined,
    byteSize: typeof input.byteSize === 'number' ? input.byteSize : undefined,
    url: input.url
  }
}

// ── plugin state ───────────────────────────────────────────────────────────

const $target = atom(null)
const $expanded = atom(false)
const $follow = atom(true)
const $loading = atom(false)
const $loadError = atom(null)
const $currentUrl = atom('')
const $restart = atom(null)
const $reloadRequest = atom(0)

/** The live webview, module-level so toolbar actions and restart events can
 *  drive it without threading refs through components. */
let liveWebview = null
let pluginCtx = null

function currentCwd() {
  try {
    return host.state.cwd?.get?.() ?? ''
  } catch {
    return ''
  }
}

function persistTarget(target) {
  try {
    // Only the SOURCE string is persisted — never bytes/dataUrls (localStorage
    // bloat) and never artifact ids (their registry is memory-only).
    pluginCtx?.storage.set('last-target', target ? target.source : null)
  } catch {
    // Storage can be unavailable in locked-down contexts; nothing depends on it.
  }
}

function applyTarget(target) {
  $target.set(target)
  $expanded.set(false)
  $loading.set(false)
  $loadError.set(null)
  $currentUrl.set(target ? target.url : '')
  $restart.set(null)
  persistTarget(target)
}

/** Point the panel at anything: a raw string (URL / path / localhost) or an
 *  already-normalized target object. Returns whether a target resolved. */
function pointAt(input, cwd) {
  const target = typeof input === 'string' ? normalizeTarget(input, cwd ?? currentCwd()) : coerceTarget(input)
  if (!target) return false
  applyTarget(target)
  return true
}

/** `preview.open` gateway event (the `open_preview` desktop_ui tool). The
 *  backend already scoped it to this window; the panel mirrors it unless the
 *  user turned Follow off. Returns the resolved target (or null). */
function handlePreviewOpen(payload) {
  if (!$follow.get()) return null
  const p = payload && typeof payload === 'object' ? payload : {}
  const url = typeof p.url === 'string' ? p.url.trim() : ''
  if (!url) return null

  const target = normalizeTarget(url, currentCwd())
  if (!target) return null

  const label = typeof p.label === 'string' ? p.label.trim() : ''
  if (label && target.kind === 'url') target.label = label

  const current = $target.get()
  if (current && current.kind === target.kind && current.url === target.url) {
    return target // already showing it — no churn
  }

  applyTarget(target)
  return target
}

function onRestartProgress(payload) {
  const restart = $restart.get()
  const p = payload && typeof payload === 'object' ? payload : {}
  if (!restart || restart.status !== 'running') return
  if (restart.taskId && p.task_id !== restart.taskId) return
  if (typeof p.text === 'string' && p.text) $restart.set({ ...restart, message: p.text })
}

function onRestartComplete(payload) {
  const restart = $restart.get()
  const p = payload && typeof payload === 'object' ? payload : {}
  if (!restart || !restart.taskId) return
  if (p.task_id !== restart.taskId) return
  $restart.set({ status: 'complete', taskId: restart.taskId, message: typeof p.text === 'string' ? p.text : '' })
  $reloadRequest.set($reloadRequest.get() + 1)
}

function reloadPreview() {
  $loadError.set(null)
  if (liveWebview?.reloadIgnoringCache) {
    liveWebview.reloadIgnoringCache()
  } else {
    liveWebview?.reload?.()
  }
}

async function restartPreviewServer(target) {
  const url = $currentUrl.get() || target.url
  const sessionId = host.state.activeSessionId?.get?.() ?? null

  if (!sessionId) {
    host.notify({
      kind: 'error',
      title: 'Preview restart unavailable',
      message: 'There is no active session to run the restart against.',
      durationMs: 4000
    })
    return
  }

  try {
    $restart.set({ status: 'running', taskId: '', message: 'Restarting…' })
    const result = await host.request('preview.restart', {
      url,
      cwd: currentCwd() || undefined,
      session_id: sessionId
    })
    const taskId = result?.task_id
    if (!taskId) throw new Error('preview.restart returned no task id')
    $restart.set({ status: 'running', taskId, message: 'Restarting…' })
    host.notify({ kind: 'info', title: 'Restarting preview server', message: url, durationMs: 3000 })
  } catch (error) {
    $restart.set({ status: 'error', taskId: '', message: error instanceof Error ? error.message : String(error) })
  }
}

// ── components ─────────────────────────────────────────────────────────────

function CompactTile({ target, onExpand }) {
  return jsx('div', {
    role: 'button',
    tabIndex: 0,
    className:
      'flex cursor-pointer items-center gap-2 rounded-md border border-(--ui-stroke-secondary, #202023) bg-(--ui-surface, #141416) px-2 py-1.5 transition-colors hover:border-(--ui-stroke-hover, #2e2e33)',
    onClick: onExpand,
    onKeyDown: event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onExpand()
      }
    },
    children: [
      jsx(Codicon, { name: KIND_ICON[target.kind] || 'link', size: '0.875rem', className: 'shrink-0 opacity-70' }),
      jsx('div', { className: 'min-w-0 flex-1', children: [
        jsx('div', { className: 'truncate font-medium text-(--ui-text-primary, #f2f2f4)', children: targetTitle(target) }),
        jsx('div', { className: 'truncate opacity-70', children: targetSubtitle(target) })
      ]}),
      jsx('span', {
        className: 'shrink-0 rounded-full bg-(--ui-surface2, #1a1a1d) px-1.5 py-px text-[0.625rem] font-semibold opacity-80',
        children: formatHint(target)
      })
    ]
  })
}

function LiveDetails({ target }) {
  const hostRef = useRef(null)
  const loading = useValue($loading)
  const loadError = useValue($loadError)
  const restart = useValue($restart)
  const currentUrl = useValue($currentUrl)
  const lastReloadRef = useRef(0)
  const reloadRequest = useValue($reloadRequest)

  useEffect(() => {
    const hostEl = hostRef.current
    if (!hostEl) return

    hostEl.replaceChildren()
    liveWebview = null
    $loading.set(true)
    $loadError.set(null)

    const webview = document.createElement('webview')
    webview.className = 'h-full w-full bg-transparent'
    for (const [key, value] of Object.entries(webviewProps(target))) {
      webview.setAttribute(key, value)
    }

    webview.addEventListener('did-start-loading', () => $loading.set(true))
    webview.addEventListener('did-stop-loading', () => $loading.set(false))
    webview.addEventListener('did-navigate', event => {
      if (event.url) {
        $currentUrl.set(event.url)
        $loadError.set(null)
      }
    })
    webview.addEventListener('did-navigate-in-page', event => {
      if (event.url) $currentUrl.set(event.url)
    })
    webview.addEventListener('did-fail-load', event => {
      $loading.set(false)
      if (event.errorCode === -3) return // ERR_ABORTED — navigation was replaced
      $loadError.set({
        code: event.errorCode,
        description: event.errorDescription || event.validatedURL || 'Failed to load'
      })
    })

    hostEl.appendChild(webview)
    liveWebview = webview

    return () => {
      webview.remove()
      liveWebview = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-key on target only
  }, [target.kind, target.url])

  useEffect(() => {
    if (reloadRequest !== lastReloadRef.current) {
      lastReloadRef.current = reloadRequest
      reloadPreview()
    }
  }, [reloadRequest])

  const openInBrowser = useCallback(() => {
    void pluginCtx?.os.openExternal(currentUrl || target.url)
  }, [currentUrl, target.url])

  return jsxs('div', {
    className: 'flex min-h-0 flex-1 flex-col gap-1.5',
    children: [
      jsxs('div', {
        className: 'flex items-center gap-1',
        children: [
          loading && jsx(GlyphSpinner, { className: 'size-3' }),
          jsx('span', { className: 'min-w-0 flex-1 truncate font-mono text-[0.6875rem] opacity-80', children: compactUrl(currentUrl || target.url) }),
          jsx('button', {
            type: 'button',
            title: 'Reload',
            className: 'rounded p-1 text-(--ui-text-quaternary, #6e6e75) transition-colors hover:text-(--ui-text-primary, #f2f2f4)',
            onClick: reloadPreview,
            children: jsx(Codicon, { name: 'refresh', size: '0.8125rem' })
          }),
          jsx('button', {
            type: 'button',
            title: 'Open in browser',
            className: 'rounded p-1 text-(--ui-text-quaternary, #6e6e75) transition-colors hover:text-(--ui-text-primary, #f2f2f4)',
            onClick: openInBrowser,
            children: jsx(Codicon, { name: 'external-link', size: '0.8125rem' })
          })
        ]
      }),
      jsx('div', {
        className: 'relative min-h-0 flex-1 overflow-hidden rounded-md border border-(--ui-stroke-secondary, #202023)',
        children: jsx('div', { ref: hostRef, className: 'absolute inset-0' })
      }),
      loadError &&
        jsxs('div', {
          className: 'flex items-start gap-1.5 rounded-md border border-(--ui-danger, #e5534b)/30 bg-(--ui-danger, #e5534b)/10 px-2 py-1.5',
          children: [
            jsx(Codicon, { name: 'warning', size: '0.8125rem', className: 'mt-0.5 shrink-0 opacity-80' }),
            jsx('div', { className: 'min-w-0 flex-1', children: [
              jsx('div', { className: 'truncate opacity-80', children: loadError.description }),
              loadError.code && jsx('div', { className: 'font-mono text-[0.625rem] opacity-60', children: String(loadError.code) })
            ]}),
            jsx('button', {
              type: 'button',
              className: 'rounded px-1.5 py-0.5 text-[0.6875rem] transition-colors hover:bg-(--ui-surface2, #1a1a1d)',
              onClick: reloadPreview,
              children: 'Retry'
            }),
            jsx('button', {
              type: 'button',
              className: 'rounded px-1.5 py-0.5 text-[0.6875rem] transition-colors hover:bg-(--ui-surface2, #1a1a1d)',
              onClick: () => void restartPreviewServer(target),
              children: 'Ask Hermes to restart'
            })
          ]
        }),
      restart &&
        jsx('div', {
          className: 'flex items-center gap-1.5 rounded-md border border-(--ui-stroke-secondary, #202023) px-2 py-1 text-[0.6875rem]',
          children: [
            jsx(Codicon, {
              name: restart.status === 'error' ? 'warning' : restart.status === 'complete' ? 'check' : 'sync',
              size: '0.75rem',
              className: restart.status === 'error' ? 'opacity-80' : 'opacity-60',
              spinning: restart.status === 'running'
            }),
            jsx('span', { className: 'min-w-0 flex-1 truncate opacity-80', children: restart.message || 'Restarting…' })
          ]
        })
    ]
  })
}

function FileDetails({ target }) {
  const actions = [
    { label: 'Reveal in file manager', icon: 'folder-opened', run: () => pluginCtx?.os.revealPath(target.path || target.url) },
    { label: 'Open in browser', icon: 'external-link', run: () => pluginCtx?.os.openExternal(target.url) },
    { label: 'Copy path', icon: 'copy', run: () => pluginCtx?.os.writeClipboard(target.path || target.url) }
  ]

  return jsxs('div', {
    className: 'flex flex-col gap-1.5',
    children: [
      jsxs('div', {
        className: 'rounded-md border border-(--ui-stroke-secondary, #202023) bg-(--ui-surface, #141416) p-2.5',
        children: [
          jsx('div', { className: 'truncate font-medium text-(--ui-text-primary, #f2f2f4)', children: targetTitle(target) }),
          jsx('div', { className: 'mt-1 break-all font-mono text-[0.6875rem] opacity-70', children: target.path || target.url }),
          jsx('span', {
            className: 'mt-1.5 inline-block rounded-full bg-(--ui-surface2, #1a1a1d) px-1.5 py-px text-[0.625rem] font-semibold opacity-80',
            children: formatHint(target)
          })
        ]
      }),
      jsxs('div', {
        className: 'flex flex-wrap gap-1',
        children: actions.map(action =>
          jsx('button', {
            type: 'button',
            className:
              'flex items-center gap-1 rounded border border-(--ui-stroke-secondary, #202023) px-1.5 py-1 text-[0.6875rem] transition-colors hover:bg-(--ui-surface2, #1a1a1d)',
            onClick: () => void action.run(),
            children: [
              jsx(Codicon, { name: action.icon, size: '0.75rem', className: 'opacity-70' }),
              jsx('span', { children: action.label })
            ]
          })
        )
      })
    ]
  })
}

function ArtifactDetails({ target }) {
  return jsx('div', {
    className: 'rounded-md border border-(--ui-stroke-secondary, #202023) bg-(--ui-surface, #141416) p-2.5',
    children: [
      jsx('div', { className: 'truncate font-medium text-(--ui-text-primary, #f2f2f4)', children: targetTitle(target) }),
      jsx('div', { className: 'mt-1 break-all font-mono text-[0.6875rem] opacity-70', children: target.url }),
      jsx('div', {
        className: 'mt-1.5 text-[0.6875rem] opacity-70',
        children: 'Artifact content lives in the artifact registry — open it in the preview rail for the full render.'
      })
    ]
  })
}

function DetailsBody({ target }) {
  if (isLiveTarget(target)) return jsx(LiveDetails, { target })
  if (target.kind === 'file') return jsx(FileDetails, { target })
  return jsx(ArtifactDetails, { target })
}

function FloatingPreviewPanel() {
  const target = useValue($target)
  const expanded = useValue($expanded)
  const follow = useValue($follow)
  const [draft, setDraft] = useState('')

  const open = useCallback(() => {
    const value = (draft || '').trim()
    if (!value) return
    if (pointAt(value)) setDraft('')
  }, [draft])

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col gap-1.5 p-2 text-xs text-(--ui-text-secondary, #dfdfe2)',
    children: [
      jsxs('div', {
        className: 'flex items-center gap-1',
        children: [
          jsx(Input, {
            className: 'h-6 min-w-0 flex-1 text-xs',
            placeholder: 'URL, file path, or localhost:3000',
            value: draft,
            onChange: event => setDraft(event.target.value),
            onKeyDown: event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                open()
              }
            }
          }),
          jsx('button', {
            type: 'button',
            title: 'Open in floating preview',
            className:
              'flex h-6 w-6 shrink-0 items-center justify-center rounded border border-(--ui-stroke-secondary, #202023) text-(--ui-text-secondary, #dfdfe2) transition-colors hover:bg-(--ui-surface2, #1a1a1d)',
            onClick: open,
            children: jsx(Codicon, { name: 'arrow-right', size: '0.8125rem' })
          })
        ]
      }),
      jsxs('div', {
        className: 'flex items-center gap-1.5',
        children: [
          jsx('button', {
            type: 'button',
            title: follow ? 'Following agent previews — click to stop' : 'Not following — click to follow preview.open',
            className: cn(
              'flex items-center gap-1 rounded px-1 py-0.5 text-[0.6875rem] transition-colors',
              follow ? 'text-(--ui-accent, #4f9cf9)' : 'opacity-60 hover:opacity-100'
            ),
            onClick: () => $follow.set(!follow),
            children: [
              jsx(Codicon, { name: follow ? 'eye' : 'eye-closed', size: '0.75rem' }),
              jsx('span', { children: 'Follow' })
            ]
          }),
          target &&
            jsx('span', {
              className: 'rounded-full bg-(--ui-surface2, #1a1a1d) px-1.5 py-px text-[0.625rem] font-semibold opacity-80',
              children: kindLabel(target.kind)
            }),
          jsx('span', { className: 'min-w-0 flex-1' }),
          target &&
            jsx('button', {
              type: 'button',
              title: expanded ? 'Collapse to compact tile' : 'Expand to full details',
              className: 'rounded p-1 text-(--ui-text-quaternary, #6e6e75) transition-colors hover:text-(--ui-text-primary, #f2f2f4)',
              onClick: () => $expanded.set(!expanded),
              children: jsx(Codicon, { name: expanded ? 'chevron-up' : 'chevron-down', size: '0.8125rem' })
            }),
          target &&
            jsx('button', {
              type: 'button',
              title: 'Close preview',
              className: 'rounded p-1 text-(--ui-text-quaternary, #6e6e75) transition-colors hover:text-(--ui-text-primary, #f2f2f4)',
              onClick: () => applyTarget(null),
              children: jsx(Codicon, { name: 'close', size: '0.8125rem' })
            })
        ]
      }),
      target
        ? expanded
          ? jsx(DetailsBody, { target })
          : jsx(CompactTile, { target, onExpand: () => $expanded.set(true) })
        : jsx(EmptyState, {
            title: 'Nothing previewed yet',
            description: 'Type a URL or file path above, or ask an agent to open something — it lands here.',
            className: 'min-h-24'
          })
    ]
  })
}

/** Snapshot for tests. */
function getState() {
  return {
    target: $target.get(),
    expanded: $expanded.get(),
    follow: $follow.get(),
    loading: $loading.get(),
    loadError: $loadError.get(),
    currentUrl: $currentUrl.get(),
    restart: $restart.get()
  }
}

export default {
  id: ID,
  name: 'Floating Preview Panel',
  description: 'A draggable preview panel you can point at any URL, file, or artifact — compact tile, expand to full details.',
  defaultEnabled: true,
  register(ctx) {
    pluginCtx = ctx

    const disposers = [
      host.onEvent('preview.open', event => {
        try {
          handlePreviewOpen(event?.payload)
        } catch {
          // Isolated — a bad payload must never break app dispatch.
        }
      }),
      host.onEvent('preview.restart.progress', event => {
        try {
          onRestartProgress(event?.payload)
        } catch {
          // noop
        }
      }),
      host.onEvent('preview.restart.complete', event => {
        try {
          onRestartComplete(event?.payload)
        } catch {
          // noop
        }
      })
    ]

    ctx.onDispose(() => {
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch {
          // noop
        }
      }
    })

    ctx.register({
      id: 'panel',
      area: 'panes',
      title: 'Preview',
      data: {
        placement: 'floating',
        anchor: FLOAT_ANCHOR,
        width: FLOAT_WIDTH,
        height: FLOAT_HEIGHT
      },
      render: () => jsx(FloatingPreviewPanel, {})
    })

    // Restore the last pointed-at target (source string only — never bytes).
    try {
      const last = ctx.storage.get('last-target', null)
      if (typeof last === 'string' && last) pointAt(last)
    } catch {
      // noop
    }

    // Programmatic door for other surfaces / devtools (template-compatible).
    if (typeof window !== 'undefined') {
      window.__floatingPreview = { pointAt: (...args) => pointAt(...args), panel: true }
    }
  }
}
