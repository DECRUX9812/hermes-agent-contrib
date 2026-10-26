// attention-radar — surface the sessions that actually need YOU, ranked.
//
// WHY THIS IS NOT A DUPLICATE OF WHAT EXISTS:
// The fork already has an attention-inbox (app/attention-inbox/index.tsx) and the
// catalog already has swarms of dashboards. Neither answers the question this
// plugin answers: "out of everything that happened today, what is the SHORTEST
// list of things only a human can unblock?" Every existing surface lists by
// arrival or by owner. This ranks by blocking-severity and groups by owner, so
// the answer is "these 3, this order" — not "these 47, newest first".
//
// DATA PATH — every source here is a documented SDK read, no Python backend:
//   host.state.attentionItems      — the live inbox (approvals, clarify, errors,
//                                    secrets, sudo, vault) — authoritative, and
//                                    already deduped by core per (session,title,message).
//   host.state.attentionCountsByOwner — per-owner rollup for the badge.
//   host.sessions.openSession(id)  — the ONE door that opens a stored session;
//                                    there is no top-level openSession export, and a
//                                    bad name here is a silent render-time failure.
//   host.profiles.list             — READ-ONLY; there is no profile-switch door,
//                                    so this never attempts one.
// No REST, no socket: nothing here can fail on a remote/OAuth connection.
//
// Only @hermes/plugin-sdk, react and react/jsx-runtime resolve. Uncompiled:
// jsx() calls, never JSX syntax. jsx comes from react/jsx-runtime, NOT the SDK
// barrel — importing it from the SDK is a render-time ReferenceError, not a load
// error, so the surface would silently never appear.

import {
  PALETTE_AREA,
  STATUSBAR_AREAS,
  PANES_AREA,
  host,
  useValue,
} from '@hermes/plugin-sdk'
import { jsx } from 'react/jsx-runtime'

const PANE_ID = 'attention-radar'
const SEV = {
  // Order IS the rank. A human unblocks these in sequence; nothing below an
  // error can outrank one, because an error is the only kind that is terminal.
  sudo: 5,
  secret: 5,
  vault: 4,
  approval: 4,
  clarify: 3,
  error: 6,
}
const LABEL = {
  sudo: 'sudo',
  secret: 'secret',
  vault: 'vault',
  approval: 'approval',
  clarify: 'question',
  error: 'error',
}

/** Pure: rank items by severity, then by recency of id for a stable order. */
export function rank(items) {
  if (!Array.isArray(items)) return []
  return items
    .filter((i) => i && i.kind && SEV[i.kind] != null)
    .map((i, idx) => ({ item: i, sev: SEV[i.kind], idx }))
    .sort((a, b) => (b.sev - a.sev) || (a.idx - b.idx))
    .map((x) => x.item)
}

/** Pure: group ranked items by owning session, preserving rank order. */
export function bySession(ranked) {
  const out = new Map()
  for (const i of ranked) {
    const key = i.sessionId || '__app__'
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(i)
  }
  return out
}

/** Pure: the one-line summary a user reads before deciding where to look. */
export function headline(items) {
  const n = rank(items).length
  if (!n) return 'All clear'
  const blocking = rank(items).filter((i) => SEV[i.kind] >= 4).length
  if (!blocking) return n + (n === 1 ? ' question' : ' questions')
  return blocking + ' blocking · ' + n + ' total'
}

function severityColor(kind) {
  if (kind === 'error') return 'var(--ui-text-danger, #fb4a6a)'
  if (SEV[kind] >= 4) return 'var(--ui-text-warning, #fbbf24)'
  return 'var(--ui-text-tertiary)'
}

