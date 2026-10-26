/**
 * Machine Mesh — one ops screen for this machine and its network.
 *
 * Two lists that usually live in two different places:
 *
 *   NODES     this host (hostname, arch, kernel, uptime, primary IPs) and the Tailscale
 *             peers, read from `tailscale status --json` by the backend.
 *   SERVICES  the Hermes stack's listening daemons — 9119, 8899, 8790, 8791, 8890, 8085 —
 *             each probed for real: a TCP connect, an HTTP status code where the port speaks
 *             HTTP, and the systemd --user unit that actually owns the process on that port.
 *
 * Nothing on this screen is inferred. The backend probes loopback first, then the tailnet
 * address, then the LAN address, and every row shows WHERE it answered (`probe_host`), so a
 * service that is up on the tailnet but not on loopback says so instead of lying.
 *
 * Honest states, not spinners:
 *   - 404 from ctx.rest  → "backend not mounted yet" (the plugin is installed, the API is not)
 *   - any other error    → the real message, per section, so one broken half does not hide
 *                          the other
 *   - no tailscale CLI   → "tailscale: <reason> — showing this host only", with this host
 *                          still rendered. Never invented peers.
 *
 * Surfaces:
 *   - Right-rail pane  ('panes' → 'mesh-pane', placement right, 340px)
 *   - Status-bar chip  (STATUSBAR_AREAS.right → 'mesh 6/6')
 *   - Command palette  (PALETTE_AREA → refresh now)
 */

import { host, PALETTE_AREA, STATUSBAR_AREAS, queryClient, useQuery, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback } from 'react'

const ID = 'machine-mesh'
const PANE_ID = `${ID}:pane`
const REFRESH_MS = 15000      // pane, while it is on screen
const CHIP_REFRESH_MS = 60000 // chip, when the pane is not: the backend probes sockets
const QUERY_KEY = ['machine-mesh']

// ctx.rest is captured at register-time (same pattern as jev-gate).
let ctxRest = async () => {
  throw new Error('machine-mesh: not registered yet')
}

/* ------------------------------------------------------------------ pure helpers */
/* Everything below is pure: no SDK identifiers, no I/O — the vm tests drive it directly. */

