/**
 * Triage Lens — our own zero-setup duplicate radar for hermes-agent.
 *
 * No keys, no endpoints, no config. It talks straight to the public GitHub
 * search API (repo: NousResearch/hermes-agent), ranks open issues + PRs
 * against your description client-side, and tells you: proceed, claim, or
 * duplicate-of-#X. Results cache locally so repeat checks are instant and
 * kind to the rate limit.
 *
 * Agents get the same brain via the `triage-check` skill (gh CLI workflow).
 */

import {
  Badge,
  cn,
  haptic,
  host,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  Skeleton,
  Tip,
  useQueryClient,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState, useEffect } from 'react'

const ID = 'triage-lens'
const REPO = 'NousResearch/hermes-agent'
const API = 'https://api.github.com'
const PER_PAGE = 20
const ENRICH_TOP = 6

// in-memory cache: key -> { at, data }
const cache = new Map()
function cacheGet(k, ttlMs) {
  const e = cache.get(k)
  if (e && Date.now() - e.at < ttlMs) return e.data
  cache.delete(k)
  return null
}
function cacheSet(k, data) {
  if (cache.size > 60) cache.delete(cache.keys().next().value)
  cache.set(k, { at: Date.now(), data })
}

// --- query + ranking ---------------------------------------------------------
const STOP = new Set(('a,an,the,is,are,was,were,be,been,of,in,on,at,to,for,with,by,and,or,as,it,its,this,that,from,into,over,under,fix,fixes,fixed,bug,issue,error,when,while,please,help,how,what,why,do,does,did,not,no,yes,if,then,than,so,such,can,could,should,would,will,just,very,also,have,has,had,having,our,your,their,they,them,we,you,he,she,them,my,me,i,am,pm').split(','))
function keywords(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9_#.\s-]/g, ' ').split(/\s+/)
    .map(w => w.replace(/^#+/, ''))
    .filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).slice(0, 8)
}

async function gh(path) {
  const res = await fetch(API + path, { headers: { Accept: 'application/vnd.github+json' } })
  if (res.status === 403) {
    const reset = res.headers.get('x-ratelimit-reset')
    const wait = reset ? Math.max(1, Math.ceil(Number(reset) - Date.now() / 1000)) : 60
    throw new Error('GitHub rate limit hit (public API, no key). Wait ~' + wait + 's and retry — repeat checks come from cache.')
  }
  if (!res.ok) throw new Error('GitHub API ' + res.status)
  return res.json()
}

function scoreItem(item, toks, bodyText) {
  const title = (item.title || '').toLowerCase()
  const labels = (item.labels || []).map(l => (l.name || '').toLowerCase()).join(' ')
  const body = (bodyText || '').toLowerCase().slice(0, 4000)
  let s = 0
  for (const t of toks) {
    if (title.includes(t)) s += 3
    if (labels.includes(t)) s += 2
    if (body.includes(t)) s += 1
  }
  // exact-phrase bonus: half the title showing up verbatim
  if (toks.length >= 3 && title.includes(toks.slice(0, 3).join(' '))) s += 4
  return s
}

async function checkDuplicates(text) {
  const toks = keywords(text)
  if (!toks.length) throw new Error('Describe it with a few real words — e.g. "gateway anonymous ticket reuse crash".')
  // GitHub ANDs every term: a narrow query can return zero hits even when
  // matches exist. Broaden automatically: 8 → 5 → 3 keywords.
  const attempts = [toks, toks.slice(0, 5), toks.slice(0, 3)].filter((a, i, arr) =>
    a.length >= 2 && arr.findIndex(b => b.join(' ') === a.join(' ')) === i)
  let items = [], used = toks
  for (const a of attempts) {
    const q = encodeURIComponent('repo:' + REPO + ' ' + a.join(' ') + ' in:title,body')
    const ck = 'q:' + q
    let hits = cacheGet(ck, 5 * 60 * 1000)
    if (!hits) {
      const r = await gh('/search/issues?q=' + q + '&per_page=' + PER_PAGE + '&sort=updated&order=desc')
      hits = (r.items || []).filter(i => i.state === 'open')
      cacheSet(ck, hits)
    }
    if (hits.length) { items = hits; used = a; break }
    items = hits; used = a
  }
  const toksUsed = used
  // enrich top candidates with bodies for real scoring (cached per issue)
  const top = items.slice(0, ENRICH_TOP)
  const bodies = await Promise.all(top.map(async it => {
    const k = 'body:' + it.number
    let b = cacheGet(k, 30 * 60 * 1000)
    if (b == null) {
      try {
        const full = await gh('/repos/' + REPO + '/issues/' + it.number)
        b = full.body || ''
      } catch { b = '' }
      cacheSet(k, b)
    }
    return b
  }))
  const ranked = items.map((it, i) => ({
    number: it.number,
    title: it.title,
    url: it.html_url,
    isPR: !!it.pull_request,
    labels: (it.labels || []).map(l => l.name),
    comments: it.comments || 0,
    author: (it.user || {}).login || '?',
    created: it.created_at,
    score: scoreItem(it, toks, i < top.length ? bodies[i] : ''),
  })).sort((a, b) => b.score - a.score)
  return { toks, ranked }
}

function verdict(ranked) {
  const best = ranked[0]
  if (!best || best.score < 3) return { tone: 'low', label: 'Clear runway — no strong match', sub: 'Nothing open looks like this. Safe to file or fix.' }
  if (best.score >= 8 || (ranked[1] && ranked[1].score >= 6)) return { tone: 'high', label: 'Likely duplicate — read #' + best.number + ' first', sub: 'Strong overlap with open work. Claim it or comment instead of opening new.' }
  return { tone: 'med', label: 'Possible match — compare with #' + best.number, sub: 'Some overlap. Skim the top cards before you file.' }
}

// --- local classifier ----------------------------------------------------------
function classifyIssue(title, body) {
  const text = ((title || '') + '\n' + (body || '')).toLowerCase()
  const has = (...ws) => ws.some(w => text.includes(w))
  let type = 'bug'
  if (has('refactor', 'god-object', 'god file', 'extract', 'dependency knot', 'cleanup')) type = 'refactor'
  else if (has('feature', 'proposal', 'add support', 'wish', 'request')) type = 'feature'
  else if (has('doc', 'readme', 'typo', 'example')) type = 'docs'
  else if (has('question', 'how do i', 'help me')) type = 'question'
  let sev = 'p2'
  if (has('crash', 'data loss', 'security', 'rce', 'auth bypass', 'panic', 'corrupt')) sev = 'p0'
  else if (has('broken', 'fails', 'regression', 'not working', 'urgent')) sev = 'p1'
  else if (has('cosmetic', 'nit', 'polish', 'minor')) sev = 'p3'
  return { type, sev }
}

function age(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 864e5
  if (d < 1) return 'today'
  if (d < 30) return Math.floor(d) + 'd ago'
  if (d < 365) return Math.floor(d / 30) + 'mo ago'
  return Math.floor(d / 365) + 'y ago'
}

// --- contributor board --------------------------------------------------------
// Label-driven task discovery (newcomer / help-wanted / docs / quick-wins).
const BOARD_CHIPS = [
  { id: 'all', label: 'All', labels: [] },
  { id: 'newcomer', label: '🌱 Newcomer', labels: ['good first issue', 'up-for-grabs'] },
  { id: 'help', label: '🙋 Help wanted', labels: ['help wanted'] },
  { id: 'docs', label: '📝 Docs', labels: ['documentation'] },
  { id: 'quick', label: '⚡ Quick wins', labels: [], quickWins: true },
]

// Effort estimate (heuristic, never fact): docs/typo → XS, single-file/test → S,
// default → M, god-file/refactor/core/p0/3+files → L.
function estimateEffort(titleOrItem, body, labels) {
  let title = '', b = body || '', labelList = []
  if (titleOrItem && typeof titleOrItem === 'object') {
    title = titleOrItem.title || ''
    b = b || titleOrItem.body || ''
    labelList = (titleOrItem.labels || []).map(l => (typeof l === 'string' ? l : (l.name || '')))
  } else {
    title = titleOrItem || ''
    labelList = Array.isArray(labels) ? labels.map(l => (typeof l === 'string' ? l : (l.name || ''))) : []
  }
  const text = (title + ' ' + labelList.join(' ') + ' ' + b).toLowerCase()
  const has = (...ws) => ws.some(w => text.includes(w))
  const fileHints = (text.match(/[\w./-]+\.(?:js|ts|jsx|tsx|py|rs|go|json|md|ya?ml)\b/g) || []).length
  if (has('p0', 'god-file', 'god file', 'refactor', 'core') || fileHints >= 3) return 'L'
  if (has('doc', 'docs', 'readme', 'typo', 'documentation')) return 'XS'
  if (has('single-file', 'single file', 'test-only', 'test only', 'test', 'tests') || fileHints === 1) return 'S'
  return 'M'
}

async function fetchBoardIssues(chipId) {
  const chip = BOARD_CHIPS.find(c => c.id === chipId) || BOARD_CHIPS[0]
  const cacheKey = 'board:' + chip.id
  const cached = cacheGet(cacheKey, 5 * 60 * 1000)
  if (cached) return cached
  async function runLabelQuery(q) {
    const ck = 'label_q:' + q
    let hits = cacheGet(ck, 5 * 60 * 1000)
    if (!hits) {
      const res = await gh('/search/issues?q=' + q + '&per_page=' + PER_PAGE + '&sort=updated&order=desc')
      hits = (res.items || []).filter(i => i.state === 'open')
      cacheSet(ck, hits)
    }
    return hits
  }
  let rawItems = []
  if (chip.labels && chip.labels.length) {
    const lists = await Promise.all(chip.labels.map(label =>
      runLabelQuery(encodeURIComponent('repo:' + REPO + ' state:open label:"' + label + '"'))))
    const seen = new Set()
    for (const list of lists) for (const it of list) {
      if (!seen.has(it.number)) { seen.add(it.number); rawItems.push(it) }
    }
  } else {
    rawItems = await runLabelQuery(encodeURIComponent('repo:' + REPO + ' state:open'))
  }
  // Docs fallback: the repo has no 'documentation' label, but docs work is
  // textually identifiable — fall back to a title search instead of an
  // always-empty tab. (Newcomer/help stay purely label-driven: difficulty
  // can't be honestly guessed, so those show the empty state until
  // maintainers add the labels — the plugin lights up on its own then.)
  if (!rawItems.length && chip.id === 'docs') {
    const q = encodeURIComponent('repo:' + REPO + ' state:open (docs OR readme OR typo) in:title')
    rawItems = await runLabelQuery(q)
  }
  const top = rawItems.slice(0, ENRICH_TOP)
  const bodies = await Promise.all(top.map(async it => {
    if (it.body) return it.body
    const k = 'body:' + it.number
    let b = cacheGet(k, 30 * 60 * 1000)
    if (b == null) {
      try { const full = await gh('/repos/' + REPO + '/issues/' + it.number); b = full.body || '' }
      catch { b = '' }
      cacheSet(k, b)
    }
    return b
  }))
  const processed = rawItems.map((it, i) => {
    const body = i < top.length ? (bodies[i] || it.body || '') : (it.body || '')
    const labels = (it.labels || []).map(l => (typeof l === 'string' ? l : (l.name || '')))
    const cls = classifyIssue(it.title, body)
    return {
      number: it.number, title: it.title, url: it.html_url, isPR: Boolean(it.pull_request),
      labels, comments: it.comments || 0, author: (it.user && it.user.login) || '?',
      created: it.created_at, updated: it.updated_at || it.created_at,
      assignee: it.assignee, assignees: it.assignees, body,
      effort: estimateEffort(it.title, body, labels), type: cls.type, sev: cls.sev,
    }
  })
  processed.sort((a, b) => new Date(b.updated || b.created).getTime() - new Date(a.updated || a.created).getTime())
  const finalItems = chip.quickWins ? processed.filter(it => it.effort === 'XS' || it.effort === 'S') : processed
  cacheSet(cacheKey, finalItems)
  return finalItems
}

function getEmptyMessage(chipId) {
  switch (chipId) {
    case 'newcomer': return 'No Newcomer tasks right now — try All or Check.'
    case 'help': return 'No Help wanted tasks right now — try All or Check.'
    case 'docs': return 'No Docs tasks right now — try All or Check.'
    case 'quick': return 'No Quick wins right now — try All or Check.'
    default: return 'No open tasks right now — try Check.'
  }
}

function BoardCards({ items, onClaim, myClaims, emptyMsg }) {
  if (!items || !items.length) return jsx('div', { style: { ...S.sub, padding: '16px 0', textAlign: 'center' }, children: emptyMsg || 'No open tasks right now — try Check.' })
  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: items.slice(0, 12).map(it => {
    const mine = Boolean(myClaims && myClaims[it.number])
    const assigneeName = (it.assignee && it.assignee.login) || (it.assignees && it.assignees[0] && it.assignees[0].login)
    const assigneeState = mine ? 'claimed by you' : (assigneeName ? '@' + assigneeName : 'unassigned')
    return jsxs('div', { key: String(it.number), style: S.card, children: [
      jsxs('div', { style: S.row, children: [
        jsx('span', { style: { ...S.chip, fontWeight: 700, color: 'var(--ui-accent)', borderColor: 'var(--ui-accent)' }, children: '#' + it.number }),
        jsx('span', { style: { ...S.chip, background: 'var(--ui-stroke-secondary)' }, children: it.isPR ? 'PR' : 'ISSUE' }),
        jsx('span', { style: { ...S.chip, fontWeight: 600, color: 'var(--ui-accent)', borderColor: 'var(--ui-accent)' }, title: 'Estimated effort (heuristic)', children: '~' + (it.effort || 'M') }),
        it.type ? jsx('span', { style: S.chip, children: 'type: ' + it.type }) : null,
        it.sev ? jsx('span', { style: S.chip, children: it.sev }) : null,
      ] }),
      jsx('a', { style: S.cardT, href: it.url, target: '_blank', rel: 'noreferrer', children: it.title }),
      jsxs('div', { style: S.meta, children: [
        jsx('span', { children: '@' + it.author }),
        jsx('span', { children: age(it.created) }),
        jsx('span', { children: it.comments + ' comments' }),
        (it.labels || []).slice(0, 3).map(l => jsx('span', { key: l, style: S.chip, children: l })),
      ] }),
      jsxs('div', { style: { ...S.row, justifyContent: 'space-between', marginTop: 4 }, children: [
        jsxs('div', { style: S.meta, children: [
          jsx('span', { children: 'Assignee:' }),
          jsx('span', { style: { fontWeight: mine ? 700 : 400, color: mine ? 'var(--ui-accent)' : 'var(--ui-text-secondary)' }, children: assigneeState }),
        ] }),
        jsx('button', { type: 'button', style: { ...S.ghost, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }, onClick: () => { if (typeof onClaim === 'function') onClaim(it) }, children: mine ? 'Claimed' : 'Claim' }),
      ] }),
    ] })
  }) })
}