const s = {
  wrap: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px', height: '100%', overflow: 'auto' },
  head: { display: 'flex', alignItems: 'baseline', gap: '8px' },
  h: { margin: '0', fontSize: '13px', fontWeight: '600', color: 'var(--ui-text-primary)' },
  sub: { margin: '0', fontSize: '11px', color: 'var(--ui-text-tertiary)' },
  group: { marginTop: '4px' },
  gname: { fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--ui-text-tertiary)', margin: '0 0 4px' },
  row: {
    display: 'flex', gap: '8px', alignItems: 'flex-start', width: '100%',
    padding: '7px 8px', borderRadius: '8px', border: '1px solid var(--ui-stroke-secondary)',
    background: 'var(--chrome-action-hover)', cursor: 'pointer', textAlign: 'left',
    font: 'inherit', color: 'inherit',
  },
  badge: { fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap', paddingTop: '1px' },
  title: { fontSize: '12px', color: 'var(--ui-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  detail: { fontSize: '11px', color: 'var(--ui-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  empty: { fontSize: '12px', color: 'var(--ui-text-tertiary)', padding: '6px 0' },
}

function Row({ item }) {
  return jsx(
    'button',
    {
      type: 'button',
      style: s.row,
      title: item.title + (item.detail ? ' — ' + item.detail : ''),
      onClick: () => { if (item.sessionId) host.sessions.openSession(item.sessionId) },
    },
    jsx('span', { style: { ...s.badge, color: severityColor(item.kind) } }, LABEL[item.kind] || item.kind),
    jsx('span', { style: { minWidth: '0', display: 'flex', flexDirection: 'column' } },
      jsx('span', { style: s.title }, item.title),
      item.detail ? jsx('span', { style: s.detail }, item.detail) : null),
  )
}

function Radar() {
  const items = useValue(host.state.attentionItems)
  const ranked = rank(items)
  const groups = bySession(ranked)
  if (!ranked.length) {
    return jsx('div', { style: s.wrap },
      jsx('div', { style: s.head },
        jsx('h3', { style: s.h }, 'Attention Radar'),
        jsx('p', { style: s.sub }, 'All clear')),
      jsx('p', { style: s.empty }, 'Nothing is waiting on a human right now.'))
  }
  return jsx('div', { style: s.wrap },
    jsx('div', { style: s.head },
      jsx('h3', { style: s.h }, 'Attention Radar'),
      jsx('p', { style: s.sub }, headline(items))),
    Array.from(groups.entries()).map(([sessionId, rows]) =>
      jsx('div', { key: sessionId, style: s.group },
        jsx('p', { style: s.gname }, sessionId === '__app__' ? 'App-level' : 'Session'),
        rows.map((i) => jsx(Row, { key: i.id, item: i }))))
  )
}

function Chip() {
  const items = useValue(host.state.attentionItems)
  const blocking = rank(items).filter((i) => SEV[i.kind] >= 4).length
  if (!blocking) return null
  return jsx('span', {
    title: blocking + ' item(s) need you',
    style: { fontSize: '11px', color: 'var(--ui-text-warning, #fbbf24)', whiteSpace: 'nowrap' },
  }, '⚠ ' + blocking)
}

export default {
  id: 'attention-radar',
  name: 'Attention Radar',
  description: 'Ranks blocked sessions by what only you can unblock.',
  version: '1.0.0',
  defaultEnabled: false,

  register(ctx) {
    ctx.contribution(PANES_AREA, {
      id: PANE_ID,
      placement: 'right',
      title: 'Attention',
      render: () => jsx(Radar, null),
    })
    ctx.contribution(STATUSBAR_AREAS.right, {
      id: 'attention-radar.chip',
      render: () => jsx(Chip, null),
    })
    ctx.contribution(PALETTE_AREA, {
      id: 'attention-radar.open',
      label: 'Attention Radar',
      keywords: ['attention', 'blocked', 'approval', 'waiting', 'needs you'],
      // items() is a FUNCTION re-read on every palette open — never a snapshot.
      items: () => rank(host.state.attentionItems.get()).slice(0, 20).map((i) => ({
        label: (LABEL[i.kind] || i.kind) + ': ' + i.title,
        detail: i.detail,
        run: () => { if (i.sessionId) host.sessions.openSession(i.sessionId) },
      })),
    })
  },
}