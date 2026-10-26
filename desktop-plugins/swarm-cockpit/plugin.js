/**
 * Swarm Cockpit — a flight tracker for the focused session's `delegate_task` workers.
 *
 * One pane shows every child the focused session still owns: goal, status, age,
 * tool count, last tool, and (on demand) a bounded live transcript tail — with the
 * two controls the gateway actually exposes, steer and hard interrupt. A status-bar
 * chip carries the live count so the swarm is visible without the pane.
 *
 * Server-side truth (read, never guessed):
 *   tui_gateway/methods_subagents.py
 *     subagent.list      { session_id }              -> { subagents: [snapshot], delegations: [] }
 *     subagent.tail      { session_id, subagent_id } -> { subagent_id, available, text, truncated }
 *     subagent.interrupt { session_id, subagent_id } -> { found, subagent_id }
 *   tui_gateway/methods_session.py
 *     subagent.steer     { session_id, subagent_id, text } -> { status: 'queued' | 'rejected', ... }
 *   Snapshot fields: subagent_id, parent_id, depth, goal, delegation_id, model,
 *   started_at (epoch SECONDS), status, tool_count, last_tool, accepting_steer.
 *   Status enum: queued | running | completed | failed | error | timeout | interrupted.
 *
 * Every one of those RPCs resolves authority through `_current_session_steer_authority`,
 * which requires the RUNTIME session id of a session this transport owns — so the pane
 * reads host.state.focusedSessionId (tile-aware runtime id, the documented preference
 * for session.* RPC) and falls back to host.state.activeSessionId.
 *
 * Live updates: a 2s poll while the pane is visible (cleared on unmount) plus the
 * gateway's `subagent.*` event stream as a coalesced accelerator when the host
 * exposes ctx.onEvent. Polling stays authoritative — events only shorten the wait.
 *
 * Surfaces:
 *   - Right-rail pane  (PANES_AREA          -> 'pane', placement right, 340px)
 *   - Status-bar chip  (STATUSBAR_AREAS.right -> 'chip', live count)
 *   - Command palette  (PALETTE_AREA         -> 'reveal')
 *
 * Honest states: no gateway, no focused session, an RPC refusal, and zero tracked
 * children each get their own copy. Nothing here invents a number or spins forever.
 */

import {
  Button,
  Codicon,
  Input,
  PALETTE_AREA,
  PANES_AREA,
  STATUSBAR_AREAS,
  atom,
  cn,
  haptic,
  host,
  useValue,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useMemo, useState } from 'react'

const ID = 'swarm-cockpit'
/** Contribution-scoped pane id — the id paneVisibility()/revealPane() speak. */
const PANE_ID = `${ID}:pane`
const POLL_MS = 2000
const CHIP_POLL_MS = 5000
const EVENT_COALESCE_MS = 300
const AGE_TICK_MS = 1000
const TAIL_LINES = 6
const CLIP_CHARS = 200

/** Gateway event names from tui_gateway/contracts/events.py (subagent frames). */
const EVENT_TYPES = [
  'subagent.spawn_requested',
  'subagent.start',
  'subagent.progress',
  'subagent.thinking',
  'subagent.tool',
  'subagent.complete',
]

/* ------------------------------------------------------------------ atoms */

const NULL_ATOM = atom(null)
const TRUE_ATOM = atom(true)

/** Use the host atom when it looks like one; otherwise a stable inert atom. */
function pickAtom(candidate, fallback) {
  return candidate && typeof candidate.get === 'function' ? candidate : fallback
}

// The event tick is created lazily so module load never depends on SDK wiring
// (a test harness can load this file with a stubbed SDK).
let eventTickAtom = null

function eventTick() {
  if (!eventTickAtom) {
    eventTickAtom = atom(0)
  }

  return eventTickAtom
}

let eventTimer = null

/** Coalesce a burst of gateway frames into one extra refresh. */
function scheduleEventRefresh() {
  if (typeof setTimeout !== 'function' || eventTimer !== null) {
    return
  }

  eventTimer = setTimeout(() => {
    eventTimer = null
    const tick = eventTick()
    tick.set((tick.get() || 0) + 1)
  }, EVENT_COALESCE_MS)

  if (eventTimer && typeof eventTimer.unref === 'function') {
    eventTimer.unref()
  }
}