function BoardTab({ onClaim, myClaims }) {
  const [activeChip, setActiveChip] = useState('all')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    let cancel = false
    setLoading(true); setErr('')
    fetchBoardIssues(activeChip)
      .then(res => { if (!cancel) setItems(res) })
      .catch(e => { if (!cancel) setErr(String(e.message || e)) })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [activeChip])
  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 }, children: [
    jsxs('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }, children:
      BOARD_CHIPS.map(c => {
        const on = activeChip === c.id
        return jsx('button', { key: c.id, type: 'button',
          style: { border: on ? '1px solid var(--ui-accent)' : '1px solid var(--ui-stroke-secondary)', borderRadius: 999, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: on ? 700 : 400, background: on ? 'var(--ui-accent)' : 'transparent', color: on ? 'var(--foreground)' : 'var(--ui-text-secondary)' },
          onClick: () => { setActiveChip(c.id); if (typeof haptic === 'function') haptic('tap') }, children: c.label })
      }),
    }),
    err ? jsx('div', { style: { color: '#f87171', fontSize: 12 }, children: err }) : null,
    loading && !items.length ? jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [
      jsx(Skeleton, { style: { height: 72, borderRadius: 12 } }),
      jsx(Skeleton, { style: { height: 72, borderRadius: 12 } }),
      jsx(Skeleton, { style: { height: 72, borderRadius: 12 } }),
    ] }) : null,
    (!loading || items.length) ? jsx(BoardCards, { items, onClaim, myClaims, emptyMsg: getEmptyMessage(activeChip) }) : null,
  ] })
}

