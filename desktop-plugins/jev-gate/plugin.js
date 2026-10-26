/**
 * Jev Gate — Bot Mode's triage gate.
 *
 * Every fleet message gets one answer from a local 384-dimension head:
 *
 *     human  → it interrupts you
 *     work   → it needs an owner
 *     status → filed, nobody is paged
 *     noise  → dropped (heartbeats, boot notices, duplicate deliveries)
 *
 * Nothing here calls a model API. The gate scores a message in ~10 ms for $0.00, and the
 * operating point — how sure the gate must be before it interrupts you — is re-applied to
 * cached probabilities, so moving the slider re-partitions the feed without re-running
 * inference. The receipt strip at the bottom is the model's own holdout report card, read from
 * the training run that produced it: if it is wrong, the pane says so.
 *
 * Surfaces:
 *   - Right-rail pane  ('panes'        → 'gate-pane', placement right)
 *   - Full workspace   (ROUTES_AREA    → '/gate')
 *   - Statusbar chip   (STATUSBAR_AREAS.right)
 *   - Command palette  (PALETTE_AREA)
 */

import {
  host,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
  useQuery,
  useQueryClient,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useMemo, useState } from 'react'

const ID = 'jev-gate'
const KINDS = ['human', 'work', 'status', 'noise']
const FEED_LIMIT = 40

// ctx.rest is captured at register-time.
let ctxRest = async () => {
  throw new Error('jev-gate: not registered yet')
}

/* ------------------------------------------------------------------ vocabulary */

const LANE = {
  human: { label: 'NEEDS YOU', verb: 'interrupt', tone: 'text-rose-500', bg: 'bg-rose-500/10', ring: 'ring-rose-500/40' },
  work: { label: 'WORK', verb: 'assign an owner', tone: 'text-amber-500', bg: 'bg-amber-500/10', ring: 'ring-amber-500/35' },
  status: { label: 'STATUS', verb: 'file it', tone: 'text-sky-500', bg: 'bg-sky-500/10', ring: 'ring-sky-500/30' },
  noise: { label: 'NOISE', verb: 'drop it', tone: 'text-[var(--muted-foreground)]', bg: 'bg-[var(--accent)]/40', ring: 'ring-[var(--border)]' },
}

function money(n) {
  return `$${Number(n || 0).toFixed(4)}`
}

function ago(iso) {
  if (!iso) return 'never'
  const then = Date.parse(String(iso).replace(' ', 'T')) || Date.parse(iso)
  if (!then) return String(iso)
  const s = Math.max(0, (Date.now() - then) / 1000)
  if (s < 90) return `${Math.round(s)}s ago`
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 172800) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function pct(x) {
  return `${Math.round(Number(x || 0) * 100)}%`
}

/* ------------------------------------------------------------------ primitives */

function Chip({ children, tone = 'text-[var(--muted-foreground)]', className = '' }) {
  return jsx('span', {
    className: `inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wider ${tone} ${className}`,
    children,
  })
}

function Bar({ value, tone = 'bg-[var(--foreground)]' }) {
  return jsx('div', {
    className: 'h-[3px] w-full overflow-hidden rounded-full bg-[var(--border)]',
    children: jsx('div', {
      className: `h-full rounded-full ${tone}`,
      style: { width: `${Math.max(2, Math.min(100, Number(value || 0) * 100))}%` },
    }),
  })
}

function Meter({ probs, labels = KINDS }) {
  return jsx('div', {
    className: 'mt-1 flex h-[3px] w-full overflow-hidden rounded-full bg-[var(--border)]',
    children: labels.map((l) =>
      jsx('div', {
        key: l,
        className:
          l === 'human' ? 'bg-rose-500' : l === 'work' ? 'bg-amber-500' : l === 'status' ? 'bg-sky-500' : 'bg-[var(--muted-foreground)]/30',
        style: { width: `${(Number((probs || {})[l] || 0) * 100).toFixed(1)}%` },
      }),
    ),
  })
}

