/**
 * Model-written subjects for Activity rows — the ASYNC UPGRADE layer.
 *
 * The rows render synchronously: a subject is derived locally at task
 * derivation (the request, run through `requestSubject`, or the work the steps
 * name) and that is what ships, offline or not. This layer then asks a cheap
 * auxiliary model for a 5-10 word muse-style subject per request, ONCE per
 * task, and merges the answer in when it lands. The UI never waits on it:
 * every render path reads `task.subject`, which this module only ever improves.
 *
 * Three controls keep it from becoming a bill or a spinner:
 *
 *  - ONE batched `llm.oneshot` call for every eligible visible row (no call
 *    per row), fired on mount and when a task settles — never while running;
 *  - one attempt per task EVER: an in-memory latch per session plus a
 *    persisted cache entry (`model` when accepted, `rejected` when the answer
 *    failed validation, so a bad answer is never paid for twice);
 *  - `temperature: 0`, no `session_id` (the AUX tier answers, not the live
 *    conversation's model) and a 48-token budget per subject.
 *
 * Every failure — gateway offline, no aux backend, malformed reply — is
 * swallowed and leaves the derived subject standing.
 */

import { type ActivityTask, atom, type ChatMessage, chatMessageText, host, useValue } from '@hermes/plugin-sdk'
import { useEffect, useMemo } from 'react'

import { clipWords } from './activity-format'
import { getPluginCtx } from './shared'

const STORAGE_KEY = 'activity-subjects-v1'
/** A cached subject is a wording, not a fact: it goes stale slowly (a task's
 *  request never changes), but it must not outlive its session forever. */
const ENTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000
const ENTRY_CAP = 500
/** Token budget per subject — the design's 48, scaled by the batch size so a
 *  batched reply is not truncated halfway through its JSON array. */
const TOKENS_PER_SUBJECT = 48
/** Characters of one request sent to the model: enough context to name it,
 *  bounded so a pasted wall of text cannot fill the prompt. */
const REQUEST_CHARS = 600
/** A subject is 5-10 words; 12 is the rejection line for anything wordier. */
const MAX_SUBJECT_WORDS = 12
const MAX_SUBJECT_CHARS = 200

/** One task's cached upgrade. `source` distinguishes an answer we accepted
 *  from one we rejected — both mean "never ask again". */
export interface ActivitySubjectEntry {
  at: number
  /** The accepted subject; '' when the model answered and we refused it. */
  source: 'model' | 'rejected'
  subject: string
}

export interface ActivitySubjectLayer {
  /** Persisted cache, keyed by {@link activitySubjectKey}. */
  entries: Record<string, ActivitySubjectEntry>
  /** The cache has been read (or there is nothing to read), so a task that
   *  already has a subject is never paid for a second time. */
  ready: boolean
}

export const $activitySubjects = atom<ActivitySubjectLayer>({ entries: {}, ready: false })

/** Guards the cache against a hydrate that resolves after a write. The
 *  rail-state pattern: every read/write bumps the revision. */
let cacheRevision = 0

/** One upgrade per task EVER (this session): set as a batch fires, so a
 *  re-render mid-flight cannot fire it again. */
const attempted = new Set<string>()
const inFlight = new Set<string>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitize(value: unknown, now = Date.now()): Record<string, ActivitySubjectEntry> {
  if (!isRecord(value)) {
    return {}
  }

  const entries: [string, ActivitySubjectEntry][] = []

  for (const [key, entry] of Object.entries(value)) {
    if (
      !isRecord(entry) ||
      typeof entry.subject !== 'string' ||
      typeof entry.at !== 'number' ||
      (entry.source !== 'model' && entry.source !== 'rejected') ||
      now - entry.at > ENTRY_TTL_MS
    ) {
      continue
    }

    entries.push([key, { at: entry.at, source: entry.source, subject: entry.subject }])
  }

  // Oldest-expired-first eviction: the newest subjects are the ones still on screen.
  return Object.fromEntries(entries.sort((left, right) => right[1].at - left[1].at).slice(0, ENTRY_CAP))
}

function trimmed(entries: Record<string, ActivitySubjectEntry>): Record<string, ActivitySubjectEntry> {
  return sanitize(entries)
}

function write(entries: Record<string, ActivitySubjectEntry>): void {
  cacheRevision++
  $activitySubjects.set({ entries, ready: true })

  try {
    Promise.resolve(getPluginCtx()?.storage?.set(STORAGE_KEY, entries)).catch(() => undefined)
  } catch {
    /* persistence is best-effort — the subject applies to this session either way */
  }
}

/** Read the cache once, before anything is asked for: a subject already paid
 *  for must never be asked for again. Safe without storage — the empty cache
 *  is then the correct starting point. */