// --- claims store + mine ------------------------------------------------------
// Local records: { [issueNumber]: { at, expires, title, url } }. ctx.storage is
// injected at register(); without it everything falls back to memory.
let _claimsStorage = null
let _claimsMemory = {}
function initClaimsStore(storage) { _claimsStorage = storage || null }
async function loadClaims() {
  if (_claimsStorage && typeof _claimsStorage.get === 'function') {
    try {
      const data = await _claimsStorage.get('claims', {})
      if (data && typeof data === 'object' && !Array.isArray(data)) { _claimsMemory = { ...data }; return { ...data } }
    } catch { /* memory fallback */ }
  }
  return { ..._claimsMemory }
}
async function saveClaims(claims) {
  _claimsMemory = { ...claims }
  if (_claimsStorage && typeof _claimsStorage.set === 'function') {
    try { await _claimsStorage.set('claims', claims) } catch { /* noop */ }
  }
}
async function addClaim(issueNumber, meta) {
  meta = meta || {}
  const num = String(issueNumber).replace(/^#/, '').trim()
  const claims = await loadClaims()
  const now = new Date()
  const updated = { ...claims, [num]: {
    at: meta.at || now.toISOString(),
    expires: meta.expires || new Date(now.getTime() + 7 * 864e5).toISOString(),
    title: meta.title || ('Issue #' + num),
    url: meta.url || ('https://github.com/' + REPO + '/issues/' + num),
  } }
  await saveClaims(updated)
  return updated
}
async function removeClaim(issueNumber) {
  const num = String(issueNumber).replace(/^#/, '').trim()
  const claims = await loadClaims()
  const updated = { ...claims }
  delete updated[num]
  await saveClaims(updated)
  return updated
}

// Anti-squat pre-check: assignee? recent take-comment? open linked PR?
// Returns { ok: true } or { blocked: true, reason, link }.
async function precheckClaim(issueNumber) {
  const num = String(issueNumber).replace(/^#/, '').trim()
  if (!num || !/^\d+$/.test(num)) return { blocked: true, reason: 'Invalid issue number #' + issueNumber }
  let issue
  try { issue = await gh('/repos/' + REPO + '/issues/' + num) }
  catch (err) { return { blocked: true, reason: 'Could not fetch issue #' + num + ': ' + (err.message || err) } }
  if (issue.pull_request) return { blocked: true, reason: '#' + num + ' is a pull request, not an issue', link: issue.html_url }
  if (issue.state === 'closed') return { blocked: true, reason: 'Issue #' + num + ' is already closed (' + (issue.state_reason || 'closed') + ')', link: issue.html_url }
  const assignee = (issue.assignee && issue.assignee.login) || (Array.isArray(issue.assignees) && issue.assignees[0] && issue.assignees[0].login)
  if (assignee) return { blocked: true, reason: 'Already assigned to @' + assignee, link: issue.html_url }
  try {
    const comments = await gh('/repos/' + REPO + '/issues/' + num + '/comments?per_page=100')
    if (Array.isArray(comments) && comments.length) {
      const takeRe = /(?:i(?:'ll|\s+will|\s+am|\s*m)?\s+take\s+(?:this|it)|taking\s+(?:this|it)|working\s+on\s+(?:this|a\s+fix)|claim(?:ing)?\s+this)/i
      const dropRe = /(?:unclaim(?:ing)?|giving\s+up|step(?:ping)?\s+down)/i
      for (let i = comments.length - 1; i >= 0; i--) {
        const c = comments[i], body = c.body || '', author = (c.user && c.user.login) || 'contributor'
        if (dropRe.test(body)) break
        if (takeRe.test(body)) {
          if (Date.now() - new Date(c.created_at).getTime() < 7 * 864e5) {
            return { blocked: true, reason: 'Claimed by @' + author + ' (' + age(c.created_at) + ')', link: c.html_url }
          }
        }
      }
    }
  } catch { /* non-blocking */ }
  try {
    const q = encodeURIComponent('repo:' + REPO + ' type:pr state:open #' + num)
    const prs = await gh('/search/issues?q=' + q + '&per_page=5')
    if (prs && Array.isArray(prs.items)) {
      for (const item of prs.items) {
        const text = ((item.title || '') + ' ' + (item.body || '')).toLowerCase()
        if (text.includes('#' + num)) {
          return { blocked: true, reason: 'Open PR #' + item.number + ' references this issue: ' + (item.title || ''), link: item.html_url }
        }
      }
    }
  } catch { /* non-blocking */ }
  return { ok: true }
}

function buildClaimDraft(issueNumber) {
  const num = String(issueNumber).replace(/^#/, '').trim()
  const body = 'I will take this. Working on a fix.'
  return { command: 'gh issue comment ' + num + ' --repo ' + REPO + ' --body "' + body + '"', body }
}
function buildUnclaimDraft(issueNumber) {
  const num = String(issueNumber).replace(/^#/, '').trim()
  const body = 'Unclaiming this issue so others can pick it up.'
  return { command: 'gh issue comment ' + num + ' --repo ' + REPO + ' --body "' + body + '"', body }
}

function getExpiryCountdown(expiresIso) {
  const diff = new Date(expiresIso).getTime() - Date.now()
  if (diff <= 0) return { lapsed: true, label: 'lapsed' }
  const totalHours = Math.floor(diff / 3600000)
  const days = Math.floor(totalHours / 24)
  const label = days > 0 ? days + 'd ' + (totalHours % 24) + 'h left' : (totalHours > 0 ? totalHours + 'h left' : Math.max(1, Math.floor(diff / 60000)) + 'm left')
  if (totalHours < 12) return { lapsed: false, label, hot: 'red' }
  if (totalHours < 48) return { lapsed: false, label, hot: 'amber' }
  return { lapsed: false, label, hot: null }
}
function expiryColor(hot) {
  if (hot === 'red') return { color: '#f87171', borderColor: '#f87171' }
  if (hot === 'amber') return { color: '#fbbf24', borderColor: '#fbbf24' }
  return { color: 'var(--ui-text-secondary)', borderColor: 'var(--ui-stroke-secondary)' }
}

function MineTab({ onSwitchTab }) {
  const [claims, setClaims] = useState({})
  const [statusMap, setStatusMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [draftBox, setDraftBox] = useState(null)
  const [checkingNum, setCheckingNum] = useState(null)
  const [checkErr, setCheckErr] = useState(null)
  useEffect(() => {
    let cancelled = false
    async function init() {
      setLoading(true)
      const c = await loadClaims()
      if (cancelled) return
      setClaims(c); setLoading(false)
      for (const num of Object.keys(c)) {
        let entry = {}
        try {
          const issue = await gh('/repos/' + REPO + '/issues/' + num)
          let linkedPR = null
          try {
            const tl = await gh('/repos/' + REPO + '/issues/' + num + '/timeline')
            if (Array.isArray(tl)) {
              for (const it of tl) {
                if (it.event === 'cross-referenced' && it.source && it.source.issue && it.source.issue.pull_request) {
                  linkedPR = { number: it.source.issue.number, title: it.source.issue.title, url: it.source.issue.html_url, state: it.source.issue.state }
                  break
                }
              }
            }
          } catch { /* non-blocking */ }
          entry = { state: issue.state, stateReason: issue.state_reason, title: issue.title || c[num].title, url: issue.html_url || c[num].url, linkedPR }
        } catch { /* keep cached metadata */ }
        if (!cancelled && entry.state) setStatusMap(prev => ({ ...prev, [num]: entry }))
      }
    }
    init()
    return () => { cancelled = true }
  }, [])
  function copyDraft(t) {
    try { if (navigator.clipboard) navigator.clipboard.writeText(t) } catch { /* noop */ }
    host.notify({ kind: 'success', message: 'Command copied — run it in terminal' })
    haptic('tap')
  }
  async function handleUnclaim(num) {
    haptic('tap')
    await removeClaim(num)
    setClaims(await loadClaims())
    const draft = buildUnclaimDraft(num)
    setDraftBox({ type: 'unclaim', num, title: 'Claim removed locally #' + num, command: draft.command, sub: 'Run this in terminal to retract your comment on GitHub:' })
    host.notify({ kind: 'info', message: 'Claim removed locally for #' + num })
  }
  async function handleReclaim(num, item) {
    haptic('tap')
    setCheckingNum(num); setCheckErr(null)
    try {
      const res = await precheckClaim(num)
      if (res.blocked) {
        setCheckErr({ num, reason: res.reason, link: res.link })
        host.notify({ kind: 'warning', message: 'Cannot reclaim #' + num + ': ' + res.reason })
      } else {
        const draft = buildClaimDraft(num)
        setClaims(await addClaim(num, { title: item.title, url: item.url }))
        setDraftBox({ type: 'claim', num, title: 'Re-claimed #' + num, command: draft.command, sub: 'Post this comment via gh CLI to confirm your claim:' })
        host.notify({ kind: 'success', message: 'Re-claimed #' + num + ' — run comment command' })
      }
    } catch (e) { setCheckErr({ num, reason: String(e.message || e) }) }
    finally { setCheckingNum(null) }
  }
  const entries = Object.entries(claims).map(([num, claim]) => {
    const live = statusMap[num] || {}
    const state = live.state || 'open'
    const expiry = getExpiryCountdown(claim.expires)
    let isHistory = false, historyKind = null
    if (state === 'closed') { isHistory = true; historyKind = live.stateReason === 'completed' ? 'completed' : 'closed' }
    else if (expiry.lapsed) { isHistory = true; historyKind = 'lapsed' }
    return { num, claim, live, state, expiry, isHistory, historyKind }
  })
  const activeClaims = entries.filter(e => !e.isHistory)
  const historyClaims = entries.filter(e => e.isHistory)
  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 }, children: [
    draftBox ? jsxs('div', { style: { ...S.card, borderColor: 'var(--ui-accent)' }, children: [
      jsx('div', { style: { fontWeight: 700, fontSize: 13, color: 'var(--foreground)' }, children: draftBox.title }),
      jsx('div', { style: S.sub, children: draftBox.sub }),
      jsx('div', { style: { padding: '8px 10px', borderRadius: 8, background: 'transparent', border: '1px solid var(--ui-stroke-secondary)', fontFamily: 'ui-monospace, monospace', fontSize: 11, wordBreak: 'break-all', color: 'var(--foreground)' }, children: draftBox.command }),
      jsxs('div', { style: S.row, children: [
        jsx('button', { style: S.btn, onClick: () => copyDraft(draftBox.command), children: 'Copy command' }),
        jsx('button', { style: S.ghost, onClick: () => setDraftBox(null), children: 'Dismiss' }),
      ] }),
    ] }) : null,
    checkErr ? jsxs('div', { style: S.banner('high'), children: [
      jsx('div', { style: S.bannerT('high'), children: 'Claim blocked for #' + checkErr.num }),
      jsx('div', { style: S.sub, children: checkErr.reason }),
      checkErr.link ? jsx('a', { style: { ...S.cardT, fontSize: 11, textDecoration: 'underline' }, href: checkErr.link, target: '_blank', rel: 'noreferrer', children: 'View blocker' }) : null,
      jsx('button', { style: { ...S.ghost, alignSelf: 'flex-start', marginTop: 4 }, onClick: () => setCheckErr(null), children: 'Dismiss' }),
    ] }) : null,
    jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [
      jsxs('div', { style: S.row, children: [
        jsx('div', { style: { fontWeight: 750, fontSize: 13, color: 'var(--foreground)' }, children: 'Active claims' }),
        activeClaims.length ? jsx(Badge, { children: String(activeClaims.length) }) : null,
      ] }),
      loading && !activeClaims.length ? jsx('div', { style: S.sub, children: 'Loading claims…' }) : null,
      !loading && !activeClaims.length ? jsxs('div', { style: { ...S.card, alignItems: 'flex-start' }, children: [
        jsx('div', { style: S.sub, children: 'No active claims right now. Pick an open issue to get started.' }),
        onSwitchTab ? jsx('button', { style: { ...S.ghost, marginTop: 4 }, onClick: () => onSwitchTab('board'), children: 'Find work on the Board' }) : null,
      ] }) : null,
      activeClaims.map(item =>
        jsxs('div', { key: item.num, style: S.card, children: [
          jsxs('div', { style: S.row, children: [
            jsx('span', { style: { ...S.chip, fontWeight: 700, color: 'var(--ui-accent)', borderColor: 'var(--ui-accent)' }, children: '#' + item.num }),
            jsx('span', { style: { ...S.chip, ...expiryColor(item.expiry.hot) }, children: item.expiry.label }),
            item.live.linkedPR ? jsx('span', { style: { ...S.chip, color: '#4ade80', borderColor: '#4ade80' }, children: 'PR #' + item.live.linkedPR.number }) : null,
            jsx('span', { style: S.meta, children: 'claimed ' + age(item.claim.at) }),
          ] }),
          jsx('a', { style: S.cardT, href: item.claim.url, target: '_blank', rel: 'noreferrer', children: item.live.title || item.claim.title }),
          item.live.linkedPR ? jsxs('div', { style: { ...S.meta, color: '#4ade80' }, children: [
            jsx('span', { children: 'Linked PR #' + item.live.linkedPR.number + ': ' }),
            jsx('a', { style: { color: '#4ade80', textDecoration: 'underline' }, href: item.live.linkedPR.url, target: '_blank', rel: 'noreferrer', children: item.live.linkedPR.title }),
          ] }) : null,
          jsxs('div', { style: S.row, children: [
            jsx('button', { style: S.ghost, onClick: () => handleUnclaim(item.num), children: 'Unclaim' }),
          ] }),
        ] }),
      ),
    ] }),
    historyClaims.length ? jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }, children: [
      jsxs('div', { style: S.row, children: [
        jsx('div', { style: { fontWeight: 750, fontSize: 13, color: 'var(--foreground)' }, children: 'Claim history' }),
        jsx(Badge, { children: String(historyClaims.length) }),
      ] }),
      historyClaims.map(item => {
        const done = item.historyKind === 'completed'
        return jsxs('div', { key: item.num, style: { ...S.card, borderColor: done ? '#4ade80' : 'var(--ui-stroke-secondary)' }, children: [
          jsxs('div', { style: S.row, children: [
            jsx('span', { style: { ...S.chip, fontWeight: 700 }, children: '#' + item.num }),
            jsx('span', { style: { ...S.chip, color: done ? '#4ade80' : 'var(--ui-text-tertiary)', borderColor: done ? '#4ade80' : 'var(--ui-stroke-secondary)' }, children: item.historyKind }),
            jsx('span', { style: S.meta, children: 'claimed ' + age(item.claim.at) }),
          ] }),
          jsx('a', { style: S.cardT, href: item.claim.url, target: '_blank', rel: 'noreferrer', children: item.live.title || item.claim.title }),
          jsxs('div', { style: S.row, children: [
            item.historyKind === 'lapsed' ? jsx('button', { style: S.ghost, disabled: checkingNum === item.num, onClick: () => handleReclaim(item.num, item.claim), children: checkingNum === item.num ? 'Checking…' : 'Re-claim' }) : null,
            jsx('button', { style: { ...S.ghost, fontSize: 11 }, onClick: async () => { haptic('tap'); await removeClaim(item.num); setClaims(await loadClaims()) }, children: 'Remove' }),
          ] }),
        ] })
      }),
    ] }) : null,
  ] })
}

