/**
 * Artifact Lab — the live preview bench for what the agents produce.
 *
 * Six agents build things all day and leave them on disk: HTML toys, SVG/PNG posters, Markdown
 * reports. This pane answers the two questions you actually have about them — "what did we just
 * produce?" and "what does it look like?" — without leaving the app:
 *
 *   list      newest-first rows from the watched roots (name, kind, size, age, root tag)
 *   preview   click a row: HTML/SVG in a sandboxed iframe, images in an <img>, Markdown in a <pre>
 *   compare   when two rows in the same directory share a stem (poster-v1 / poster-v2,
 *             draft-report / final-report), a compare toggle appears and renders both side by side
 *
 * Everything is served by the plugin's own backend (/api/plugins/artifact-lab), which allowlists
 * the artifact roots in code, realpath-checks every request, and refuses anything outside them.
 * The pane never opens an OS window and never hands guest content a top-navigation-capable frame:
 * HTML/SVG is fetched as text and injected as `srcdoc` into `<iframe sandbox="allow-scripts">`,
 * so a malicious artifact cannot touch the app or navigate it.
 *
 * Honest states, never fake ones: a 404 from the backend namespace means the plugin is not mounted
 * yet (said in those words), an empty list names the roots that were scanned and how many files
 * were seen, and a scan that hits its work cap says the list is partial.
 *
 * Surfaces:
 *   - Right-rail pane  ('panes'     → 'bench', placement right, 360px)
 *   - Command palette  (PALETTE_AREA → refresh the bench)
 */

import {
  host,
  PANES_AREA,
  PALETTE_AREA,
  Button,
  Separator,
  cn,
  haptic,
  useQuery,
  useValue,
  atom,
  queryClient,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useMemo, useState } from 'react'

const ID = 'artifact-lab'
const PANE = 'bench'
const PANE_ID = `${ID}:${PANE}`
const HOURS = 48
const LIMIT = 60
const REFRESH_MS = 20000 // slow data: artifacts appear at human speed

// ctx.rest is captured at register-time (same pattern as the reference plugins).
let ctxRest = async () => {
  throw new Error('artifact-lab: not registered yet')
}

/* ------------------------------------------------------------------ pure helpers (tested) */

const EXT_KIND = {
  html: 'html',
  svg: 'svg',
  md: 'md',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
}

const KIND_LABEL = { html: 'html', svg: 'svg', md: 'md', image: 'img' }

/** Extension -> kind, or null when the file is not a previewable artifact. */
function kindFor(name) {
  const m = /\.([A-Za-z0-9]+)\s*$/.exec(String(name || ''))
  if (!m) return null
  return EXT_KIND[m[1].toLowerCase()] || null
}

/** 'poster-v2.png' -> 'poster-v2' */
function stemOf(name) {
  const s = String(name || '')
  const i = s.lastIndexOf('.')
  return i > 0 ? s.slice(0, i) : s
}

/** '/a/b/c.html' -> '/a/b' */
function dirOf(path) {
  return String(path || '').replace(/\/[^/]*$/, '')
}

const VARIANT_WORDS = new Set(['draft', 'final', 'old', 'new', 'before', 'after', 'copy', 'wip', 'alt', 'rev', 'version'])

/**
 * Strip version-ish tokens from a stem: 'poster-v2' -> 'poster', 'report-final' -> 'report'.
 * Returns null when the stem carries no variant token (so ordinary names never group by accident).
 * Pure-digit tokens count only when short (1-2 digits): long digit runs are timestamps/ids, and
 * treating them as variants would pair unrelated renders that merely share a date.
 */
function variantBase(stem) {
  const tokens = String(stem || '')
    .toLowerCase()
    .split(/[-_\s.]+/)
    .filter(Boolean)
  if (!tokens.length) return null
  const kept = []
  let stripped = 0
  for (const tok of tokens) {
    if (VARIANT_WORDS.has(tok) || /^v\d+$/.test(tok) || /^rev\d+$/.test(tok) || /^r\d+$/.test(tok) || /^\d{1,2}$/.test(tok)) {
      stripped += 1
      continue
    }
    kept.push(tok)
  }
  if (!stripped || !kept.length) return null
  return kept.join('-')
}