/* ------------------------------------------------------------------ data */

function useFeed(limit = FEED_LIMIT) {
  return useQuery({
    queryKey: ['jev-gate', 'feed', limit],
    queryFn: () => ctxRest(`/feed?limit=${limit}`, { timeoutMs: 40000 }),
    refetchInterval: 4000,
  })
}

function useMetrics() {
  return useQuery({
    queryKey: ['jev-gate', 'metrics'],
    queryFn: () => ctxRest('/metrics', { timeoutMs: 60000 }),
    refetchInterval: 30000,
  })
}

/** Re-decide the feed at a new operating point. Pure function of cached probabilities. */
function useRepointed(rows, floors) {
  const [out, setOut] = useState(null)
  const [ms, setMs] = useState(null)
  const rowsRef = rows
  useEffect(() => {
    let live = true
    if (!rowsRef || !rowsRef.length) {
      setOut(null)
      return () => {}
    }
    const payload = rowsRef
      .map((r) => ({ id: r.id, probabilities: (r.head || {}).probs || (r.head || {}).probabilities }))
      .filter((r) => r.probabilities)
    if (!payload.length) return () => {}
    ctxRest('/repoint', { method: 'POST', body: { rows: payload, floors }, timeoutMs: 15000 })
      .then((res) => {
        if (!live) return
        if (res && res.ok) {
          setOut(res.rows)
          setMs(res.ms)
        } else {
          setOut(null)
        }
      })
      .catch(() => live && setOut(null))
    return () => {
      live = false
    }
  }, [JSON.stringify(rowsRef?.map((r) => r.id)) + '|' + JSON.stringify(floors)])
  return { rows: out, ms }
}

/* ------------------------------------------------------------------ pieces */

function Row({ row, lane, floors, onHandled }) {
  const [open, setOpen] = useState(false)
  const meta = LANE[lane] || LANE.noise
  const conf = row.confidence != null ? row.confidence : (row.head || {}).confidence
  const typed = row.typed || {}
  return jsx('div', {
    className: `rounded-lg border border-[var(--border)] ${row.handled ? 'opacity-45' : ''} bg-[var(--card)]/60 px-2.5 py-2 transition-colors hover:border-[var(--foreground)]/20`,
    children: [
      jsx('div', {
        key: 'top',
        className: 'flex items-start gap-2',
        children: [
          jsx('button', {
            key: 't',
            className: 'flex-1 text-left text-[12.5px] leading-snug text-[var(--foreground)]',
            onClick: () => setOpen((v) => !v),
            children: row.text,
          }),
          jsx('div', {
            key: 'c',
            className: 'shrink-0 text-right',
            children: [
              jsx('div', { key: 'p', className: `text-[11px] font-semibold tabular-nums ${meta.tone}`, children: pct(conf) }),
              jsx('div', { key: 's', className: 'text-[9px] uppercase tracking-wider text-[var(--muted-foreground)]', children: row.src ? `${row.src}→${row.dst}` : '' }),
            ],
          }),
        ],
      }),
      jsx(Meter, { key: 'm', probs: (row.head || {}).probabilities || {} , labels: KINDS }),
      open &&
        jsxs('div', {
          key: 'open',
          className: 'mt-2 space-y-1 border-t border-[var(--border)] pt-2 text-[10.5px] text-[var(--muted-foreground)]',
          children: [
            jsx('div', { children: ['head ', jsx('b', { className: meta.tone, children: lane }), ` · ${pct(conf)} · floor applied live`] }),
            jsx('div', {
              children: typed.kind
                ? ['zero-shot typed question · ', jsx('b', { children: typed.kind }), ` ${pct(typed.confidence)} — no training, and it shows`]
                : 'zero-shot typed question · unavailable',
            }),
            jsx('div', {
              className: 'font-mono text-[10px]',
              children: KINDS.map((k) => `${k} ${pct(((row.head || {}).probabilities || {})[k])}`).join('   '),
            }),
            jsx('div', {
              className: 'flex gap-2 pt-1',
              children: [
                jsx('button', {
                  key: 'h',
                  className: 'rounded border border-[var(--border)] px-2 py-[3px] text-[10px] hover:border-[var(--foreground)]/40',
                  onClick: () => onHandled(row.id, !row.handled),
                  children: row.handled ? 'un-mark handled' : '✓ handled',
                }),
                jsx('button', {
                  key: 's',
                  className: 'rounded border border-[var(--border)] px-2 py-[3px] text-[10px] hover:border-[var(--foreground)]/40',
                  disabled: !host.openWorkspace,
                  onClick: () => host.openWorkspace?.('bots'),
                  children: 'send to a bot →',
                }),
              ],
            }),
          ],
        }),
    ],
  })
}