/* ------------------------------------------------------------------ pure helpers */

const STATUS_KEYS = {
  queued: { key: 'queued', label: 'queued', tone: 'text-(--ui-text-tertiary)', dot: 'var(--ui-text-tertiary)' },
  running: { key: 'running', label: 'running', tone: 'text-(--ui-purple)', dot: 'var(--ui-purple)' },
  completed: { key: 'completed', label: 'completed', tone: 'text-(--ui-green)', dot: 'var(--ui-green)' },
  failed: { key: 'failed', label: 'failed', tone: 'text-(--ui-red)', dot: 'var(--ui-red)' },
  error: { key: 'error', label: 'error', tone: 'text-(--ui-red)', dot: 'var(--ui-red)' },
  timeout: { key: 'timeout', label: 'timed out', tone: 'text-(--ui-yellow)', dot: 'var(--ui-yellow)' },
  interrupted: { key: 'interrupted', label: 'interrupted', tone: 'text-(--ui-text-quaternary)', dot: 'var(--ui-text-quaternary)' },
}

const UNKNOWN_STATUS = {
  key: 'unknown',
  label: 'unknown',
  tone: 'text-(--ui-text-quaternary)',
  dot: 'var(--ui-text-quaternary)',
}

const asText = (value) => (typeof value === 'string' ? value : '')
const asNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** Canonical status key; unknown-but-present statuses keep their raw label. */
function statusKey(raw) {
  const key = asText(raw).trim().toLowerCase()

  if (key === 'cancelled' || key === 'canceled') {
    return 'interrupted'
  }

  return key || 'unknown'
}

function statusMeta(raw) {
  const key = statusKey(raw)
  const known = STATUS_KEYS[key]

  if (known) {
    return known
  }

  return { key, label: key, tone: UNKNOWN_STATUS.tone, dot: UNKNOWN_STATUS.dot }
}

function isLiveStatus(raw) {
  const key = statusKey(raw)

  return key === 'running' || key === 'queued'
}

function isLiveRow(row) {
  return !!row && isLiveStatus(row.status)
}

/** One server snapshot -> the flat row shape every view here renders. */
function normalizeRow(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const startedAt = asNumber(src.started_at)
  const accepting = src.accepting_steer

  return {
    id: asText(src.subagent_id),
    parentId: asText(src.parent_id) || null,
    depth: asNumber(src.depth),
    goal: asText(src.goal).trim() || 'untitled goal',
    delegationId: asText(src.delegation_id) || null,
    model: asText(src.model) || null,
    startedAtMs: startedAt === null ? null : Math.round(startedAt * 1000),
    status: statusKey(src.status),
    toolCount: asNumber(src.tool_count),
    lastTool: asText(src.last_tool) || null,
    // Tri-state: true/false from the server, null when the field is absent.
    acceptingSteer: accepting === true ? true : accepting === false ? false : null,
  }
}

function compareRows(a, b) {
  const live = (isLiveRow(b) ? 1 : 0) - (isLiveRow(a) ? 1 : 0)

  if (live !== 0) {
    return live
  }

  const at = (a.startedAtMs === null ? Number.MAX_SAFE_INTEGER : a.startedAtMs)
  const bt = (b.startedAtMs === null ? Number.MAX_SAFE_INTEGER : b.startedAtMs)

  if (at !== bt) {
    return at - bt
  }

  return String(a.id).localeCompare(String(b.id))
}

/** Live first, then oldest first, then by id — deterministic for a given roster. */
function sortRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort(compareRows)
}

function walksUpTo(nodes, fromId, targetId) {
  const seen = new Set()
  let cursor = fromId

  while (cursor && !seen.has(cursor)) {
    if (cursor === targetId) {
      return true
    }

    seen.add(cursor)
    const node = nodes.get(cursor)
    cursor = node ? node.row.parentId : null
  }

  return false
}