/** 22596.94 -> "6h 16m". Unusable input -> "—", never a made-up duration. */
function fmtUptime(seconds) {
  if (seconds == null || seconds === '') return '—' // "no uptime" is not "0s"
  const s = Number(seconds)
  if (!Number.isFinite(s) || s < 0) return '—'
  if (s < 60) return `${Math.floor(s)}s`
  const minutes = Math.floor(s / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

/** Go zero-times mean "never" — not a date in the year 1. */
function isZeroTime(iso) {
  return typeof iso === 'string' && iso.startsWith('0001-01-01')
}

/** ISO -> "11h ago". null when there is no honest answer. `now` is injectable for tests. */
function relTime(iso, now) {
  if (!iso || isZeroTime(iso)) return null
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  const ref = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  const s = Math.max(0, (ref - then) / 1000)
  if (s < 45) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 172800) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

/** One line of truth per node. */
function nodeStatus(node) {
  if (!node) return 'unknown'
  if (node.kind === 'self') return `this host · up ${fmtUptime(node.uptime_s)}`
  if (node.online) return node.active ? 'online · active' : 'online'
  const seen = relTime(node.last_seen) || relTime(node.last_handshake)
  return seen ? `last seen ${seen}` : 'offline · never seen'
}

function nodeDot(node) {
  if (!node) return 'unknown'
  if (node.kind === 'self') return 'up'
  return node.online === true ? 'up' : 'down'
}

/** "active · http 302 · not listening" — only the parts we actually have. */
function svcStatus(service) {
  if (!service) return 'unknown'
  const bits = []
  if (service.unit_state) bits.push(service.unit_state)
  if (service.http_code != null) bits.push(`http ${service.http_code}`)
  else if (service.http_probed && service.tcp) bits.push('http —')
  if (service.tcp && !service.unit) bits.push('no unit')
  if (!service.tcp) bits.unshift('not listening')
  return bits.join(' · ') || 'unknown'
}

function svcDot(service) {
  if (!service) return 'unknown'
  return service.tcp === true ? 'up' : 'down'
}

/** "mesh 6/6" for the status bar; "mesh —" until real numbers exist. */
function meshSummary(services) {
  const list = Array.isArray(services) ? services.filter(Boolean) : []
  const up = list.filter((s) => s.tcp === true).length
  return { up, down: list.length - up, total: list.length, label: list.length ? `mesh ${up}/${list.length}` : 'mesh —' }
}

function countOnline(nodes) {
  const list = Array.isArray(nodes) ? nodes.filter(Boolean) : []
  return { online: list.filter((n) => n.online === true).length, total: list.length }
}

/** A 404 means the backend is not mounted — a different problem from "unreachable". */
function isNotMounted(err) {
  if (!err) return false
  const status = err.status ?? err.statusCode ?? (err.response && err.response.status)
  if (status === 404) return true
  return /404|not found|not mounted/i.test(String((err && err.message) || err))
}

function errText(err) {
  const raw = (err && (err.message || err.error)) || err || 'unknown error'
  return String(raw).slice(0, 200)
}

/* ------------------------------------------------------------------ pane visibility */

// Mirrors host.paneVisibility(PANE_ID); wired in register(). Older desktops get an
// always-visible stand-in so hook order and behaviour stay identical.
let $paneVisible = null

function paneVisibleAtom() {
  if ($paneVisible) return $paneVisible
  try {
    if (host && typeof host.paneVisibility === 'function') {
      $paneVisible = host.paneVisibility(PANE_ID)
      return $paneVisible
    }
  } catch {
    /* fall through to the stand-in */
  }
  $paneVisible = { get: () => true, subscribe: () => () => {} }
  return $paneVisible
}

/* ------------------------------------------------------------------ queries */

function useNodesQuery(visible, interval = REFRESH_MS) {
  return useQuery({
    queryKey: [...QUERY_KEY, 'nodes'],
    queryFn: () => ctxRest('/nodes', { timeoutMs: 8000 }),
    enabled: visible !== false,
    refetchInterval: visible === false ? false : interval,
    refetchIntervalInBackground: false,
    retry: false,
  })
}

function useServicesQuery(visible, interval = REFRESH_MS) {
  return useQuery({
    queryKey: [...QUERY_KEY, 'services'],
    queryFn: () => ctxRest('/services', { timeoutMs: 12000 }),
    enabled: visible !== false,
    refetchInterval: visible === false ? false : interval,
    refetchIntervalInBackground: false,
    retry: false,
  })
}

function useRefresh() {
  return useCallback(() => {
    try {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    } catch {
      /* an older SDK without queryClient: the 15 s poll still refreshes */
    }
  }, [])
}

/* ------------------------------------------------------------------ primitives */

function Dot({ tone = 'unknown' }) {
  const toneClass =
    tone === 'up' ? 'text-emerald-500' : tone === 'down' ? 'text-rose-500' : 'text-[var(--muted-foreground)]'
  return jsx('svg', {
    width: 8,
    height: 8,
    viewBox: '0 0 8 8',
    className: `shrink-0 ${toneClass}`,
    'aria-hidden': 'true',
    children: jsx('circle', { cx: 4, cy: 4, r: 2.4, stroke: 'currentColor', strokeWidth: 2.4, fill: 'none' }),
  })
}

function MeshGlyph() {
  return jsx('svg', {
    width: 11,
    height: 11,
    viewBox: '0 0 16 16',
    className: 'shrink-0',
    'aria-hidden': 'true',
    children: jsx('path', {
      d: 'M1.5 8h3l1.6-4.2 2.2 8.4L10.2 8h4.3',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      fill: 'none',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  })
}

function SectionHead({ title, right }) {
  return jsxs('div', {
    className: 'flex items-baseline justify-between gap-2',
    children: [
      jsx('div', { className: 'text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]', children: title }),
      jsx('div', { className: 'shrink-0 text-[10px] tabular-nums text-[var(--muted-foreground)]', children: right }),
    ],
  })
}

function ErrorBox({ err, what }) {
  const missing = isNotMounted(err)
  return jsxs('div', {
    className: 'rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-500',
    children: [
      jsx('div', { className: 'font-semibold', children: missing ? 'backend not mounted yet' : `${what} unreachable` }),
      jsx('div', {
        className: 'mt-0.5 text-[10px] leading-snug',
        children: missing
          ? 'machine-mesh is not serving /api/plugins/machine-mesh on this Hermes, so there is nothing real to show.'
          : errText(err),
      }),
    ],
  })
}

function Note({ children }) {
  return jsx('div', {
    className: 'rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] leading-snug text-amber-500',
    children,
  })
}

/* ------------------------------------------------------------------ rows */

function NodeRow({ node, index }) {
  const detail = [node.ipv4 || (node.ips && node.ips[0]) || null, node.arch ? `${node.arch} · ${node.kernel}` : null]
    .filter(Boolean)
    .join('   ·   ')
  return jsxs('div', {
    className: 'flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)]/50 px-2.5 py-1.5',
    children: [
      jsx('div', { className: 'mt-[5px]', children: jsx(Dot, { tone: nodeDot(node) }) }),
      jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsxs('div', {
            className: 'flex items-baseline gap-1.5',
            children: [
              jsx('div', { className: 'truncate text-[12px] leading-snug text-[var(--foreground)]', children: node.name }),
              node.kind === 'self'
                ? jsx('span', { className: 'shrink-0 text-[9px] uppercase tracking-wider text-[var(--muted-foreground)]', children: 'this host' })
                : null,
              jsx('div', { className: 'ml-auto shrink-0 text-[9px] uppercase tracking-wider text-[var(--muted-foreground)]', children: node.os || 'unknown' }),
            ],
          }),
          jsx('div', { className: 'truncate text-[10px] text-[var(--muted-foreground)]', children: nodeStatus(node) }),
          detail ? jsx('div', { className: 'truncate font-mono text-[9.5px] text-[var(--muted-foreground)]', children: detail }) : null,
        ],
      }),
    ],
  })
}

function ServiceRow({ service }) {
  return jsxs('div', {
    className: 'flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)]/50 px-2.5 py-1.5',
    children: [
      jsx('div', { className: 'mt-[5px]', children: jsx(Dot, { tone: svcDot(service) }) }),
      jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsxs('div', {
            className: 'flex items-baseline gap-1.5',
            children: [
              jsx('div', { className: 'truncate text-[12px] leading-snug text-[var(--foreground)]', children: service.name }),
              jsx('div', { className: 'ml-auto shrink-0 font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]', children: `:${service.port}` }),
            ],
          }),
          jsx('div', { className: 'truncate text-[10px] text-[var(--muted-foreground)]', children: svcStatus(service) }),
          service.unit || service.probe_host
            ? jsx('div', {
                className: 'truncate font-mono text-[9.5px] text-[var(--muted-foreground)]',
                children: [service.unit || 'no unit', service.probe_host || null].filter(Boolean).join('   ·   '),
              })
            : null,
        ],
      }),
    ],
  })
}

