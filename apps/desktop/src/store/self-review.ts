import { atom, computed } from 'nanostores'

import { desktopGit } from '@/lib/desktop-git'
import { requestOneShot } from '@/lib/oneshot'

import { $reviewFiles, $reviewOpen, $reviewScopeCwd, reviewRepoCwd } from './review'

/**
 * Agent self-review (roadmap #30): "Review changes" in the review pane runs a
 * SEPARATE utility-model pass over the working-tree diff — the `code_review`
 * one-shot template, never the live conversation — and lands the returned
 * comments as inline rows on the per-file diff view.
 *
 * Comments are only meaningful against the exact diff the model read, so each
 * file keeps the diff snapshot it was reviewed on and `selfReviewForFile`
 * serves comments only while the pane's diff still matches (a refresh that
 * changes the file simply hides stale rows rather than mis-anchoring them).
 */

export interface SelfReviewComment {
  /** One-line finding text (whitespace already collapsed). */
  body: string
  /** 1-based NEW-file line the comment anchors to. */
  line: number
  /** Repo-relative path, normalized to match `review.list` paths. */
  path: string
}

interface SelfReviewFile {
  comments: SelfReviewComment[]
  /** The diff text the review ran on; stale diffs get no comments. */
  diff: string
}

export interface SelfReviewState {
  error: null | string
  files: Record<string, SelfReviewFile>
  status: 'done' | 'error' | 'idle' | 'running'
}

const IDLE: SelfReviewState = { error: null, files: {}, status: 'idle' }

export const $selfReview = atom<SelfReviewState>(IDLE)
export const $selfReviewRunning = computed($selfReview, state => state.status === 'running')

// The model is asked for <= 12 but the parser stays defensive about overrun.
const MAX_COMMENTS = 24
const MAX_COMMENT_CHARS = 300
const MAX_FILES = 24
const MAX_FILE_DIFF_CHARS = 16_000

/** Parse the model's response into comments; liberal about fences/prologue,
 *  strict about the row shape. Never throws — a malformed reply means "no
 *  comments", not a dead pane. */
export function parseSelfReviewResponse(text: string): SelfReviewComment[] {
  const trimmed = text.trim()

  if (!trimmed) {
    return []
  }

  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')

  if (start < 0 || end <= start) {
    return []
  }

  let raw: unknown

  try {
    raw = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return []
  }

  if (!Array.isArray(raw)) {
    return []
  }

  const out: SelfReviewComment[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const { body, line, path } = item as Record<string, unknown>

    if (typeof path !== 'string' || typeof body !== 'string' || !body.trim()) {
      continue
    }

    const lineNo = typeof line === 'number' && Number.isFinite(line) ? Math.max(1, Math.floor(line)) : 1

    out.push({
      body: body.replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT_CHARS),
      line: lineNo,
      path: path.trim()
    })

    if (out.length >= MAX_COMMENTS) {
      break
    }
  }

  return out
}

/** Match a model-named path back to the review list — it may echo `a/`/`b/`
 *  prefixes or `./` even though the payload headers carried the bare path. */
function resolveFilePath(named: string, known: readonly string[]): null | string {
  const target = named
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^[ab]\//, '')
    .replace(/\/+$/, '')

  if (!target) {
    return null
  }

  for (const candidate of known) {
    const normalized = candidate.replace(/\\/g, '/')

    if (normalized === target || normalized.endsWith(`/${target}`) || target.endsWith(`/${normalized}`)) {
      return candidate
    }
  }

  return null
}

/** Comments for one file, only while the shown diff is the reviewed one. */
export function selfReviewForFile(path: string, diff: null | string): SelfReviewComment[] {
  const entry = $selfReview.get().files[path]

  if (!entry || diff == null || entry.diff !== diff) {
    return []
  }

  return entry.comments
}

let selfReviewSeq = 0

/** Reset every result + drop any in-flight answer. */
export function clearSelfReview(): void {
  selfReviewSeq += 1
  $selfReview.set(IDLE)
}

/**
 * Run the utility-model pass over every changed file's diff and publish the
 * comments. Throws so the caller can toast; a fresh run or a pane close
 * discards a late answer via `selfReviewSeq`.
 */
export async function runSelfReview(): Promise<void> {
  const cwd = reviewRepoCwd()
  const review = desktopGit()?.review
  const files = $reviewFiles.get()

  if (!cwd || !review || files.length === 0) {
    throw new Error('Nothing to review')
  }

  const seq = (selfReviewSeq += 1)
  const live = () => seq === selfReviewSeq

  $selfReview.set({ error: null, files: {}, status: 'running' })

  try {
    const capped = files.slice(0, MAX_FILES)

    const diffs = await Promise.all(
      capped.map(file => review.diff(cwd, file.path, 'uncommitted', null, file.staged).catch(() => ''))
    )

    if (!live()) {
      return
    }

    const parts: string[] = []
    const diffByPath = new Map<string, string>()

    for (const [index, file] of capped.entries()) {
      const diff = diffs[index] ?? ''

      if (!diff.trim()) {
        continue
      }

      diffByPath.set(file.path, diff)
      parts.push(
        `=== ${file.path} ===\n${
          diff.length > MAX_FILE_DIFF_CHARS ? `${diff.slice(0, MAX_FILE_DIFF_CHARS)}\n…(file truncated)` : diff
        }`
      )
    }

    if (parts.length === 0) {
      $selfReview.set({ error: null, files: {}, status: 'done' })

      return
    }

    const text = await requestOneShot({
      maxTokens: 2048,
      task: 'code_review',
      temperature: 0.2,
      template: 'code_review',
      variables: { diff: parts.join('\n') }
    })

    if (!live()) {
      return
    }

    const comments = parseSelfReviewResponse(text)
    const known = capped.map(file => file.path)
    const grouped: Record<string, SelfReviewFile> = {}

    for (const comment of comments) {
      const path = resolveFilePath(comment.path, known)

      if (!path || !diffByPath.has(path)) {
        continue
      }

      const entry = grouped[path] ?? { comments: [], diff: diffByPath.get(path) ?? '' }
      entry.comments.push({ ...comment, path })
      grouped[path] = entry
    }

    $selfReview.set({ error: null, files: grouped, status: 'done' })
  } catch (error) {
    if (live()) {
      $selfReview.set({ error: error instanceof Error ? error.message : String(error), files: {}, status: 'error' })
    }

    throw error
  }
}

// Comments are pane-session state: closing the review pane or re-pinning it to
// another worktree retires them (the next open re-runs the review).
let lastScope: null | string = $reviewScopeCwd.get()

$reviewScopeCwd.subscribe(scope => {
  if (scope !== lastScope) {
    lastScope = scope
    clearSelfReview()
  }
})

$reviewOpen.subscribe(open => {
  if (!open) {
    clearSelfReview()
  }
})