/** Newest first, ties broken by path so the order is stable between refreshes. */
function sortNewestFirst(items) {
  return [...(items || [])].sort((a, b) => (Number(b && b.mtime) || 0) - (Number(a && a.mtime) || 0) || String(a.path).localeCompare(String(b.path)))
}

/**
 * Comparison candidates: rows in the SAME directory whose stems collapse to the same base
 * ('poster-v1'/'poster-v2', 'draft-report'/'final-report', 'poster.png'/'poster-v1.png').
 * Nothing is invented — a group with fewer than two distinct files yields no pair, and every pair
 * carries the two real rows it was built from.
 */
function detectPairs(items, maxPairs = 8) {
  const groups = new Map()
  for (const row of items || []) {
    if (!row || !row.path) continue
    const stem = stemOf(row.name || '')
    const key = variantBase(stem) || String(stem).toLowerCase()
    if (!key) continue
    const groupKey = `${dirOf(row.path)}::${key}`
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push(row)
  }
  const pairs = []
  for (const [key, members] of groups) {
    if (members.length < 2) continue
    const sorted = sortNewestFirst(members)
    const a = sorted[0]
    const b = sorted.find((m) => m.path !== a.path)
    if (!a || !b) continue
    pairs.push({ key, a, b, label: `${a.name} ↔ ${b.name}`, mtime: Math.max(Number(a.mtime) || 0, Number(b.mtime) || 0) })
  }
  pairs.sort((x, y) => y.mtime - x.mtime)
  return pairs.slice(0, maxPairs)
}

/** How a kind is shown: sandboxed frame, <img>, or plain text. */
function previewModeFor(kind) {
  if (kind === 'image') return 'img'
  if (kind === 'md') return 'text'
  return 'frame'
}

/**
 * Classify a failed ctx.rest call. Our own backend answers refusals as JSON
 * ({"ok": false, "error": ...}), so that marker wins; a bare 404 means the FastAPI namespace
 * does not exist yet — i.e. the plugin's backend is not mounted.
 */
function errorStateFor(message) {
  const s = String(message || '')
  if (s.includes('"ok"') && s.includes('false')) return 'refused'
  if (/\b404\b/.test(s)) return 'not-mounted'
  return 'error'
}

/** '~/.hermes/profiles/ops/workspace' -> 'profile:ops'; '/x/y/canvas' -> 'canvas' */
function shortRoot(root) {
  const s = String(root || '')
  const m = /\/profiles\/([^/]+)\/workspace\/?$/.exec(s)
  if (m) return `profile:${m[1]}`
  const parts = s.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : s
}

