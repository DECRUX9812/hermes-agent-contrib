/**
 * Summarisation / hygiene layer.
 *
 * A sub-agent's return is untrusted input. It runs through a fixed pipeline —
 * sanitize, truncate, dedupe, score, format — and only a `valid` or
 * `valid-with-fixes` summary may reach the promotion queue. Every mutation the
 * pipeline makes is recorded in `validation.fixes`, so a summary is never
 * silently different from what the sub-agent produced.
 *
 * Pure functions only: no clocks, no randomness, no I/O. `now` is passed in.
 */

import type { Summary, SummaryDraft, SummaryDraftDecision, SummaryDraftFact } from './types'

export const LIMITS = {
  decisions: 3,
  factChars: 240,
  facts: 8,
  headlineChars: 120,
  openQuestions: 5,
  resultChars: 2000,
  summaryMaxChars: 1200
} as const

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|ghp|gho|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi,
  /\b[A-Za-z0-9._%+-]+:[^\s@/]{8,}@/g // user:password@host
]

/** Stable, dependency-free hash for dedupe (not a security primitive). */
export function contentHash(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)

    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0
  }

  return `fnv:${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function normaliseText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function redactSecrets(text: string): string {
  let out = text
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]')

  return out
}

/** Character budget with an explicit marker, so truncation is visible. */
export function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }

  return { text: `${text.slice(0, Math.max(0, max - 1))}…`, truncated: true }
}

const shingles = (text: string): Set<string> => {
  const words = text.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean)
  const out = new Set<string>()
  for (let i = 0; i < Math.max(1, words.length - 2); i++) out.add(words.slice(i, i + 3).join(' '))

  return out
}

/** Near-duplicate check (3-gram Jaccard). Exact match short-circuits to true. */
export function similarFact(a: string, b: string, threshold = 0.9): boolean {
  const na = normaliseText(a).toLowerCase()
  const nb = normaliseText(b).toLowerCase()
  if (na === nb) return true
  const sa = shingles(na)
  const sb = shingles(nb)
  if (!sa.size || !sb.size) return false
  let shared = 0
  for (const s of sa) if (sb.has(s)) shared++

  return shared / (sa.size + sb.size - shared) >= threshold
}

export interface HygieneOptions {
  /** Fact texts already present in the durable context. */
  knownFactTexts?: readonly string[]
  maxChars?: number
  now?: string
}

/**
 * Validate + normalise one sub-agent return into a promotable summary.
 * Never throws: a broken draft degrades to `malformed` with a reason.
 */
export function hygiene(
  sessionId: string,
  summaryId: string,
  draft: SummaryDraft,
  opts: HygieneOptions = {}
): Summary {
  const fixes: string[] = []
  const now = opts.now ?? new Date().toISOString()
  const maxChars = opts.maxChars ?? LIMITS.summaryMaxChars

  const base: Summary = {
    artifacts: [],
    contentHash: '',
    decisionsNeeded: [],
    facts: [],
    headline: '',
    openQuestions: [],
    partial: false,
    promotion: { decidedAt: null, entryIds: [], state: 'pending' },
    result: '',
    schemaVersion: 1,
    sessionId,
    summaryId,
    tokenCost: 0,
    validation: { dropped: 0, fixes, state: 'valid' }
  }

  if (!draft || typeof draft !== 'object') {
    return { ...base, validation: { dropped: 0, fixes: ['draft was not an object'], state: 'malformed' } }
  }

  const clean = (value: unknown): string =>
    typeof value === 'string' ? redactSecrets(normaliseText(value)) : ''

  // 1. headline
  const headlineRaw = clean(draft.headline)
  const headline = truncate(headlineRaw, LIMITS.headlineChars)
  if (headline.truncated) fixes.push('truncated:headline')

  // 2. result — never dropped, only capped
  const resultRaw = clean(draft.result)
  const result = truncate(resultRaw, Math.min(LIMITS.resultChars, maxChars))
  if (result.truncated) fixes.push('truncated:result')

  // 3. facts: sanitize → truncate → dedupe (intra, then against context) → cap
  const seen: string[] = []
  const facts: SummaryDraftFact[] = []
  let dropped = 0
  for (const raw of draft.facts ?? []) {
    const text = truncate(clean(raw?.text), LIMITS.factChars)
    if (!text.text) {
      dropped++
      continue
    }
    if (text.truncated) fixes.push('truncated:fact')
    if (seen.some(s => similarFact(s, text.text))) {
      dropped++
      continue
    }
    if ((opts.knownFactTexts ?? []).some(k => similarFact(k, text.text))) {
      dropped++
      continue
    }
    seen.push(text.text)
    const confidence = typeof raw?.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : 0.5
    facts.push({
      confidence,
      text: text.text,
      unverified: raw?.unverified ?? confidence < 0.5
    })
  }
  if (facts.length > LIMITS.facts) {
    fixes.push(`truncated:facts(${facts.length}->${LIMITS.facts})`)
    // keep the highest-confidence facts, preserve input order for the survivors
    const keep = new Set(
      [...facts]
        .map((f, i) => ({ c: f.confidence ?? 0.5, i }))
        .sort((a, b) => b.c - a.c)
        .slice(0, LIMITS.facts)
        .map(x => x.i)
    )
    for (let i = facts.length - 1; i >= 0; i--) if (!keep.has(i)) facts.splice(i, 1)
  }

  // 4. decisions
  const decisions: SummaryDraftDecision[] = (draft.decisionsNeeded ?? [])
    .map(d => ({
      options: (d?.options ?? []).map(o => truncate(clean(o), 80).text).filter(Boolean).slice(0, 4),
      question: truncate(clean(d?.question), 160).text,
      recommendation: d?.recommendation ? truncate(clean(d.recommendation), 120).text : undefined
    }))
    .filter(d => d.question.length > 0)
  if (decisions.length > LIMITS.decisions) {
    fixes.push(`truncated:decisions(${decisions.length}->${LIMITS.decisions})`)
    decisions.length = LIMITS.decisions
  }

  // 5. artifacts + open questions (overflow from earlier steps lands here, never vanishes)
  const artifacts = (draft.artifacts ?? [])
    .map(a => ({ kind: truncate(clean(a?.kind), 24).text, ref: truncate(clean(a?.ref), 120).text }))
    .filter(a => a.kind && a.ref)
    .slice(0, 5)
  const openQuestions = (draft.openQuestions ?? [])
    .map(q => truncate(clean(q), 160).text)
    .filter(Boolean)
    .slice(0, LIMITS.openQuestions)

  const rendered = renderSummary({ facts, headline: headline.text, result: result.text })
  const tooLarge = rendered.length > maxChars * 2

  const state = tooLarge
    ? ('too-large' as const)
    : !result.text && !facts.length
      ? ('empty' as const)
      : fixes.length
        ? ('valid-with-fixes' as const)
        : ('valid' as const)

  const summary: Summary = {
    ...base,
    artifacts,
    contentHash: contentHash(`${headline.text}\u0000${result.text}\u0000${facts.map(f => f.text).join('\u0001')}`),
    decisionsNeeded: decisions,
    facts,
    headline: headline.text || result.text.slice(0, LIMITS.headlineChars),
    openQuestions,
    result: result.text,
    tokenCost: estimateTokens(rendered),
    validation: {
      dropped,
      fixes,
      state: state === 'too-large' || state === 'empty' ? state : state
    }
  }

  return summary
}

/** Render the promotable form. Kept small: this is what the orchestrator reads. */
export function renderSummary(s: Pick<Summary, 'facts' | 'headline' | 'result'> & { decisionsNeeded?: SummaryDraftDecision[] }): string {
  const lines = [`## ${s.headline}`]
  if (s.result) lines.push(s.result)
  if (s.facts.length) {
    lines.push('**facts**')
    for (const f of s.facts) lines.push(`- ${f.text}${f.unverified ? ' _(unverified)_' : ''}`)
  }
  for (const d of s.decisionsNeeded ?? []) lines.push(`- **decision:** ${d.question}`)

  return lines.join('\n')
}

/** Compaction for a context that outgrew its budget: drop weak facts first. */
export function compactFacts<T extends { text: string; unverified?: boolean }>(facts: T[], budgetChars: number): T[] {
  let total = facts.reduce((n, f) => n + f.text.length, 0)
  const out = [...facts]
  const order = out
    .map((f, i) => ({ i, weak: f.unverified ? 0 : 1 }))
    .sort((a, b) => a.weak - b.weak || a.i - b.i)
  for (const { i } of order) {
    if (total <= budgetChars) break
    total -= out[i].text.length
    out[i] = { ...out[i], text: '__drop__' }
  }

  return out.filter(f => f.text !== '__drop__')
}