export function ensureActivitySubjects(): void {
  if ($activitySubjects.get().ready) {
    return
  }

  const revision = ++cacheRevision
  const ctx = getPluginCtx()
  const storage = ctx?.storage

  if (!storage) {
    write({})

    return
  }

  try {
    Promise.resolve(storage.get(STORAGE_KEY, {}))
      .then(value => {
        // A write landed first (or the plugin was torn down): keep it.
        if (revision !== cacheRevision || ctx !== getPluginCtx()) {
          return
        }

        $activitySubjects.set({ entries: sanitize(value), ready: true })
      })
      .catch(() => {
        if (revision === cacheRevision) {
          $activitySubjects.set({ entries: {}, ready: true })
        }
      })
  } catch {
    if (revision === cacheRevision) {
      $activitySubjects.set({ entries: {}, ready: true })
    }
  }
}

/** FNV-1a, base36: enough to tell two revisions of the same request apart
 *  without shipping the request text into the storage key. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5

  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(36)
}

/** The cache key for a task: its id, plus a hash of the RAW request so an
 *  edited request re-opens as its own subject. */
export function activitySubjectKey(task: ActivityTask, request = ''): string {
  return `${task.id}:${shortHash(request || task.title || '')}`
}

/** The raw request behind a task, read back from the message the task opened
 *  on. '' for work the agent started on its own — there is no request to name,
 *  so the derived step subject stays. */
function requestTextOf(message: ChatMessage | undefined): string {
  if (!message || message.role !== 'user' || message.userOriginated === false) {
    return ''
  }

  return chatMessageText(message).trim()
}

export function requestTextFor(task: ActivityTask, messages: readonly ChatMessage[] | undefined): string {
  return requestTextOf((messages ?? []).find(candidate => candidate.id === task.id))
}

/** Which language a request is written in, as far as a script check can
 *  tell: kana says Japanese, Han says Chinese, anything else (Latin, Cyrillic,
 *  Arabic…) falls through to the prompt's general same-language rule. Only
 *  named here because a subject that switches language is worse than a subject
 *  we never wrote. */
function requestLanguage(text: string): null | 'ja' | 'zh' {
  if (/[\u3040-\u30ff]/.test(text)) {
    return 'ja'
  }

  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(text)) {
    return 'zh'
  }

  return null
}

const LANGUAGE_NAME: Record<'ja' | 'zh', string> = { ja: 'Japanese', zh: 'Chinese' }

/** One batched request: the numbered asks, then the rules that keep the reply
 *  parseable (JSON array, no punctuation, same language as each request). */
export function subjectPrompt(requests: readonly string[]): { input: string; instructions: string } {
  const numbered = requests.map((request, index) => `${index + 1}. ${request}`).join('\n')

  const rules = [
    'Every subject must be in the SAME language as its own request — never translate it.',
    ...requests.flatMap((request, index) => {
      const language = requestLanguage(request)

      return language ? [`Request ${index + 1} is written in ${LANGUAGE_NAME[language]}: write its subject in ${LANGUAGE_NAME[language]}.`] : []
    })
  ].join('\n')

  return {
    input: numbered,
    instructions: [
      `Give each of these ${requests.length} request${requests.length === 1 ? '' : 's'} a 5-10 word subject.`,
      'Reply with ONLY a JSON array of strings, in the same order: no punctuation, no numbering, no markdown, no other text.',
      rules
    ].join('\n')
  }
}

/** A conversational reply instead of a name. `llm.oneshot` only fence-strips,
 *  so anything that ANSWERS the prompt is ours to reject. */