// --- styles (inline only) ------------------------------------------------------
const S = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 12, padding: 14, fontSize: 13, height: '100%', overflowY: 'auto' },
  hero: { display: 'flex', alignItems: 'center', gap: 9 },
  dot: { width: 10, height: 10, borderRadius: 999, background: 'linear-gradient(135deg,#22d3ee,#a78bfa)', boxShadow: '0 0 12px #22d3ee66' },
  title: { fontWeight: 750, fontSize: 14, letterSpacing: '-0.01em' },
  sub: { color: 'var(--ui-text-tertiary)', fontSize: 12, lineHeight: 1.55 },
  box: { width: '100%', boxSizing: 'border-box', background: 'var(--ui-input-bg, transparent)', border: '1px solid var(--ui-stroke-secondary)', borderRadius: 10, padding: '9px 11px', fontSize: 13, color: 'var(--foreground)', outline: 'none' },
  btn: { border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer', background: 'linear-gradient(135deg,#0ea5e9,#8b5cf6)', color: '#fff', fontWeight: 700 },
  ghost: { border: '1px solid var(--ui-stroke-secondary)', borderRadius: 9, padding: '6px 12px', fontSize: 12, cursor: 'pointer', background: 'transparent', color: 'var(--foreground)' },
  banner: t => ({ borderRadius: 12, padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: 3, border: '1px solid', borderColor: t === 'high' ? '#f8717155' : t === 'med' ? '#fbbf2455' : '#16a34a33', background: t === 'high' ? 'linear-gradient(135deg,#dc262622,#7f1d1d22)' : t === 'med' ? 'linear-gradient(135deg,#d9770622,#78350f22)' : 'linear-gradient(135deg,#16a34a22,#14532d22)' }),
  bannerT: t => ({ fontWeight: 750, fontSize: 13, color: t === 'high' ? '#f87171' : t === 'med' ? '#fbbf24' : '#4ade80' }),
  card: { border: '1px solid var(--ui-stroke-secondary)', borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
  cardT: { fontWeight: 600, fontSize: 13, lineHeight: 1.4, color: 'var(--foreground)', textDecoration: 'none' },
  meta: { color: 'var(--ui-text-tertiary)', fontSize: 11, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  chip: { fontSize: 10, borderRadius: 999, padding: '2px 8px', border: '1px solid var(--ui-stroke-secondary)', color: 'var(--ui-text-secondary)' },
  bar: { height: 4, borderRadius: 999, background: 'var(--ui-stroke-secondary)', overflow: 'hidden' },
  barFill: f => ({ height: 4, width: Math.min(100, Math.round(f * 100)) + '%', background: 'linear-gradient(90deg,#22d3ee,#a78bfa)', borderRadius: 999 }),
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  tabs: { display: 'flex', gap: 6, background: 'var(--ui-stroke-secondary)', borderRadius: 999, padding: 3, alignSelf: 'flex-start' },
  tab: on => ({ border: 'none', borderRadius: 999, padding: '5px 14px', fontSize: 12, cursor: 'pointer', fontWeight: on ? 700 : 400, background: on ? 'var(--ui-accent)' : 'transparent', color: on ? '#fff' : 'var(--ui-text-secondary)' }),
}

function Verdict({ v }) {
  if (!v) return null
  return jsxs('div', { style: S.banner(v.tone), children: [
    jsx('div', { style: S.bannerT(v.tone), children: v.label }),
    jsx('div', { style: S.sub, children: v.sub }),
  ] })
}

function Cards({ ranked, maxScore, onClaim, myClaims }) {
  if (!ranked.length) return jsx('div', { style: S.sub, children: 'No open issues or PRs matched. Clear runway.' })
  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: ranked.slice(0, 8).map(it =>
    jsxs('div', { key: String(it.number), style: S.card, children: [
      jsxs('div', { style: S.row, children: [
        jsx('span', { style: { ...S.chip, fontWeight: 700, color: 'var(--ui-accent)', borderColor: 'var(--ui-accent)' }, children: '#' + it.number }),
        jsx('span', { style: { ...S.chip, background: it.isPR ? '#8b5cf633' : '#0ea5e933' }, children: it.isPR ? 'PR' : 'ISSUE' }),
        jsx('span', { style: S.meta, children: 'match ' + it.score }),
      ] }),
      jsx('a', { style: S.cardT, href: it.url, target: '_blank', rel: 'noreferrer', children: it.title }),
      jsx('div', { style: S.bar, children: jsx('div', { style: S.barFill(maxScore ? it.score / maxScore : 0) }) }),
      jsxs('div', { style: S.meta, children: [
        jsx('span', { children: '@' + it.author }),
        jsx('span', { children: age(it.created) }),
        jsx('span', { children: it.comments + ' comments' }),
        it.labels.slice(0, 3).map(l => jsx('span', { key: l, style: S.chip, children: l })),
      ] }),
      onClaim && !it.isPR ? jsxs('div', { style: { ...S.row, justifyContent: 'flex-end' }, children: [
        jsx('button', { type: 'button', style: { ...S.ghost, padding: '3px 10px', fontSize: 11, cursor: 'pointer' },
          onClick: () => onClaim(it),
          children: (myClaims && myClaims[it.number]) ? 'Claimed — view in Mine' : 'Claim this instead' }),
      ] }) : null,
    ] })
  ) })
}

let timer = null
function LensBody() {
  useQueryClient()
  const [tab, setTab] = useState('check')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [ranked, setRanked] = useState(null)
  const [v, setV] = useState(null)
  const [err, setErr] = useState('')
  const [cTitle, setCTitle] = useState('')
  const [cBody, setCBody] = useState('')
  const [claims, setClaims] = useState({})
  const [claimInfo, setClaimInfo] = useState(null)
  useEffect(() => { loadClaims().then(setClaims).catch(() => {}) }, [])

  async function run(q) {
    const query = (q !== undefined ? q : text).trim()
    if (!query || busy) return
    setBusy(true); setErr('')
    try {
      const { ranked: r } = await checkDuplicates(query)
      setRanked(r)
      setV(verdict(r))
      haptic('tap')
    } catch (e) { setErr(String(e.message || e)); setRanked(null); setV(null) }
    finally { setBusy(false) }
  }
  function onType(e) {
    setText(e.target.value)
    clearTimeout(timer)
    timer = setTimeout(() => run(e.target.value), 900)
  }
  function copyCmd(t) {
    try { if (navigator.clipboard) navigator.clipboard.writeText(t) } catch { /* noop */ }
    host.notify({ kind: 'success', message: 'Command copied — run it in terminal' })
    haptic('tap')
  }
  async function handleClaim(it) {
    const num = it.number
    setClaimInfo(null)
    haptic('tap')
    try {
      const pre = await precheckClaim(num)
      if (pre.blocked) {
        setClaimInfo({ blocked: true, num, reason: pre.reason, link: pre.link })
        host.notify({ kind: 'warning', message: 'Claim blocked #' + num + ': ' + pre.reason })
        return
      }
      const draft = buildClaimDraft(num)
      setClaims(await addClaim(num, { title: it.title, url: it.url }))
      setClaimInfo({ blocked: false, num, title: it.title, command: draft.command })
      host.notify({ kind: 'success', message: 'Claimed #' + num + ' locally — post the comment to confirm' })
    } catch (e) { setClaimInfo({ blocked: true, num, reason: String(e.message || e) }) }
  }

  const cls = classifyIssue(cTitle || text, cBody)
  const handoff = 'Triage check: "' + (cTitle || text).slice(0, 160) + '" → search open issues/PRs in ' + REPO + ' first; report proceed / claim #<id> / duplicate-of #<id>. Do not file until the top match is ruled out.'
  const maxScore = ranked && ranked.length ? Math.max(1, ranked[0].score) : 1

  return jsxs('div', { style: S.wrap, children: [
    jsxs('div', { style: S.hero, children: [
      jsx('div', { style: S.dot }),
      jsx('div', { style: S.title, children: 'Triage Lens' }),
    ] }),
    jsx('div', { style: S.sub, children: 'Describe the bug or the fix. Lens sweeps every open issue + PR and tells you whether you\u2019re about to duplicate someone.' }),
    jsxs('div', { style: S.tabs, children: [
      jsx('button', { style: S.tab(tab === 'check'), onClick: () => setTab('check'), children: 'Check' }),
      jsx('button', { style: S.tab(tab === 'board'), onClick: () => setTab('board'), children: 'Board' }),
      jsx('button', { style: S.tab(tab === 'mine'), onClick: () => setTab('mine'), children: 'Mine' }),
      jsx('button', { style: S.tab(tab === 'classify'), onClick: () => setTab('classify'), children: 'Classify' }),
    ] }),
    claimInfo ? jsxs('div', { style: S.banner(claimInfo.blocked ? 'high' : 'low'), children: [
      jsx('div', { style: S.bannerT(claimInfo.blocked ? 'high' : 'low'),
        children: claimInfo.blocked ? 'Claim blocked for #' + claimInfo.num : 'Claimed #' + claimInfo.num + ' — one step left' }),
      claimInfo.blocked ? jsx('div', { style: S.sub, children: claimInfo.reason }) : null,
      claimInfo.blocked && claimInfo.link ? jsx('a', { style: { ...S.cardT, fontSize: 11, textDecoration: 'underline' }, href: claimInfo.link, target: '_blank', rel: 'noreferrer', children: 'View blocker' }) : null,
      !claimInfo.blocked ? jsx('div', { style: S.sub, children: 'Saved locally with a 7-day expiry. Post the comment so the community sees it:' }) : null,
      !claimInfo.blocked ? jsx('div', { style: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--ui-stroke-secondary)', fontFamily: 'ui-monospace, monospace', fontSize: 11, wordBreak: 'break-all', color: 'var(--foreground)' }, children: claimInfo.command }) : null,
      jsxs('div', { style: S.row, children: [
        !claimInfo.blocked ? jsx('button', { style: S.btn, onClick: () => copyCmd(claimInfo.command), children: 'Copy command' }) : null,
        !claimInfo.blocked ? jsx('button', { style: S.ghost, onClick: () => setTab('mine'), children: 'View in Mine' }) : null,
        jsx('button', { style: S.ghost, onClick: () => setClaimInfo(null), children: 'Dismiss' }),
      ] }),
    ] }) : null,
    tab === 'check' ? jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 }, children: [
      jsx('textarea', { style: { ...S.box, minHeight: 76, resize: 'vertical' }, value: text, onChange: onType, placeholder: 'e.g. gateway anonymous ticket reuse after reconnect…' }),
      jsxs('div', { style: S.row, children: [
        jsx('button', { style: S.btn, onClick: () => run(), disabled: busy || !text.trim(), children: busy ? 'Sweeping open issues…' : 'Check for duplicates' }),
        ranked ? jsx(Badge, { children: ranked.length + ' open matches' }) : null,
      ] }),
      err ? jsx('div', { style: { color: '#f87171', fontSize: 12 }, children: err }) : null,
      busy && !ranked ? jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [
        jsx(Skeleton, { style: { height: 64, borderRadius: 12 } }),
        jsx(Skeleton, { style: { height: 64, borderRadius: 12 } }),
      ] }) : null,
      Verdict({ v }),
      ranked ? Cards({ ranked, maxScore, onClaim: handleClaim, myClaims: claims }) : null,
    ] }) : null,
    tab === 'board' ? jsx(BoardTab, { onClaim: handleClaim, myClaims: claims }) : null,
    tab === 'mine' ? jsx(MineTab, { onSwitchTab: setTab }) : null,
    tab === 'classify' ? jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [
      jsx('input', { style: S.box, value: cTitle, onChange: e => setCTitle(e.target.value), placeholder: 'Issue title…' }),
      jsx('textarea', { style: { ...S.box, minHeight: 84, resize: 'vertical' }, value: cBody, onChange: e => setCBody(e.target.value), placeholder: 'Body — symptoms, repro, logs…' }),
      jsxs('div', { style: S.row, children: [
        jsx(Badge, { children: 'type: ' + cls.type }),
        jsx(Badge, { children: cls.sev }),
        jsx('button', { style: S.ghost, onClick: () => run(cTitle + '\n' + cBody), children: 'Check duplicates for this' }),
      ] }),
      jsxs('div', { style: S.card, children: [
        jsx('div', { style: { fontWeight: 700, fontSize: 12 }, children: 'Agent handoff' }),
        jsx('div', { style: { ...S.sub, fontFamily: 'ui-monospace,monospace', fontSize: 11 }, children: handoff }),
        jsx('button', { style: S.ghost, onClick: () => {
          try { if (navigator.clipboard) navigator.clipboard.writeText(handoff) } catch { /* noop */ }
          host.notify({ kind: 'success', message: 'Handoff copied — paste into any session' })
          haptic('tap')
        }, children: 'Copy handoff' }),
      ] }),
    ] }) : null,
    jsx('div', { style: { ...S.sub, fontSize: 11 }, children: 'Zero-setup: public GitHub API, results cached 5 min. No account, no key, nothing to configure.' }),
  ] })
}