/* ------------------------------------------------------------------ sections */

function NodesSection({ query }) {
  const data = query.data
  const err = query.error || (data && data.ok === false ? new Error(data.error || 'backend reported failure') : null)
  const nodes = (data && data.nodes) || []
  const tailscale = (data && data.tailscale) || null
  const counts = countOnline(nodes)
  const right = err ? 'error' : nodes.length ? `${counts.online}/${counts.total} online` : query.isLoading ? 'reading…' : 'no data'

  return jsxs('div', {
    className: 'space-y-1.5',
    children: [
      jsx(SectionHead, { title: 'Nodes', right }),
      err ? jsx(ErrorBox, { err, what: 'nodes' }) : null,
      !err && tailscale && tailscale.available === false
        ? jsx(Note, { children: `tailscale: ${tailscale.reason} — showing this host only` })
        : null,
      ...nodes.map((node, i) => jsx(NodeRow, { key: `${node.kind}-${node.name}-${i}`, node, index: i })),
      !err && !nodes.length && !query.isLoading
        ? jsx('div', { className: 'text-[10.5px] text-[var(--muted-foreground)]', children: 'no nodes reported' })
        : null,
    ],
  })
}

function ServicesSection({ query }) {
  const data = query.data
  const err = query.error || (data && data.ok === false ? new Error(data.error || 'backend reported failure') : null)
  const services = (data && data.services) || []
  const summary = meshSummary(services)
  const hosts = (data && data.probe_hosts) || []
  const right = err
    ? 'error'
    : services.length
      ? `${summary.up}/${summary.total} up`
      : query.isLoading
        ? 'probing…'
        : 'no data'

  return jsxs('div', {
    className: 'space-y-1.5',
    children: [
      jsx(SectionHead, { title: 'Services', right }),
      err ? jsx(ErrorBox, { err, what: 'services' }) : null,
      !err && services.length
        ? jsx('div', {
            className: 'text-[9.5px] text-[var(--muted-foreground)]',
            children: `probed live: ${hosts.join(' → ') || 'loopback'}${data && data.generated_at ? ` · ${data.generated_at.slice(11, 19)}` : ''}`,
          })
        : null,
      ...services.map((service) => jsx(ServiceRow, { key: `${service.name}:${service.port}`, service })),
      !err && !services.length && !query.isLoading
        ? jsx('div', { className: 'text-[10.5px] text-[var(--muted-foreground)]', children: 'no services in the allowlist responded to the probe' })
        : null,
    ],
  })
}

/* ------------------------------------------------------------------ pane */