/** Rows -> parent/child forest. Broken or cyclic parent links stay roots. */
function buildForest(rows) {
  const list = sortRows(rows)
  const nodes = new Map()

  for (const row of list) {
    if (row.id && !nodes.has(row.id)) {
      nodes.set(row.id, { row, children: [] })
    }
  }

  const roots = []

  for (const node of nodes.values()) {
    const parentId = node.row.parentId
    const parent = parentId && parentId !== node.row.id ? nodes.get(parentId) : null
    const cyclic = parent ? walksUpTo(nodes, parentId, node.row.id) : false

    if (parent && !cyclic) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortBranch = (branch) => {
    branch.sort((a, b) => compareRows(a.row, b.row))
    for (const node of branch) {
      sortBranch(node.children)
    }
  }

  sortBranch(roots)

  return roots
}

/** Depth-first [{ row, indent }] for rendering; indent is the visual nesting. */
function flattenForest(forest) {
  const out = []

  const walk = (branch, indent) => {
    for (const node of branch) {
      out.push({ row: node.row, indent })
      walk(node.children, indent + 1)
    }
  }

  walk(Array.isArray(forest) ? forest : [], 0)

  return out
}

function ageSeconds(startedAtMs, nowMs) {
  if (startedAtMs === null || startedAtMs === undefined) {
    return null
  }

  const now = typeof nowMs === 'number' ? nowMs : Date.now()

  return Math.max(0, Math.floor((now - startedAtMs) / 1000))
}

function formatAge(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))

  if (s < 60) {
    return `${s}s`
  }

  const m = Math.floor(s / 60)

  if (m < 60) {
    return `${m}m${String(s % 60).padStart(2, '0')}s`
  }

  const h = Math.floor(m / 60)

  if (h < 48) {
    return `${h}h${String(m % 60).padStart(2, '0')}m`
  }

  const d = Math.floor(h / 24)

  return `${d}d${String(h % 24).padStart(2, '0')}h`
}

function ageLine(row, nowMs) {
  const age = ageSeconds(row ? row.startedAtMs : null, nowMs)

  if (age === null) {
    return 'start time not reported'
  }

  return isLiveRow(row) ? `${formatAge(age)} elapsed` : `started ${formatAge(age)} ago`
}

/** Secondary line: age · tool count · last tool (only what the roster reported). */
function metaLine(row, nowMs) {
  const parts = [ageLine(row, nowMs)]

  if (row && typeof row.toolCount === 'number') {
    parts.push(`${row.toolCount} tool${row.toolCount === 1 ? '' : 's'}`)
  }

  if (row && row.lastTool) {
    parts.push(row.lastTool)
  }

  return parts.join(' · ')
}