function Receipt({ metrics }) {
  const receipt = metrics?.receipt || {}
  // The backend hands the eval receipt through flat (accuracy / per_class / ece …); a nested
  // `holdout` block is also accepted so an older receipt shape still renders.
  const holdout = receipt.holdout || receipt.metrics?.holdout || (receipt.accuracy != null ? receipt : null)
  const zeroshot = metrics?.zeroshot || null
  const perClass = holdout?.per_class || holdout?.per_label || null
  const provenance = receipt.provenance?.receipt || {}
  const trainedRows = provenance?.rows?.total || receipt.provenance?.rows_in_corpus || null
  if (!receipt || !Object.keys(receipt).length) {
    return jsx('div', { className: 'text-[10.5px] text-[var(--muted-foreground)]', children: 'no receipt on disk — train once to produce one' })
  }
  return jsxs('div', {
    className: 'space-y-1.5',
    children: [
      jsxs('div', {
        className: 'flex items-baseline gap-2',
        children: [
          jsx('div', { className: 'text-[19px] font-semibold tabular-nums text-[var(--foreground)]', children: holdout?.accuracy != null ? pct(holdout.accuracy) : '—' }),
          jsx('div', { className: 'text-[10.5px] text-[var(--muted-foreground)]', children: `holdout accuracy · ${holdout?.n_usable ?? holdout?.rows ?? '?'} rows held out before training` }),
        ],
      }),
      perClass &&
        jsx('div', {
          className: 'flex flex-wrap gap-1.5',
          children: KINDS.filter((k) => perClass[k]).map((k) =>
            jsx(Chip, {
              key: k,
              tone: LANE[k].tone,
              className: LANE[k].bg,
              children: `${k} r=${(perClass[k].recall ?? perClass[k].r ?? 0).toFixed(2)} p=${(perClass[k].precision ?? perClass[k].p ?? 0).toFixed(2)}`,
            }),
          ),
        }),
      zeroshot &&
        jsx('div', {
          className: 'text-[10.5px] text-[var(--muted-foreground)]',
          children: [
            'same question, zero-shot typed criteria, no training: ',
            jsx('b', { className: 'text-[var(--foreground)]', children: zeroshot.accuracy != null ? pct(zeroshot.accuracy) : '—' }),
            ` on the same ${zeroshot.rows || '?'} rows`,
          ],
        }),
      jsx('div', {
        className: 'text-[10px] text-[var(--muted-foreground)]',
        children: [
          trainedRows ? `${trainedRows} labelled rows` : 'labelled rows ?',
          ` · ${receipt.metric_name || 'metric'} ${holdout?.accuracy != null ? holdout.accuracy.toFixed(3) : '—'}`,
          holdout?.ece != null ? ` · ECE ${holdout.ece.toFixed(3)}` : '',
          trainedRows ? ` · trained ${ago(provenance.trained_at || receipt.trained_at)}` : '',
          holdout?.abstained ? ` · ${holdout.abstained} abstained` : '',
        ],
      }),
    ],
  })
}