function MeshPane() {
  const visible = useValue(paneVisibleAtom())
  const nodesQuery = useNodesQuery(visible)
  const servicesQuery = useServicesQuery(visible)
  const refresh = useRefresh()

  const hostData = (nodesQuery.data && nodesQuery.data.host) || null
  const tailscale = (nodesQuery.data && nodesQuery.data.tailscale) || null
  const summary = meshSummary(servicesQuery.data && servicesQuery.data.services)
  const busy = nodesQuery.isFetching || servicesQuery.isFetching

  const subtitle = hostData
    ? `${hostData.name} · ${hostData.arch || '?'} · ${hostData.kernel || '?'} · up ${fmtUptime(hostData.uptime_s)}`
    : nodesQuery.error
      ? 'no host data — see the nodes section'
      : 'reading this host…'

  const ipLine = hostData && hostData.ips && hostData.ips.length
    ? hostData.ips.filter((ip) => ip.indexOf(':') === -1).join(' · ')
    : tailscale && tailscale.self_ip
      ? tailscale.self_ip
      : ''

  return jsxs('div', {
    className: 'flex h-full w-full flex-col gap-2.5 overflow-y-auto bg-[var(--background)] px-3 py-2.5 text-[var(--foreground)]',
    children: [
      jsxs('div', {
        className: 'flex items-start justify-between gap-2 border-b border-[var(--border)] pb-2',
        children: [
          jsxs('div', {
            className: 'min-w-0',
            children: [
              jsx('div', { className: 'text-[12px] font-semibold uppercase tracking-[0.18em]', children: 'Machine Mesh' }),
              jsx('div', { className: 'truncate text-[10px] text-[var(--muted-foreground)]', children: subtitle }),
              ipLine
                ? jsx('div', { className: 'truncate font-mono text-[9.5px] text-[var(--muted-foreground)]', children: ipLine })
                : null,
            ],
          }),
          jsxs('div', {
            className: 'flex shrink-0 flex-col items-end gap-1',
            children: [
              jsx('button', {
                className: 'rounded border border-[var(--border)] px-2 py-[3px] text-[10px] text-[var(--foreground)] hover:border-[var(--foreground)]/40 disabled:opacity-40',
                disabled: busy,
                onClick: refresh,
                children: busy ? 'refreshing…' : 'refresh',
              }),
              jsx('div', {
                className: 'text-[9.5px] tabular-nums uppercase tracking-wider text-[var(--muted-foreground)]',
                children: summary.total ? summary.label : 'mesh —',
              }),
            ],
          }),
        ],
      }),
      jsx(NodesSection, { query: nodesQuery }),
      jsx(ServicesSection, { query: servicesQuery }),
      jsx('div', {
        className: 'mt-auto border-t border-[var(--border)] pt-2 text-[9.5px] leading-snug text-[var(--muted-foreground)]',
        children: 'read-only · TCP + HTTP status probes and the systemd --user unit that owns each port · auto-refresh 15s while this pane is open',
      }),
    ],
  })
}

function MeshChip() {
  const servicesQuery = useServicesQuery(true, CHIP_REFRESH_MS)
  const err = servicesQuery.error
  const summary = meshSummary(servicesQuery.data && servicesQuery.data.services)
  const tone = err ? 'text-rose-500' : summary.total && summary.down ? 'text-amber-500' : 'text-[var(--muted-foreground)]'
  return jsxs('div', {
    className: `flex items-center gap-1 text-[10.5px] ${tone}`,
    title: err
      ? `Machine Mesh — services unavailable: ${errText(err)}`
      : `Machine Mesh — ${summary.up}/${summary.total || '?'} allowlisted daemons answering`,
    children: [
      jsx(MeshGlyph, {}),
      jsx('span', { className: 'font-semibold uppercase tracking-wider tabular-nums', children: err ? 'mesh ?' : summary.label }),
    ],
  })
}

/* ------------------------------------------------------------------ registration */

export default {
  id: ID,
  name: 'Machine Mesh',
  description: 'This machine and its network: tailnet nodes and the Hermes stack’s listening daemons, with the systemd unit that owns each port.',
  register(ctx) {
    ctxRest = (path, opts) => ctx.rest(path, opts)
    paneVisibleAtom() // bind host.paneVisibility(PANE_ID) once, before the first render

    ctx.register({
      id: 'mesh-pane',
      area: 'panes',
      title: 'Machine Mesh',
      data: { placement: 'right', width: '340px' },
      render: () => jsx(MeshPane, {}),
    })

    ctx.register({
      id: 'mesh-chip',
      area: STATUSBAR_AREAS.right,
      order: 46,
      render: () => jsx(MeshChip, {}),
    })

    ctx.register({
      id: 'mesh-refresh',
      area: PALETTE_AREA,
      data: {
        id: 'machine-mesh.refresh',
        label: 'Machine Mesh: refresh nodes and services now',
        keywords: ['mesh', 'nodes', 'tailscale', 'peers', 'services', 'ports', 'systemd', 'machine', 'ops'],
        run: () => {
          try {
            queryClient.invalidateQueries({ queryKey: QUERY_KEY })
          } catch {
            /* older SDK: the poll covers it */
          }
        },
      },
    })
  },
}