function clip(text, max = CLIP_CHARS) {
  const line = asText(text).replace(/\s+/g, ' ').trim()

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** Last non-empty lines of a `subagent.tail` payload (newest last). */
function tailLines(text, max = TAIL_LINES) {
  return asText(text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-max)
}

/** The one line that says what the child is doing right now. */
function activityLine(row, tailText) {
  const newest = tailLines(tailText, 1)

  if (newest.length) {
    return clip(newest[0])
  }

  if (row && row.lastTool) {
    return `last tool: ${row.lastTool}`
  }

  if (row && row.status === 'queued') {
    return 'queued — waiting for a slot'
  }

  if (isLiveRow(row)) {
    return 'running — no live transcript yet'
  }

  return 'no live transcript (child finished)'
}

function counts(rows) {
  const out = { total: 0, live: 0, queued: 0, running: 0, completed: 0, failed: 0, interrupted: 0, other: 0 }

  for (const row of Array.isArray(rows) ? rows : []) {
    out.total += 1
    const key = row ? row.status : 'unknown'

    if (key === 'queued') {
      out.queued += 1
      out.live += 1
    } else if (key === 'running') {
      out.running += 1
      out.live += 1
    } else if (key === 'completed') {
      out.completed += 1
    } else if (key === 'failed' || key === 'error' || key === 'timeout') {
      out.failed += 1
    } else if (key === 'interrupted') {
      out.interrupted += 1
    } else {
      out.other += 1
    }
  }

  return out
}

function chipLabel(tally) {
  const c = tally || counts([])

  if (c.live > 0) {
    return `${c.live} live`
  }

  if (c.total === 0) {
    return 'idle'
  }

  return c.failed > 0 ? `${c.failed} failed` : `${c.total} done`
}

function chipTitle(tally, sessionId, gateway) {
  const c = tally || counts([])
  const parts = []

  if (gateway !== 'open') {
    parts.push(`backend socket: ${gateway || 'unknown'}`)
  }

  if (sessionId) {
    parts.push(`session ${String(sessionId).slice(0, 8)}`)
  }

  parts.push(`${c.live} live (${c.running} running, ${c.queued} queued)`)
  parts.push(`${c.completed} completed`)
  parts.push(`${c.failed} failed`)
  parts.push('swarm-cockpit — click to reveal the pane')

  return parts.join(' · ')
}

/** Gateway/RPC failure -> copy that says what actually happened. */
function rpcErrorCopy(err) {
  const raw =
    err && typeof err === 'object'
      ? asText(err.message) || asText(err.data && err.data.message)
      : asText(err)
  const message = raw.trim()

  if (/not owned by this transport|session not found/i.test(message)) {
    return 'the gateway does not own this session (another client or profile owns it), so subagent control is unavailable here'
  }

  if (/method not found|unknown method|-32601/i.test(message)) {
    return 'this gateway build has no subagent.list RPC — update the backend to track the swarm'
  }

  if (/text is required/i.test(message)) {
    return 'steer text was empty'
  }

  return message || 'unknown RPC error'
}

/* ------------------------------------------------------------------ data */

async function fetchSnapshot(sessionId) {
  const result = await host.request('subagent.list', { session_id: sessionId })
  const raw = result && Array.isArray(result.subagents) ? result.subagents : []

  return raw.map(normalizeRow).filter((row) => !!row.id)
}

async function fetchTail(sessionId, subagentId) {
  const result = await host.request('subagent.tail', { session_id: sessionId, subagent_id: subagentId })

  return {
    available: !!(result && result.available),
    text: asText(result && result.text),
    truncated: !!(result && result.truncated),
  }
}

/* ------------------------------------------------------------------ hooks */

function useRuntimeSessionId() {
  const focused = useValue(pickAtom(host.state && host.state.focusedSessionId, NULL_ATOM))
  const active = useValue(pickAtom(host.state && host.state.activeSessionId, NULL_ATOM))

  return focused || active || null
}

function useGatewayState() {
  const state = useValue(pickAtom(host.state && host.state.gateway, NULL_ATOM))

  return typeof state === 'string' && state ? state : 'unknown'
}

/** True unless the host reports the pane off-screen (feature-detected). */
function usePaneVisible() {
  const visAtom = useMemo(
    () => (typeof host.paneVisibility === 'function' ? host.paneVisibility(PANE_ID) : null),
    []
  )

  return useValue(pickAtom(visAtom, TRUE_ATOM)) !== false
}

/**
 * The roster: poll `subagent.list` on a fixed cadence while `enabled`, refresh
 * immediately when a gateway `subagent.*` frame lands, and surface the RPC error
 * as copy instead of a fake row. Intervals are always cleared on unmount.
 */
function useSubagentFeed(sessionId, enabled, pollMs) {
  const [snapshot, setSnapshot] = useState({ rows: [], error: null, at: 0, loading: false })
  const tick = useValue(eventTick())

  const refresh = useCallback(async () => {
    if (!sessionId || !enabled) {
      return
    }

    setSnapshot((prev) => (prev.loading ? prev : { ...prev, loading: true }))

    try {
      const rows = await fetchSnapshot(sessionId)
      setSnapshot({ rows, error: null, at: Date.now(), loading: false })
    } catch (err) {
      setSnapshot((prev) => ({ rows: prev.rows, error: rpcErrorCopy(err), at: Date.now(), loading: false }))
    }
  }, [sessionId, enabled])

  useEffect(() => {
    if (!sessionId || !enabled) {
      return undefined
    }

    let cancelled = false
    const run = () => {
      if (!cancelled) {
        void refresh()
      }
    }

    run()
    const handle = setInterval(run, pollMs)

    if (handle && typeof handle.unref === 'function') {
      handle.unref()
    }

    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [sessionId, enabled, pollMs, refresh])

  // Events are an accelerator over the poll, never the source of truth.
  useEffect(() => {
    if (tick && sessionId && enabled) {
      void refresh()
    }

    return undefined
  }, [tick, sessionId, enabled, refresh])

  return { ...snapshot, refresh }
}

/** 1s clock for the age lines, running only while something is live on screen. */
function useAgeClock(active) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!active) {
      return undefined
    }

    const handle = setInterval(() => setNowMs(Date.now()), AGE_TICK_MS)

    if (handle && typeof handle.unref === 'function') {
      handle.unref()
    }

    return () => clearInterval(handle)
  }, [active])

  return nowMs
}