/** '/home/user/.hermes/...' -> '~/.hermes/...' for display only. */
function tilde(path) {
  return String(path || '').replace(/^\/home\/[^/]+\//, '~/')
}

function formatSize(bytes) {
  const n = Number(bytes)
  if (!isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatAge(mtime, now = Date.now()) {
  const t = Number(mtime)
  if (!isFinite(t) || t <= 0) return '—'
  const secs = Math.max(0, now / 1000 - t)
  if (secs < 45) return 'just now'
  if (secs < 5400) return `${Math.round(secs / 60)}m ago`
  if (secs < 172800) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

/* ------------------------------------------------------------------ data */

const ALWAYS_VISIBLE = atom(true)

/** Poll only while the pane is on screen (falls back to "visible" when the API is unavailable). */
function usePaneVisible() {
  const signal = useMemo(() => {
    try {
      if (host && typeof host.paneVisibility === 'function') return host.paneVisibility(PANE_ID)
    } catch (err) {
      /* fall through to always-visible */
    }
    return ALWAYS_VISIBLE
  }, [])
  return useValue(signal) !== false
}

function useRecent(hours, limit, visible) {
  return useQuery({
    queryKey: [ID, 'recent', hours, limit],
    queryFn: () => ctxRest(`/recent?hours=${hours}&limit=${limit}`),
    refetchInterval: visible ? REFRESH_MS : false,
    retry: false,
  })
}

/**
 * One artifact, through the backend. `format=json` because the desktop REST door JSON-parses
 * every response (raw text/bytes are the backend's wire contract for everyone else).
 */
function useArtifact(item) {
  const [state, setState] = useState({ status: 'idle', mode: null, text: null, dataUrl: null, error: null })
  const path = item && item.path ? item.path : null
  useEffect(() => {
    if (!path) {
      setState({ status: 'idle', mode: null, text: null, dataUrl: null, error: null })
      return () => {}
    }
    let live = true
    setState({ status: 'loading', mode: previewModeFor(kindFor(path)), text: null, dataUrl: null, error: null })
    ctxRest(`/file?path=${encodeURIComponent(path)}&format=json`)
      .then((res) => {
        if (!live) return
        if (!res || res.ok === false) {
          setState({ status: 'error', mode: null, text: null, dataUrl: null, error: (res && res.error) || 'the backend refused this file' })
          return
        }
        setState({
          status: 'ready',
          mode: previewModeFor(res.kind || kindFor(path)),
          text: typeof res.text === 'string' ? res.text : null,
          dataUrl: typeof res.data_url === 'string' ? res.data_url : null,
          error: null,
        })
      })
      .catch((err) => {
        if (!live) return
        setState({ status: 'error', mode: null, text: null, dataUrl: null, error: err && err.message ? err.message : String(err) })
      })
    return () => {
      live = false
    }
  }, [path])
  return state
}

/* ------------------------------------------------------------------ pieces */

function Notice({ tone = 'muted', children }) {
  return jsx('div', {
    className: cn(
      'rounded-lg border border-dashed px-2.5 py-3 text-[11px] leading-relaxed',
      tone === 'warn' ? 'border-[var(--border)] text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted-foreground)]',
    ),
    children,
  })
}

function KindTag({ kind }) {
  return jsx('span', {
    className: 'shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]',
    children: KIND_LABEL[kind] || String(kind || '?'),
  })
}

function Row({ row, selected, onSelect }) {
  return jsxs('button', {
    type: 'button',
    title: row.path,
    onClick: () => onSelect(row),
    className: cn(
      'flex w-full flex-col gap-[3px] rounded-md border px-2 py-1.5 text-left transition-colors',
      selected
        ? 'border-[var(--accent)] bg-[var(--accent)]/15'
        : 'border-[var(--border)] bg-[var(--card)]/60 hover:border-[var(--foreground)]/20',
    ),
    children: [
      jsxs('div', {
        key: 'top',
        className: 'flex w-full items-center gap-1.5',
        children: [
          jsx(KindTag, { key: 'k', kind: row.kind }),
          jsx('span', {
            key: 'n',
            className: cn('flex-1 truncate text-[12px]', selected ? 'text-[var(--foreground)]' : 'text-[var(--foreground)]/90'),
            children: row.name,
          }),
        ],
      }),
      jsxs('div', {
        key: 'meta',
        className: 'flex w-full items-center gap-1.5 text-[10px] tabular-nums text-[var(--muted-foreground)]',
        children: [
          jsx('span', { key: 's', children: formatSize(row.size) }),
          jsx('span', { key: 'd1', children: '·' }),
          jsx('span', { key: 'a', children: formatAge(row.mtime) }),
          jsx('span', { key: 'd2', children: '·' }),
          jsx('span', { key: 'r', className: 'truncate', children: shortRoot(row.root) }),
        ],
      }),
    ],
  })
}

function Preview({ item, height = '260px', header = true }) {
  const state = useArtifact(item)
  if (!item) {
    return jsx(Notice, { children: 'pick an artifact above to preview it' })
  }
  const body = (() => {
    if (state.status === 'loading') {
      return jsx('div', { className: 'px-1 py-3 text-[11px] text-[var(--muted-foreground)]', children: `loading ${item.name}…` })
    }
    if (state.status === 'error') {
      const kind = errorStateFor(state.error)
      const copy =
        kind === 'not-mounted'
          ? 'backend not mounted yet — enable the artifact-lab backend plugin, then refresh'
          : kind === 'refused'
            ? `refused by the backend: ${state.error}`
            : `could not load this artifact: ${state.error}`
      return jsx(Notice, { tone: 'warn', children: copy })
    }
    if (state.status !== 'ready') {
      return jsx('div', { className: 'px-1 py-3 text-[11px] text-[var(--muted-foreground)]', children: 'nothing loaded yet' })
    }
    if (state.mode === 'frame') {
      // sandbox="allow-scripts": no allow-same-origin, no allow-top-navigation — guest HTML/SVG
      // cannot reach the app or steer the window; it only renders itself.
      return jsx('iframe', {
        sandbox: 'allow-scripts',
        srcDoc: state.text || '',
        title: item.name,
        className: 'w-full rounded-md border border-[var(--border)] bg-[var(--card)]',
        style: { height },
      })
    }
    if (state.mode === 'img') {
      return state.dataUrl
        ? jsx('img', {
            src: state.dataUrl,
            alt: item.name,
            className: 'max-w-full rounded-md border border-[var(--border)] object-contain',
            style: { maxHeight: height },
          })
        : jsx(Notice, { tone: 'warn', children: 'the backend returned no image bytes for this file' })
    }
    return jsx('pre', {
      className: 'overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--border)] bg-[var(--card)]/60 p-2 text-[11px] leading-relaxed text-[var(--foreground)]',
      style: { maxHeight: height },
      children: state.text || '(empty file)',
    })
  })()
  return jsxs('div', {
    className: 'space-y-1',
    children: [
      header
        ? jsxs('div', {
            key: 'h',
            className: 'flex items-center gap-1.5',
            children: [
              jsx(KindTag, { key: 'k', kind: item.kind }),
              jsx('span', { key: 'n', className: 'flex-1 truncate text-[11px] text-[var(--foreground)]', children: item.name }),
              jsx('span', { key: 's', className: 'shrink-0 text-[10px] text-[var(--muted-foreground)]', children: `${formatSize(item.size)} · ${formatAge(item.mtime)}` }),
            ],
          })
        : null,
      jsx('div', { key: 'b', children: body }),
      jsx('div', { key: 'p', className: 'truncate text-[10px] text-[var(--muted-foreground)]', title: item.path, children: tilde(item.path) }),
    ],
  })
}

function BackendState({ error, onRetry }) {
  const kind = errorStateFor(error)
  const title = kind === 'not-mounted' ? 'backend not mounted yet' : kind === 'refused' ? 'the backend refused the request' : 'the backend did not answer'
  const body =
    kind === 'not-mounted'
      ? 'This pane needs the artifact-lab backend plugin at /api/plugins/artifact-lab. Mount it (plugins.enabled), restart the gateway, then refresh.'
      : kind === 'refused'
        ? `The backend answered with a refusal: ${error}`
        : `No answer from the artifact-lab backend: ${error}`
  return jsxs('div', {
    className: 'space-y-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-3',
    children: [
      jsx('div', { key: 't', className: 'text-[11px] font-semibold text-[var(--foreground)]', children: title }),
      jsx('div', { key: 'b', className: 'text-[11px] leading-relaxed text-[var(--muted-foreground)]', children: body }),
      jsx(Button, { key: 'r', size: 'sm', variant: 'outline', onClick: onRetry, children: 'retry' }),
    ],
  })
}

function RootsList({ roots }) {
  if (!roots || !roots.length) return jsx('div', { className: 'text-[11px] text-[var(--muted-foreground)]', children: 'the backend reported no artifact roots' })
  return jsx('ul', {
    className: 'space-y-0.5',
    children: roots.map((r) =>
      jsxs(
        'li',
        {
          key: r.path,
          className: 'flex items-center gap-1.5 text-[10.5px] text-[var(--muted-foreground)]',
          children: [
            jsx('span', { key: 'p', className: 'truncate', title: r.path, children: tilde(r.path) }),
            jsx('span', { key: 's', className: 'shrink-0', children: r.exists ? `${r.artifacts || 0}` : 'missing' }),
          ],
        },
        r.path,
      ),
    ),
  })
}

/* ------------------------------------------------------------------ the pane */

function BenchPane() {
  const visible = usePaneVisible()
  const [hours, setHours] = useState(HOURS)
  const [selected, setSelected] = useState(null)
  const [compare, setCompare] = useState(false)
  const [pairIndex, setPairIndex] = useState(0)

  const query = useRecent(hours, LIMIT, visible)
  const data = query.data || null
  const items = (data && data.items) || []
  const roots = (data && data.roots) || []
  const pairs = useMemo(() => detectPairs(items), [items])
  const pair = pairs.length ? pairs[Math.min(pairIndex, pairs.length - 1)] : null

  const refresh = useCallback(() => {
    try {
      queryClient.invalidateQueries({ queryKey: [ID, 'recent'] })
    } catch (err) {
      /* invalidation is best-effort; the poll will catch up */
    }
    try {
      haptic('tap')
    } catch (err) {
      /* haptics are optional */
    }
  }, [])

  useEffect(() => {
    if (!pairs.length && compare) setCompare(false)
  }, [pairs.length, compare])

  const header = jsxs('div', {
    key: 'head',
    className: 'flex items-center gap-1.5 border-b border-[var(--border)] px-2.5 py-2',
    children: [
      jsxs('div', {
        key: 't',
        className: 'flex-1',
        children: [
          jsx('div', { className: 'text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground)]', children: 'artifact lab' }),
          jsx('div', {
            className: 'text-[10px] tabular-nums text-[var(--muted-foreground)]',
            children: data
              ? `${items.length} of ${data.total_all} · ${data.total_in_window} in ${data.window_hours > 0 ? `${data.window_hours}h` : 'any window'} · ${data.files_seen} files seen`
              : 'waiting for the backend…',
          }),
        ],
      }),
      pairs.length
        ? jsx('button', {
            key: 'cmp',
            type: 'button',
            onClick: () => {
              setCompare((v) => !v)
              try {
                haptic('tap')
              } catch (err) {
                /* optional */
              }
            },
            className: cn(
              'rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
              compare ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted-foreground)]',
            ),
            title: `compare ${pairs.length} version pair${pairs.length === 1 ? '' : 's'} found in this list`,
            children: compare ? 'single' : `compare ${pairs.length}`,
          })
        : null,
      jsx('button', {
        key: 'ref',
        type: 'button',
        onClick: refresh,
        className: 'rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
        title: 're-scan the artifact roots',
        children: 'refresh',
      }),
    ],
  })

  if (query.isError) {
    return jsxs('div', {
      className: 'flex h-full w-full flex-col gap-2 overflow-y-auto bg-[var(--background)]',
      children: [header, jsx('div', { key: 'err', className: 'px-2.5 py-2', children: jsx(BackendState, { error: query.error && query.error.message ? query.error.message : String(query.error), onRetry: refresh }) })],
    })
  }

  const body = (() => {
    if (!items.length) {
      const older = data && data.total_all > 0
      return jsxs('div', {
        className: 'space-y-2 px-2.5 py-2',
        children: [
          jsx(Notice, {
            key: 'n',
            children: older
              ? `no artifacts in the watched roots inside the ${data.window_hours}h window — ${data.total_all} older artifact${data.total_all === 1 ? '' : 's'} exist`
              : 'no artifacts in the watched roots',
          }),
          older
            ? jsx(Button, { key: 'w', size: 'sm', variant: 'outline', onClick: () => setHours(0), children: 'widen to all time' })
            : null,
          jsx('div', { key: 'r', className: 'pt-1 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]', children: 'roots scanned' }),
          jsx(RootsList, { key: 'l', roots }),
        ],
      })
    }
    if (compare && pair) {
      return jsxs('div', {
        className: 'space-y-2 px-2.5 py-2',
        children: [
          pairs.length > 1
            ? jsx('div', {
                key: 'pick',
                className: 'flex flex-wrap gap-1',
                children: pairs.map((p, i) =>
                  jsx(
                    'button',
                    {
                      type: 'button',
                      onClick: () => setPairIndex(i),
                      title: p.a.path + '  ↔  ' + p.b.path,
                      className: cn(
                        'rounded-md border px-1.5 py-0.5 text-[10px]',
                        i === pairIndex ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted-foreground)]',
                      ),
                      children: p.label,
                    },
                    p.key,
                  ),
                ),
              })
            : null,
          jsxs('div', {
            key: 'two',
            className: 'grid grid-cols-2 gap-2',
            children: [jsx(Preview, { key: 'a', item: pair.a, height: '200px' }), jsx(Preview, { key: 'b', item: pair.b, height: '200px' })],
          }),
        ],
      })
    }
    return jsxs('div', {
      className: 'space-y-2 px-2.5 py-2',
      children: [
        selected ? jsx(Preview, { key: 'prev', item: selected }) : null,
        jsx(Separator, { key: 'sep' }),
        jsx('div', {
          key: 'list',
          className: 'space-y-1',
          children: items.map((row) =>
            jsx(Row, { key: row.path, row, selected: !!selected && selected.path === row.path, onSelect: (r) => setSelected(r) }),
          ),
        }),
      ],
    })
  })()

  return jsxs('div', {
    className: 'flex h-full w-full flex-col overflow-y-auto bg-[var(--background)]',
    children: [
      header,
      data && data.capped
        ? jsx('div', { key: 'cap', className: 'border-b border-[var(--border)] px-2.5 py-1.5 text-[10px] text-[var(--foreground)]', children: 'partial scan — the walk hit its work cap' })
        : null,
      body,
      jsx('div', {
        key: 'foot',
        className: 'mt-auto border-t border-[var(--border)] px-2.5 py-2 text-[10px] text-[var(--muted-foreground)]',
        children: `roots are allowlisted in the backend · refresh every ${Math.round(REFRESH_MS / 1000)}s while visible`,
      }),
    ],
  })
}

/* ------------------------------------------------------------------ registration */

export default {
  id: ID,
  name: 'Artifact Lab',
  description: 'Live preview bench for the artifacts the agents produce: list the newest ones, preview them, compare two versions side by side.',
  register(ctx) {
    ctxRest = (path, opts) => ctx.rest(path, opts)

    ctx.register({
      id: PANE,
      area: PANES_AREA,
      title: 'Artifact Lab',
      data: { placement: 'right', width: '360px' },
      render: () => jsx(BenchPane, {}),
    })

    ctx.register({
      id: 'refresh',
      area: PALETTE_AREA,
      data: {
        id: `${ID}.refresh`,
        label: 'Artifact Lab: refresh the artifact bench',
        keywords: ['artifact', 'lab', 'preview', 'poster', 'svg', 'html', 'markdown', 'compare', 'bench'],
        run: () => {
          try {
            queryClient.invalidateQueries({ queryKey: [ID, 'recent'] })
          } catch (err) {
            /* best effort */
          }
          try {
            haptic('tap')
          } catch (err) {
            /* optional */
          }
        },
      },
    })
  },
}