function Teach({ feed, onTrained }) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState('human')
  const [state, setState] = useState(null)
  const [corpus, setCorpus] = useState(null)

  useEffect(() => {
    ctxRest('/corpus', { timeoutMs: 15000 }).then((r) => r && r.ok && setCorpus(r.corpus)).catch(() => {})
  }, [])

  const add = useCallback(async () => {
    if (!text.trim()) return
    const res = await ctxRest('/label', { method: 'POST', body: { text: text.trim(), kind }, timeoutMs: 15000 })
    if (res && res.ok) {
      setCorpus(res.corpus)
      setText('')
      setState(`taught: "${res.added.text.slice(0, 42)}" → ${res.added.kind}`)
    } else {
      setState(res?.error || 'label failed')
    }
  }, [text, kind])

  const retrain = useCallback(async () => {
    setState('training…')
    await ctxRest('/train', { method: 'POST', body: {}, timeoutMs: 20000 })
    const poll = setInterval(async () => {
      const res = await ctxRest('/train', { timeoutMs: 20000 }).catch(() => null)
      if (!res || !res.ok) return
      if (res.training && res.training.running) return
      clearInterval(poll)
      setState(res.training?.returncode === 0 ? 'retrained — engine reloaded' : `training failed (rc ${res.training?.returncode})`)
      ctxRest('/metrics', { timeoutMs: 30000 }).then(() => onTrained && onTrained()).catch(() => {})
    }, 3000)
  }, [onTrained])

  const total = Object.values(corpus || {}).reduce((a, b) => a + b, 0)
  return jsxs('div', {
    className: 'space-y-2 rounded-lg border border-dashed border-[var(--border)] p-2.5',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsx('span', { className: 'text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]', children: 'teach the gate' }),
          jsx('span', { className: 'text-[10px] tabular-nums text-[var(--muted-foreground)]', children: `${total} labelled rows` }),
        ],
      }),
      jsx('div', {
        className: 'flex flex-wrap gap-1',
        children: KINDS.map((k) =>
          jsx('button', {
            key: k,
            onClick: () => setKind(k),
            className: `rounded px-2 py-[3px] text-[10px] font-semibold uppercase tracking-wide ${kind === k ? `${LANE[k].bg} ${LANE[k].tone} ring-1 ${LANE[k].ring}` : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`,
            children: k,
          }),
        ),
      }),
      jsx('textarea', {
        value: text,
        rows: 2,
        placeholder: 'paste a message this fleet really sends…',
        onChange: (e) => setText(e.target.value),
        className: 'w-full resize-none rounded border border-[var(--border)] bg-transparent px-2 py-1.5 text-[11.5px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--foreground)]/30',
      }),
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx('button', {
            className: 'rounded bg-[var(--foreground)] px-2.5 py-1 text-[11px] font-medium text-[var(--card)] disabled:opacity-40',
            disabled: !text.trim(),
            onClick: add,
            children: `label as ${kind}`,
          }),
          jsx('button', {
            className: 'rounded border border-[var(--border)] px-2.5 py-1 text-[11px] hover:border-[var(--foreground)]/40',
            onClick: retrain,
            children: 'retrain',
          }),
          jsx('span', { className: 'text-[10px] text-[var(--muted-foreground)]', children: '~2–4 min on CPU, in-process, no API' }),
        ],
      }),
      state && jsx('div', { className: 'text-[10.5px] text-[var(--muted-foreground)]', children: state }),
    ],
  })
}

/* ------------------------------------------------------------------ the gate */