/* ------------------------------------------------------------------ pane */

function StateBlock({ icon, title, body, action }) {
  return jsxs('div', {
    className: 'flex flex-col items-start gap-1 rounded-[3px] px-2 py-2',
    style: { border: '1px solid var(--border)' },
    children: [
      jsxs('div', {
        className: 'flex items-center gap-1.5 text-xs text-(--ui-text-secondary)',
        children: [
          jsx(Codicon, { name: icon, size: '0.8rem' }),
          jsx('span', { className: 'font-medium', children: title }),
        ],
      }),
      jsx('div', { className: 'text-[0.7rem] leading-4 text-(--ui-text-tertiary)', children: body }),
      action || null,
    ],
  })
}

function SubagentRow({ node, nowMs, tail, notice, busy, confirming, draft, onToggle, onDraft, onSteer, onAskInterrupt, onCancelInterrupt, onConfirmInterrupt }) {
  const { row, indent } = node
  const meta = statusMeta(row.status)
  const expanded = !!tail
  const live = isLiveRow(row)
  const canSteer = live && row.acceptingSteer !== false
  const isBusy = busy === 'steer' || busy === 'interrupt'

  const detail = jsxs('div', {
    className: 'mt-1 flex flex-col gap-1 pl-3 text-[0.68rem] text-(--ui-text-tertiary)',
    children: [
      jsx('div', {
        children: [
          `id ${row.id}`,
          row.model ? ` · model ${row.model}` : '',
          typeof row.depth === 'number' ? ` · spawn depth ${row.depth}` : '',
          row.delegationId ? ` · batch ${String(row.delegationId).slice(0, 8)}` : '',
        ].join(''),
      }),
      live
        ? jsxs('div', {
            className: 'flex items-center gap-1',
            children: [
              jsx(Input, {
                value: draft,
                onChange: (event) => onDraft(event && event.target ? event.target.value : ''),
                onKeyDown: (event) => {
                  if (event && event.key === 'Enter') {
                    event.preventDefault()
                    onSteer()
                  }
                },
                placeholder: canSteer ? 'steer this worker…' : 'this worker is not accepting steer',
                disabled: !canSteer || isBusy,
                className: 'h-6 min-w-0 flex-1 text-[0.68rem]',
              }),
              jsx(Button, {
                variant: 'outline',
                size: 'micro',
                disabled: !canSteer || isBusy || !asText(draft).trim(),
                onClick: onSteer,
                children: 'steer',
              }),
            ],
          })
        : null,
      jsx('div', {
        className: 'whitespace-pre-wrap leading-4 text-(--ui-text-quaternary)',
        children: tail && tail.available
          ? tailLines(tail.text, TAIL_LINES).join('\n') || 'live transcript is empty so far'
          : tail && tail.error
            ? `transcript unavailable: ${tail.error}`
            : 'live transcript not available yet (the child has no transcript file)',
      }),
      tail && tail.truncated
        ? jsx('div', { className: 'text-(--ui-text-quaternary)', children: 'transcript tail truncated to the last 16KB' })
        : null,
    ],
  })

  // The steer/interrupt outcome stays visible even when the row is collapsed,
  // so an action's result can never be lost by collapsing the row.
  const noticeNode = notice
    ? jsx('div', {
        className: cn(
          'mt-1 pl-3 leading-4',
          notice.kind === 'error' ? 'text-(--ui-red)' : notice.kind === 'warn' ? 'text-(--ui-yellow)' : 'text-(--ui-text-quaternary)'
        ),
        children: notice.text,
      })
    : null

  return jsxs('div', {
    className: 'py-1.5',
    style: { paddingLeft: `${6 + indent * 12}px`, borderTop: '1px solid var(--border)' },
    children: [
      jsxs('div', {
        className: 'flex items-start gap-1.5',
        children: [
          jsx('span', {
            className: 'mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full',
            style: { background: meta.dot },
          }),
          jsxs('button', {
            type: 'button',
            onClick: onToggle,
            className: 'min-w-0 flex-1 cursor-pointer text-left',
            title: 'show live transcript and controls',
            children: [
              jsx('span', { className: 'block truncate text-xs text-(--ui-text-primary)', children: row.goal }),
              jsx('span', { className: 'block truncate text-[0.68rem] text-(--ui-text-tertiary)', children: metaLine(row, nowMs) }),
              jsx('span', { className: 'block truncate text-[0.68rem] text-(--ui-text-quaternary)', children: activityLine(row, tail && tail.text) }),
            ],
          }),
          jsx('span', {
            className: cn('shrink-0 text-[0.62rem] uppercase tracking-wide', meta.tone),
            children: meta.label,
          }),
        ],
      }),
      jsxs('div', {
        className: 'mt-1 flex items-center gap-1 pl-3',
        children: [
          jsx(Button, {
            variant: 'text',
            size: 'micro',
            onClick: onToggle,
            children: expanded ? 'hide' : 'inspect',
          }),
          confirming
            ? jsxs('span', {
                className: 'flex items-center gap-1',
                children: [
                  jsx(Button, {
                    variant: 'destructive',
                    size: 'micro',
                    disabled: isBusy,
                    onClick: onConfirmInterrupt,
                    children: 'confirm interrupt',
                  }),
                  jsx(Button, { variant: 'text', size: 'micro', onClick: onCancelInterrupt, children: 'cancel' }),
                ],
              })
            : jsx(Button, {
                variant: 'text',
                size: 'micro',
                disabled: !live || isBusy,
                onClick: onAskInterrupt,
                children: live ? 'interrupt…' : 'finished',
              }),
        ],
      }),
      noticeNode,
      expanded ? detail : null,
    ],
  })
}