const ANSWER_SHAPED =
  /^(?:sure|certainly|of course|ofcourse|yes\b|no\b|here(?:'s|\s+is|\s+are)|i\s+(?:am|'m|m|will|'ll|would|could|can|have|'ve|had|was|cannot|can't)\b|as an ai|absolutely|definitely|okay\b|ok\b|当然|はい|是的|好的)/i

/**
 * One model-written subject, validated: quotes and a `Title:` prefix are
 * stripped (they are formatting, not wording), then anything that is not a
 * short, name-shaped phrase — more than 12 words, a question, an answer — is
 * refused outright. A refusal returns null and the caller keeps the derived
 * subject: a bad subject is worse than a plain one.
 */
export function validateModelSubject(raw: unknown): null | string {
  if (typeof raw !== 'string') {
    return null
  }

  const text = raw
    .replace(/```[A-Za-z]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
    .trim()
    .replace(/^(?:title|subject|name)\s*[:\-–—]\s*/i, '')
    .trim()

  if (!text || text.length > MAX_SUBJECT_CHARS) {
    return null
  }

  if (text.split(' ').length > MAX_SUBJECT_WORDS) {
    return null
  }

  // A subject names; it does not ask, answer, or announce itself.
  if (/[?:,;!]$/.test(text) || ANSWER_SHAPED.test(text)) {
    return null
  }

  return clipWords(text, 60)
}

/** Split one reply into `count` validated subjects. Accepts a JSON array (the
 *  instructed shape) or, failing that, a numbered/bulleted line list; every
 *  missing or refused slot comes back null so that row keeps its derivation. */
export function parseModelSubjects(reply: string, count: number): (null | string)[] {
  const cleaned = String(reply || '').replace(/```[A-Za-z]*/g, '')
  let items: unknown[] = []
  const array = cleaned.match(/\[[\s\S]*\]/)

  if (array) {
    try {
      const parsed: unknown = JSON.parse(array[0])

      if (Array.isArray(parsed)) {
        items = parsed
      }
    } catch {
      /* not the instructed shape — fall through to the line split */
    }
  }

  if (!items.length) {
    items = cleaned
      .split('\n')
      .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter(Boolean)
  }

  return Array.from({ length: count }, (_, index) => validateModelSubject(items[index]))
}

interface PendingSubject {
  key: string
  request: string
}

/** One batched RPC. Every failure is swallowed: the rows already render their
 *  derived subjects, and an offline gateway must not log a thing. */
async function requestSubjects(batch: readonly PendingSubject[]): Promise<void> {
  try {
    const { input, instructions } = subjectPrompt(batch.map(item => item.request))

    const reply = await host.request<{ text?: string }>('llm.oneshot', {
      input,
      instructions,
      max_tokens: TOKENS_PER_SUBJECT * batch.length,
      task: 'title_generation',
      temperature: 0
      // No session_id: the configured AUX backend answers, so this can never
      // perturb the conversation it is titling.
    })

    const subjects = parseModelSubjects(reply?.text ?? '', batch.length)
    const entries = { ...$activitySubjects.get().entries }
    const at = Date.now()

    batch.forEach((item, index) => {
      const subject = subjects[index]
      entries[item.key] = subject
        ? { at, source: 'model', subject }
        : // Refused: recorded so the same answer is never paid for twice.
          { at, source: 'rejected', subject: '' }
    })

    write(trimmed(entries))
  } catch {
    /* Transport/backend failure: no entry written, so a later mount retries —
     * the derived subject stands meanwhile. */
  } finally {
    for (const item of batch) {
      inFlight.delete(item.key)
    }
  }
}

/**
 * The Activity rows' subjects: `tasks` with any cached model subject merged
 * into its `subject` slot (same objects otherwise, so identity stays stable),
 * plus the batched upgrade for the VISIBLE tasks that have settled and have
 * never been asked.
 *
 * `messages` supplies the raw request text (the model's input and the cache
 * key's hash); `visible` is what is on screen — a collapsed Done list is not
 * worth a subject.
 */
export function useActivitySubjects(
  tasks: readonly ActivityTask[],
  messages: readonly ChatMessage[] | undefined,
  visible: readonly ActivityTask[]
): readonly ActivityTask[] {
  const layer = useValue($activitySubjects)

  /** Raw request text per task — read once per transcript change. */
  const requests = useMemo(() => {
    const byId = new Map<string, ChatMessage>()

    for (const message of messages ?? []) {
      byId.set(message.id, message)
    }

    const map = new Map<string, string>()

    for (const task of tasks) {
      const request = requestTextOf(byId.get(task.id))

      map.set(task.id, request)
    }

    return map
  }, [messages, tasks])

  /** The cache's answer, merged at render: the model subject lands in the
   *  slot `taskSubject` reads first, with no re-derivation anywhere. */
  const upgraded = useMemo(
    () =>
      tasks.map(task => {
        const entry = layer.entries[activitySubjectKey(task, requests.get(task.id) ?? '')]

        return entry?.source === 'model' && entry.subject
          ? { ...task, subject: entry.subject, subjectSource: 'model' as const }
          : task
      }),
    [layer.entries, requests, tasks]
  )

  /** Candidates for the next batch: settled, on screen, with a request to
   *  name, and never asked (no cache entry — accepted OR refused). */
  const pending = useMemo(
    () =>
      visible
        .filter(task => task.status !== 'running')
        .flatMap<PendingSubject>(task => {
          const request = requests.get(task.id) ?? ''

          if (!request || layer.entries[activitySubjectKey(task, request)]) {
            return []
          }

          return [{ key: activitySubjectKey(task, request), request: clipWords(request, REQUEST_CHARS) }]
        }),
    [layer.entries, requests, visible]
  )

  useEffect(() => {
    ensureActivitySubjects()
  }, [])

  useEffect(() => {
    if (!layer.ready) {
      return
    }

    const batch = pending.filter(item => !attempted.has(item.key) && !inFlight.has(item.key))

    if (!batch.length) {
      return
    }

    // Latched BEFORE the await: a re-render while the call is in flight
    // recomputes `pending` with the same keys and finds them taken.
    for (const item of batch) {
      attempted.add(item.key)
      inFlight.add(item.key)
    }

    void requestSubjects(batch)
  }, [layer.ready, pending])

  return upgraded
}

/** Test seam: forget the cached subjects and every latch, so the next mount
 *  hydrates and asks again. */
export function resetActivitySubjects(): void {
  cacheRevision++
  $activitySubjects.set({ entries: {}, ready: false })
  attempted.clear()
  inFlight.clear()
}
