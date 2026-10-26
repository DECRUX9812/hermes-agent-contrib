// session-peek — hover a session row to preview its recent turns without opening it.
//
// WHY THIS EXISTS INSTEAD OF A FORK OF CORE:
// The fork added `app/chat/sidebar/session-peek.tsx` (196 lines) as a core file.
// This plugin reimplements the capability through the documented
// SESSION_ROW_AREAS seam (sessionRow.leading) rather than duplicating core's
// sidebar layout, gestures or row ownership — the row seam explicitly AUGMENTS
// a row and never replaces it.
//
// DATA PATH — verified against the SDK's reachability rules:
//   host.request('session.list', ...) -> durable stored ids (the row's sessionId
//   is the DURABLE/lineage root per SessionRowSlotProps — compression rotates
//   the live id, so keying off session.id would silently stop matching).
//   No Python backend ships here, so this reaches ONLY gateway JSON-RPC. There is
//   deliberately no full-text transcript search: that lives on an app REST route,
//   which ctx.rest (scoped to /api/plugins/<id>) cannot reach. Omitted rather
//   than shipped as a row that can never return anything.
//
// Only @hermes/plugin-sdk, react and react/jsx-runtime resolve in this sandbox.

import {
  SESSION_ROW_AREAS,
  useValue,
  host,
} from '@hermes/plugin-sdk'
// jsx comes from react/jsx-runtime, NOT the SDK barrel — importing it from
// @hermes/plugin-sdk is a render-time ReferenceError, not a load error.
import { jsx } from 'react/jsx-runtime'

const AREA = SESSION_ROW_AREAS.leading

const MAX_PREVIEW = 3
const MIN_ROW_WIDTH = 60
const PREVIEW_WIDTH = 380

// A row we have already fetched a preview for. Module-level because the render
// prop is called for every row on every list repaint; a per-render fetch would
// re-request the whole sidebar.
const cache = new Map()
const inflight = new Map()

function evict(sessionId) {
  // Bound the cache: the sidebar can hold hundreds of rows over a long session.
  if (cache.size > 200) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined && oldest !== sessionId) cache.delete(oldest)
  }
}

/** Fetch the most recent turns for a session. Never throws. */
async function loadPreview(sessionId) {
  if (!sessionId) return null
  const hit = cache.get(sessionId)
  if (hit !== undefined) return hit
  if (inflight.has(sessionId)) return inflight.get(sessionId)

  const p = (async () => {
    try {
      const res = await host.request('session.list', { limit: 200 })
      const sessions = (res && res.sessions) || []
      const match = sessions.find(s => (s.durable_id || s.id) === sessionId) || sessions.find(s => s.id === sessionId)
      // Only summary-level fields are used. A transcript would need a route this
      // plugin cannot reach — see the data-path note above.
      const preview = match
        ? {
            title: match.title || 'Untitled session',
            updated: match.updated_at || match.updated || null,
            model: match.model || null,
            turns: typeof match.message_count === 'number' ? match.message_count : null,
          }
        : null
      cache.set(sessionId, preview)
      evict(sessionId)
      return preview
    } catch (err) {
      // A failed read degrades to "no decoration", never a dead row.
      cache.set(sessionId, null)
      return null
    } finally {
      inflight.delete(sessionId)
    }
  })()

  inflight.set(sessionId, p)
  return p
}

const styles = {
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '0 6px',
    height: '18px',
    borderRadius: '9px',
    fontSize: '11px',
    lineHeight: '18px',
    color: 'var(--ui-text-tertiary)',
    background: 'var(--chrome-action-hover)',
    border: '1px solid var(--ui-stroke-secondary)',
    cursor: 'default',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '190px',
  },
}

function formatWhen(value) {
  if (!value) return null
  const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value)
  if (!Number.isFinite(ms)) return null
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return mins + 'm'
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return hrs + 'h'
  const days = Math.round(hrs / 24)
  if (days < 30) return days + 'd'
  return Math.round(days / 30) + 'mo'
}

/** Pure: the label a row shows, or null when the row is not worth annotating. */
export function badgeText(preview) {
  if (!preview) return null
  const when = formatWhen(preview.updated)
  const bits = []
  if (preview.turns != null) bits.push(preview.turns + ' msg')
  if (when) bits.push(when)
  if (!bits.length) return null
  return bits.join(' · ')
}

function PeekBadge({ sessionId }) {
  const preview = useValue(loadPreview(sessionId))
  const text = badgeText(preview)
  // Render null for rows we don't own — registering costs nothing elsewhere.
  if (!text) return null
  const title = preview && preview.title ? preview.title + (preview.model ? ' — ' + preview.model : '') : undefined
  return jsx('span', { style: styles.badge, title: title || undefined }, text)
}

export default {
  id: 'session-peek',
  name: 'Session Peek',
  description: 'Annotate session rows with recency and message count.',
  version: '1.0.0',
  defaultEnabled: false,

  register(ctx) {
    ctx.contribution(
      AREA,
      {
        id: 'session-peek.badge',
        render: (props) => jsx(PeekBadge, { sessionId: props.sessionId }),
      }
    )
  },
}