function CockpitPane() {
  const paneVisible = usePaneVisible()
  const sessionId = useRuntimeSessionId()
  const gateway = useGatewayState()
  const connected = gateway === 'open'
  const feed = useSubagentFeed(sessionId, connected && paneVisible, POLL_MS)
  const [expanded, setExpanded] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [notices, setNotices] = useState({})
  const [busy, setBusy] = useState({})
  const [confirming, setConfirming] = useState(null)
  const [tails, setTails] = useState({})

  const tally = useMemo(() => counts(feed.rows), [feed.rows])
  const nowMs = useAgeClock(paneVisible && tally.live > 0)

  // Transcript tail follows the expanded row, same cadence as the roster.
  useEffect(() => {
    if (!expanded || !sessionId || !connected || !paneVisible) {
      return undefined
    }

    let cancelled = false
    const run = async () => {
      try {
        const tail = await fetchTail(sessionId, expanded)

        if (!cancelled) {
          setTails((prev) => ({ ...prev, [expanded]: { ...tail, error: null } }))
        }
      } catch (err) {
        if (!cancelled) {
          setTails((prev) => ({ ...prev, [expanded]: { available: false, text: '', truncated: false, error: rpcErrorCopy(err) } }))
        }
      }
    }

    void run()
    const handle = setInterval(run, POLL_MS)

    if (handle && typeof handle.unref === 'function') {
      handle.unref()
    }

    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [expanded, sessionId, connected, paneVisible])

  const toggle = useCallback((row) => {
    haptic('tap')
    setExpanded((prev) => (prev === row.id ? null : row.id))
  }, [])

  const setNotice = useCallback((id, notice) => {
    setNotices((prev) => ({ ...prev, [id]: notice }))
  }, [])

  const clearBusy = useCallback((id) => {
    setBusy((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const steer = useCallback(
    async (row) => {
      const text = asText(drafts[row.id]).trim()

      if (!sessionId || !text) {
        return
      }

      setBusy((prev) => ({ ...prev, [row.id]: 'steer' }))

      try {
        const result = await host.request('subagent.steer', {
          session_id: sessionId,
          subagent_id: row.id,
          text,
        })
        const status = asText(result && result.status)

        if (status === 'queued') {
          setNotice(row.id, { kind: 'ok', text: 'steer queued — it lands on the child’s next tool batch' })
          setDrafts((prev) => ({ ...prev, [row.id]: '' }))
        } else {
          setNotice(row.id, {
            kind: 'warn',
            text: `steer rejected${status ? ` (${status})` : ''} — the child is past its final tool batch`,
          })
        }
      } catch (err) {
        setNotice(row.id, { kind: 'error', text: `steer failed: ${rpcErrorCopy(err)}` })
      } finally {
        clearBusy(row.id)
      }
    },
    [clearBusy, drafts, sessionId, setNotice]
  )

  const interrupt = useCallback(
    async (row) => {
      if (!sessionId) {
        return
      }

      setBusy((prev) => ({ ...prev, [row.id]: 'interrupt' }))

      try {
        const result = await host.request('subagent.interrupt', {
          session_id: sessionId,
          subagent_id: row.id,
        })
        const found = !!(result && result.found)

        setNotice(row.id, {
          kind: found ? 'warn' : 'muted',
          text: found
            ? 'hard interrupt requested — the child stops at its next checkpoint'
            : 'nothing to interrupt — the child already finished',
        })
        void feed.refresh()
      } catch (err) {
        setNotice(row.id, { kind: 'error', text: `interrupt failed: ${rpcErrorCopy(err)}` })
      } finally {
        setConfirming(null)
        clearBusy(row.id)
      }
    },
    [clearBusy, feed, sessionId, setNotice]
  )

  const rows = useMemo(() => flattenForest(buildForest(feed.rows)), [feed.rows])

  let body

  if (!connected) {
    body = jsx(StateBlock, {
      icon: 'plug',
      title: 'backend not connected',
      body: `the desktop gateway socket is "${gateway}" — the cockpit cannot read subagent state until it is open. This pane stays honest rather than guessing.`,
    })
  } else if (!sessionId) {
    body = jsx(StateBlock, {
      icon: 'comment-discussion',
      title: 'no focused session',
      body: 'open a chat — the cockpit tracks the delegate_task workers of the chat you are looking at.',
    })
  } else if (feed.error) {
    body = jsx(StateBlock, {
      icon: 'error',
      title: 'subagent.list failed',
      body: feed.error,
      action: jsx(Button, { variant: 'outline', size: 'micro', onClick: () => { haptic('tap'); void feed.refresh() }, children: 'retry' }),
    })
  } else if (rows.length === 0) {
    body = jsx(StateBlock, {
      icon: 'rocket',
      title: 'no live subagents',
      body: 'delegate_task runs will appear here. The roster only lists children the gateway still holds, so finished runs drop off — that is the gateway, not a bug in this pane.',
    })
  } else {
    body = jsx('div', {
      className: 'flex flex-col',
      children: rows.map((node) =>
        jsx(
          SubagentRow,
          {
            node,
            nowMs,
            tail: expanded === node.row.id ? tails[node.row.id] || { available: false, text: '', truncated: false, error: null } : null,
            notice: notices[node.row.id] || null,
            busy: busy[node.row.id] || null,
            confirming: confirming === node.row.id,
            draft: drafts[node.row.id] || '',
            onToggle: () => toggle(node.row),
            onDraft: (value) => setDrafts((prev) => ({ ...prev, [node.row.id]: value })),
            onSteer: () => void steer(node.row),
            onAskInterrupt: () => {
              haptic('tap')
              setConfirming(node.row.id)
            },
            onCancelInterrupt: () => setConfirming(null),
            onConfirmInterrupt: () => void interrupt(node.row),
          },
          node.row.id
        )
      ),
    })
  }

  const updated = feed.at ? `updated ${formatAge(ageSeconds(feed.at, nowMs) ?? 0)} ago` : 'never updated'

  return jsxs('div', {
    className: 'flex h-full flex-col gap-2 overflow-y-auto p-2 text-sm',
    children: [
      jsxs('div', {
        className: 'flex items-center gap-1.5',
        children: [
          jsx(Codicon, { name: 'rocket', size: '0.85rem', className: 'text-(--ui-purple)' }),
          jsx('span', { className: 'font-medium text-(--ui-text-primary)', children: 'swarm cockpit' }),
          jsx('span', { className: 'text-[0.68rem] text-(--ui-text-tertiary)', children: `${tally.live} live · ${tally.total} tracked` }),
        ],
      }),
      jsxs('div', {
        className: 'flex items-center gap-1.5 text-[0.68rem] text-(--ui-text-quaternary)',
        children: [
          jsx('span', {
            className: 'min-w-0 flex-1 truncate',
            children: sessionId ? `session ${String(sessionId).slice(0, 12)} · ${updated}` : 'no session',
          }),
          jsx(Button, {
            variant: 'text',
            size: 'micro',
            disabled: !connected || !sessionId,
            onClick: () => {
              haptic('tap')
              void feed.refresh()
            },
            children: 'refresh',
          }),
        ],
      }),
      body,
    ],
  })
}

/* ------------------------------------------------------------------ status bar chip */

function CockpitChip() {
  const sessionId = useRuntimeSessionId()
  const gateway = useGatewayState()
  const connected = gateway === 'open'
  const feed = useSubagentFeed(sessionId, connected, CHIP_POLL_MS)

  // The status bar is always mounted, so the chip polls on a slower cadence than
  // the pane and never touches the transcript.
  const tally = useMemo(() => counts(feed.rows), [feed.rows])
  const live = tally.live

  const label = !connected ? '—' : !sessionId ? 'no session' : chipLabel(tally)

  return jsx('button', {
    type: 'button',
    title: chipTitle(tally, sessionId, gateway),
    className: 'flex items-center gap-1 px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)',
    onClick: () => {
      haptic('tap')

      if (typeof host.revealPane === 'function') {
        host.revealPane(PANE_ID)
      }
    },
    children: jsxs('span', {
      className: 'flex items-center gap-1',
      children: [
        jsx('span', {
          className: 'h-1.5 w-1.5 rounded-full',
          style: { background: live > 0 ? 'var(--ui-purple)' : 'var(--ui-text-quaternary)' },
        }),
        jsx('span', { children: `swarm ${label}` }),
      ],
    }),
  })
}

/* ------------------------------------------------------------------ register */

/** Wire the gateway's subagent frames as a refresh accelerator (best-effort). */
function wireGatewayEvents(ctx) {
  if (typeof ctx.onEvent !== 'function') {
    return
  }

  for (const type of EVENT_TYPES) {
    try {
      ctx.onEvent(type, () => scheduleEventRefresh())
    } catch {
      // Older desktop build without the event door: the poll still covers it.
    }
  }
}

export default {
  id: ID,
  name: 'Swarm Cockpit',
  description: 'Live subagent tree for the focused session: status, age, tail, steer and interrupt.',
  register(ctx) {
    ctx.register({
      id: 'pane',
      area: PANES_AREA,
      title: 'swarm',
      data: { placement: 'right', width: '340px' },
      render: () => jsx(CockpitPane, {}),
    })

    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      order: 118,
      render: () => jsx(CockpitChip, {}),
    })

    ctx.register({
      id: 'reveal',
      area: PALETTE_AREA,
      data: {
        id: 'swarm-cockpit.reveal',
        label: 'Swarm Cockpit: Reveal',
        keywords: ['subagent', 'delegate', 'swarm', 'cockpit', 'tree', 'worker'],
        run: () => {
          if (typeof host.revealPane === 'function') {
            host.revealPane(PANE_ID)
          }
        },
      },
    })

    wireGatewayEvents(ctx)
  },
}
