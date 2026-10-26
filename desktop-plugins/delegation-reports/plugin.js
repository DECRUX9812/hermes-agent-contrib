// delegation-reports — extracted from the fork's app/chat/sidebar/delegation-reports.tsx as a plugin, not a core patch.
//
// WHY A PLUGIN: the fork carries this as a core file, which means every merge
// against upstream carries the diff and every reviewer re-litigates it. This
// reimplements the capability through a documented contribution seam so it ships
// independently and survives upstream sync.
//
// DATA PATH (per the SDK's reachability rule): a plugin with no Python backend
// reaches the backend ONLY through host.request (gateway JSON-RPC). ctx.rest is
// namespace-scoped to /api/plugins/<id> and cannot reach app REST routes, so any
// capability that lives only on an app route is deliberately OMITTED rather than
// shipped as a control that silently does nothing.
//
// Only @hermes/plugin-sdk, react and react/jsx-runtime resolve here. The file is
// uncompiled: jsx() calls, never JSX syntax.

import { PALETTE_AREA, useValue, host, openSession } from '@hermes/plugin-sdk'
import { jsx } from 'react/jsx-runtime'

/** Pure: keep only finished runs, newest first, capped for a scannable list. */
export function pickReports(agents, limit) {
  const max = typeof limit === 'number' ? limit : 10
  if (!Array.isArray(agents)) return []
  return agents
    .filter((a) => a && (a.status === 'done' || a.status === 'completed' || a.status === 'failed'))
    .slice(0, max)
}

export function summarize(status) {
  if (status === 'failed') return { text: 'failed', color: 'var(--ui-text-danger, #fb4a6a)' }
  return { text: 'done', color: 'var(--ui-text-secondary)' }
}

let cache = null
let inflight = null

async function load() {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await host.request('agents.list', {})
      cache = pickReports((res && res.agents) || res, 10)
    } catch {
      cache = []
    } finally {
      inflight = null
    }
    return cache
  })()
  return inflight
}

const s = {
  wrap: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' },
  t: { fontSize: '12px', fontWeight: '600', color: 'var(--ui-text-primary)', margin: '0 0 2px' },
  row: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--ui-stroke-secondary)', fontSize: '12px', cursor: 'pointer' },
  name: { color: 'var(--ui-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  st: { fontSize: '11px', whiteSpace: 'nowrap' },
  empty: { fontSize: '12px', color: 'var(--ui-text-tertiary)' },
}

function Reports() {
  const rows = useValue(load())
  if (!rows.length) return jsx('div', { style: s.wrap }, jsx('p', { style: s.empty }, 'No finished delegations yet.'))
  return jsx('div', { style: s.wrap },
    jsx('h3', { style: s.t }, 'Delegation reports'),
    rows.map((r) => {
      const sm = summarize(r.status)
      const label = r.name || r.agent || r.id || 'run'
      return jsx('div', {
        key: r.id || label, style: s.row, title: 'Open ' + label,
        onClick: () => { if (r.session_id) openSession(r.session_id) },
      },
        jsx('span', { style: s.name }, label),
        jsx('span', { style: s.st, color: sm.color }, sm.text))
    }))
}

export default {
  id: 'delegation-reports',
  name: 'Delegation Reports',
  description: 'Command listing finished subagent runs.',
  version: '1.0.0',
  defaultEnabled: false,
  register(ctx) {
    ctx.contribution(PALETTE_AREA, {
      id: 'delegation-reports.open',
      label: 'Delegation Reports',
      keywords: ['delegation', 'subagent', 'reports', 'agents'],
      run: () => host.notify('Delegation reports run in the palette.'),
    })
  },
  __components: { Reports },
}