function Chip() {
  return jsx(Tip, {
    label: 'Triage Lens — check before you open',
    children: jsx('button', {
      type: 'button',
      className: cn('inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] transition-colors', 'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'),
      onClick: () => { haptic('tap'); if (host.navigate) host.navigate('/triage-lens') },
      children: '◉ triage',
    }),
  })
}

export default {
  id: ID,
  name: 'Triage Lens',
  register(ctx) {
    try { initClaimsStore(ctx && ctx.storage) } catch { /* memory fallback */ }
    ctx.register({ id: 'pane', area: 'panes', title: 'triage lens', data: { placement: 'right', width: '360px' }, render: () => jsx(LensBody, {}) })
    ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: '/triage-lens' }, path: '/triage-lens', title: 'Triage Lens', render: () => jsx(LensBody, {}) })
    ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, order: 47, data: { codicon: 'project', label: 'Triage Lens', path: '/triage-lens' }, path: '/triage-lens', label: 'Triage Lens', codicon: 'project' })
    ctx.register({ id: 'chip', area: 'statusBar.right', order: 131, render: () => jsx(Chip, {}) })
    ctx.register({ id: 'open', area: PALETTE_AREA, data: { id: 'triage-lens.open', label: 'Triage Lens: Open', keywords: ['triage', 'duplicate', 'issues', 'prs'], run: () => { if (host.navigate) host.navigate('/triage-lens') } } })
    ctx.register({ id: 'check', area: PALETTE_AREA, data: { id: 'triage-lens.check', label: 'Triage Lens: Check work for duplicates', keywords: ['duplicate', 'check', 'meta-issue', 'triage'], run: () => { if (host.navigate) host.navigate('/triage-lens') } } })
  },
}