function GateView({ compact = false }) {
  const qc = useQueryClient()
  const feed = useFeed(compact ? 24 : FEED_LIMIT)
  const metrics = useMetrics()
  const [floorHuman, setFloorHuman] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [lane, setLane] = useState('human')

  // Ship at the floor the model was actually fitted at (min-recall human), not a number the UI
  // made up — the slider then moves off it deliberately.
  const trainedFloor = metrics.data?.receipt?.thresholds_in_use?.human
  useEffect(() => {
    if (floorHuman == null && typeof trainedFloor === 'number') setFloorHuman(trainedFloor)
  }, [trainedFloor, floorHuman])

  const floors = useMemo(() => ({ human: floorHuman ?? 0.35 }), [floorHuman])

  const rows = feed.data?.rows || []
  const { rows: repointed, ms } = useRepointed(rows, floors)

  // The pane's decisions are the engine's decisions: repointed rows replace the head label,
  // never a client-side guess.
  const decided = useMemo(() => {
    if (!repointed) return rows.map((r) => ({ ...r, lane: (r.head || {}).kind, confidence: (r.head || {}).confidence }))
    const byId = new Map(repointed.map((r) => [r.id, r]))
    return rows.map((r) => {
      const rep = byId.get(r.id)
      if (!rep || !rep.kind) return { ...r, lane: null, confidence: null }
      return { ...r, lane: rep.kind, confidence: rep.confidence, probs: rep.probabilities }
    })
  }, [rows, repointed])

  const grouped = useMemo(() => {
    const g = { human: [], work: [], status: [], noise: [], unknown: [] }
    for (const r of decided) (g[r.lane] || g.unknown).push(r)
    return g
  }, [decided])

  const engine = feed.data?.counts ? 'warm' : 'parked'
  const msPerRow = feed.data?.ms_per_row
  const gated = decided.length
  const assumed = metrics.data?.assumed_api_call_usd || 0.0009

  const markHandled = useCallback(async (id, handled) => {
    await ctxRest('/handled', { method: 'POST', body: { id, undo: !handled }, timeoutMs: 15000 }).catch(() => {})
    qc.invalidateQueries({ queryKey: ['jev-gate'] })
  }, [qc])

  const receipt = metrics.data?.receipt || {}
  const holdout = receipt.holdout || {}

  return jsxs('div', {
    className: 'flex h-full w-full flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]',
    children: [
      /* header */
      jsxs('div', {
        key: 'hdr',
        className: 'flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2',
        children: [
          jsxs('div', {
            className: 'flex items-baseline gap-2',
            children: [
              jsx('div', { className: 'text-[12px] font-semibold uppercase tracking-[0.18em]', children: 'Jev Gate' }),
              jsx('div', { className: 'text-[10.5px] text-[var(--muted-foreground)]', children: 'bot mode triage · local · no API call per message' }),
            ],
          }),
          jsxs('div', {
            className: 'flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]',
            children: [
              jsx(Chip, { tone: engine === 'warm' ? 'text-emerald-500' : 'text-rose-500', children: `engine ${engine}` }),
              msPerRow != null ? jsx('span', { className: 'tabular-nums', children: `${msPerRow} ms/msg` }) : null,
              ms != null ? jsx('span', { className: 'tabular-nums', children: `re-gate ${ms} ms` }) : null,
            ],
          }),
        ],
      }),

      feed.isError || (feed.data && feed.data.ok === false)
        ? jsx('div', {
            key: 'err',
            className: 'm-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-[11.5px] text-rose-500',
            children: `engine unreachable: ${feed.error?.message || feed.data?.error} — the gate will not guess at traffic it cannot score.`,
          })
        : null,

      /* the interrupt band */
      jsxs('div', {
        key: 'band',
        className: 'border-b border-[var(--border)] px-3 py-2.5',
        children: [
          jsxs('div', {
            className: 'mb-2 flex items-center justify-between',
            children: [
              jsxs('div', {
                className: 'flex items-baseline gap-2',
                children: [
                  jsx('div', {
                    className: `text-[26px] font-semibold leading-none tabular-nums ${grouped.human.length ? 'text-rose-500' : 'text-[var(--muted-foreground)]'}`,
                    children: grouped.human.length,
                  }),
                  jsx('div', {
                    className: 'text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]',
                    children: grouped.human.length ? 'need you' : 'nothing needs you',
                  }),
                ],
              }),
              jsxs('div', {
                className: 'text-right text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]',
                children: [
                  jsx('div', { children: `${gated} messages gated` }),
                  jsx('div', {
                    className: 'tabular-nums',
                    children: `llm calls avoided ${gated} · ${money(gated * assumed)} at $${assumed}/msg assumed`,
                  }),
                ],
              }),
            ],
          }),
          jsxs('div', {
            className: 'space-y-1.5',
            children: (showAll ? grouped.human : []).map((r) => jsx(Row, { key: r.id, row: r, lane: 'human', floors, onHandled: markHandled })),
          }),
          jsx('div', {
            className: 'mt-2 flex items-center gap-3',
            children: [
              jsx('button', {
                className: 'text-[10.5px] text-[var(--muted-foreground)] underline decoration-dotted hover:text-[var(--foreground)]',
                onClick: () => setShowAll((v) => !v),
                children: showAll ? 'hide the interrupt list' : `show the ${grouped.human.length} interrupt${grouped.human.length === 1 ? '' : 's'}`,
              }),
              jsx('span', { className: 'text-[10px] text-[var(--muted-foreground)]', children: 'the fleet is filed, not forwarded — this pane never sends anything' }),
            ],
          }),
        ],
      }),

      /* lanes + operating point */
      jsxs('div', {
        key: 'body',
        className: 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2.5',
        children: [
          jsx('div', {
            className: 'flex gap-1.5',
            children: KINDS.map((k) =>
              jsxs('button', {
                key: k,
                onClick: () => setLane(k),
                className: `flex-1 rounded-lg border px-2 py-1.5 text-left transition-colors ${lane === k ? `${LANE[k].bg} border-transparent ring-1 ${LANE[k].ring}` : 'border-[var(--border)] hover:border-[var(--foreground)]/20'}`,
                children: [
                  jsx('div', { key: 'n', className: `text-[16px] font-semibold leading-none tabular-nums ${lane === k ? LANE[k].tone : 'text-[var(--foreground)]'}`, children: grouped[k].length }),
                  jsx('div', { key: 'l', className: 'mt-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]', children: LANE[k].label }),
                ],
              }),
            ),
          }),

          jsxs('div', {
            className: 'rounded-lg border border-[var(--border)] px-2.5 py-2',
            children: [
              jsxs('div', {
                className: 'flex items-center justify-between text-[10.5px]',
                children: [
                  jsx('span', { className: 'uppercase tracking-wider text-[var(--muted-foreground)]', children: 'gate — how wrong a miss may be' }),
                  jsx('span', { className: 'tabular-nums text-[var(--foreground)]', children: `P(human) ≥ ${(floorHuman ?? 0.35).toFixed(2)}` }),
                ],
              }),
              jsx('input', {
                type: 'range',
                min: 0.02,
                max: 0.9,
                step: 0.01,
                value: floorHuman ?? 0.35,
                onChange: (e) => setFloorHuman(Number(e.target.value)),
                className: 'mt-1.5 w-full accent-rose-500',
              }),
              jsxs('div', {
                className: 'flex justify-between text-[9.5px] uppercase tracking-wider text-[var(--muted-foreground)]',
                children: [
                  jsx('span', { children: '← louder (miss nothing)' }),
                  jsx('span', { children: 'quieter (fewer pages) →' }),
                ],
              }),
              jsx('div', {
                className: 'mt-1.5 text-[10px] text-[var(--muted-foreground)]',
                children: 're-partitions the feed from cached probabilities — same model, no re-run, no API call.',
              }),
            ],
          }),

          jsxs('div', {
            className: 'space-y-1.5',
            children: [
              jsxs('div', {
                className: 'flex items-baseline justify-between',
                children: [
                  jsx('div', { className: `text-[10px] font-semibold uppercase tracking-wider ${LANE[lane].tone}`, children: `${LANE[lane].label} · ${LANE[lane].verb}` }),
                  jsx('div', { className: 'text-[10px] text-[var(--muted-foreground)]', children: `${grouped[lane].length} shown` }),
                ],
              }),
              grouped[lane].length
                ? grouped[lane].map((r) => jsx(Row, { key: r.id, row: r, lane, floors, onHandled: markHandled }))
                : jsx('div', { className: 'rounded-lg border border-dashed border-[var(--border)] px-2.5 py-3 text-[11px] text-[var(--muted-foreground)]', children: 'nothing here at this operating point' }),
            ],
          }),
        ],
      }),

      /* receipt + teach */
      jsxs('div', {
        key: 'foot',
        className: 'border-t border-[var(--border)] px-3 py-2.5',
        children: [
          jsxs('div', {
            className: 'mb-2 flex items-center justify-between',
            children: [
              jsx('div', { className: 'text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]', children: 'receipt — the model’s own report card' }),
              jsx('div', { className: 'text-[10px] tabular-nums text-[var(--muted-foreground)]', children: `floors ${JSON.stringify(receipt.thresholds_in_use || receipt.thresholds || {})}` }),
            ],
          }),
          jsx(Receipt, { metrics: metrics.data }),
          !compact && jsx('div', { className: 'mt-2', children: jsx(Teach, { feed, onTrained: () => qc.invalidateQueries({ queryKey: ['jev-gate'] }) }) }),
        ],
      }),
    ],
  })
}

function GatePane() {
  return jsx('div', {
    className: 'h-full w-full overflow-y-auto bg-[var(--background)]',
    children: jsx(GateView, { compact: false }),
  })
}

function GatePage() {
  return jsx('div', {
    className: 'h-full w-full bg-[var(--background)]',
    children: jsx(GateView, { compact: false }),
  })
}

function GateChip() {
  const feed = useFeed(40)
  const rows = feed.data?.rows || []
  const waiting = rows.filter((r) => (r.head || {}).kind === 'human' && !r.handled).length
  return jsxs('div', {
    className: `flex items-center gap-1 text-[10.5px] ${waiting ? 'text-rose-500' : 'text-[var(--muted-foreground)]'}`,
    title: 'Jev Gate — messages waiting on you',
    children: [
      jsx('span', { className: 'font-semibold tabular-nums', children: waiting }),
      jsx('span', { className: 'uppercase tracking-wider', children: 'gate' }),
    ],
  })
}

/* ------------------------------------------------------------------ registration */

export default {
  id: ID,
  name: 'Jev Gate',
  register(ctx) {
    ctxRest = (path, opts) => ctx.rest(path, opts)

    ctx.register({
      id: 'gate-pane',
      area: 'panes',
      title: 'Jev Gate',
      data: { placement: 'right', width: '400px' },
      render: () => jsx(GatePane, {}),
    })

    ctx.register({
      id: 'gate-page',
      area: ROUTES_AREA,
      path: '/gate',
      title: 'Jev Gate',
      data: { path: '/gate' },
      render: () => jsx(GatePage, {}),
    })

    ctx.register({
      id: 'gate-nav',
      area: SIDEBAR_NAV_AREA,
      order: 47,
      path: '/gate',
      label: 'Gate',
      codicon: 'shield',
      data: { codicon: 'shield', label: 'Gate', path: '/gate' },
    })

    ctx.register({
      id: 'gate-chip',
      area: STATUSBAR_AREAS.right,
      order: 41,
      render: () => jsx(GateChip, {}),
    })

    ctx.register({
      id: 'gate-open',
      area: PALETTE_AREA,
      data: {
        id: 'jev-gate.open',
        label: 'Jev Gate: open the bot-mode triage gate',
        keywords: ['jev', 'gate', 'triage', 'fleet', 'bot', 'inbox', 'needs you', 'interrupt'],
        run: () => host.navigate && host.navigate('/gate'),
      },
    })
  },
}
