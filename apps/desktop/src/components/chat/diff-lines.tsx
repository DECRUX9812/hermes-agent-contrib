'use client'

import * as React from 'react'
import type { BundledLanguage, ShikiTransformer, ThemedToken } from 'shiki'

import { chunkLines, type LineChunk, useFixedRowWindow } from '@/components/chat/fixed-row-window'
import { exceedsHighlightBudget, SHIKI_THEME } from '@/components/chat/shiki-highlighter'
import { ErrorBoundary } from '@/components/error-boundary'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { shikiLanguageForFilename } from '@/lib/markdown-code'
import { cn } from '@/lib/utils'

/**
 * Renders a unified diff for a tool's file edit. Two paths share one parse:
 *  - `SyntaxDiff` highlights the change *content* in the file's language via
 *    Shiki, then a per-line transformer paints the add/remove tint on top.
 *  - `DiffLines` is the color-only fallback (no language, over budget, or while
 *    Shiki loads).
 * Both drop git file-headers + `@@` hunk noise and the `+/-` gutter so changes
 * read by color + a 2px gutter accent, the way Cursor does.
 */
type DiffKind = 'add' | 'comment' | 'context' | 'remove'

export interface DiffLine {
  kind: DiffKind
  text: string
  /** 1-based line number in the old/new file (absent on the "other" side of an
   *  add/remove, and on hunk-separator blanks). Only used when line numbers are
   *  shown (the preview's full diff). */
  newNo?: number
  oldNo?: number
}

interface ParsedHunk {
  lines: Array<{ kind: DiffKind; text: string }>
  newStart: number
  oldStart: number
}

// Tint + 2px gutter accent per change kind. Text color is included for the
// plain renderer; the Shiki path omits it so syntax colors win, layering only
// the background + border. 'comment' rows are self-review findings anchored
// under the line they name.
const DIFF_KIND_TINT: Record<DiffKind, string> = {
  add: 'border-(--ui-diff-add-border) bg-(--ui-diff-add-background)',
  comment: 'border-(--ui-accent-secondary) bg-(--ui-sash-hover-background)',
  context: 'border-transparent',
  remove: 'border-(--ui-diff-remove-border) bg-(--ui-diff-remove-background)'
}

const DIFF_KIND_TEXT: Record<DiffKind, string> = {
  add: 'text-(--ui-diff-add-foreground)',
  comment: 'text-(--ui-text-secondary) italic',
  context: '',
  remove: 'text-(--ui-diff-remove-foreground)'
}

const DIFF_LINE_BASE = 'block min-w-max whitespace-pre border-l-2 px-2.5 py-px'
const PREVIEW_DIFF_LINE_BASE = 'block h-5 min-w-max whitespace-pre px-2.5 leading-5'
const PREVIEW_CHUNK_LINES = 200
const PREVIEW_LINE_PX = 20
const PREVIEW_OVERSCAN_LINES = 400

// Bleed out of the tool-card body's `p-1.5` so tints/borders run flush to the
// card edges (rounded corners clip via the card's overflow); compact height
// with internal scroll like a code block.
// `overscroll-y-auto` so reaching the box's top/bottom hands the wheel back to
// the page (no scroll-trap); `overscroll-x-contain` keeps a trackpad's sideways
// overscroll on long code lines from firing browser back/forward navigation.
const DIFF_BOX_CLASS =
  '-mx-1.5 -mb-1.5 max-h-[12rem] max-w-none min-w-0 overflow-auto overscroll-x-contain overscroll-y-auto font-mono text-[0.7rem] leading-relaxed text-(--ui-text-secondary)'

function diffKind(line: string): DiffKind {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'add'
  }

  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'remove'
  }

  return 'context'
}

// Drop the leading +/-/space gutter so changes read by color alone, keeping the
// rest of the indentation intact.
function stripDiffMarker(line: string): string {
  if (diffKind(line) !== 'context' || line.startsWith(' ')) {
    return line.slice(1)
  }

  return line
}

// Git-style unified diffs arrive with a file-header preamble — `diff --git`,
// `index …`, `--- a/path`, `+++ b/path`, and Hermes' own `a/path → b/path`
// arrow line. That preamble just repeats the path (which the tool row already
// shows) and reads especially badly for absolute paths (`a//Users/…`). Strip
// the leading header zone up to the first hunk.
const DIFF_HEADER_PREFIXES = [
  'diff --git',
  'index ',
  '--- ',
  '+++ ',
  'similarity ',
  'rename ',
  'new file',
  'deleted file'
]

function isArrowHeaderLine(line: string): boolean {
  const trimmed = line.trim()

  return trimmed.includes('→') && /^\S.*→\s*\S+$/.test(trimmed) && !/^[+\-@]/.test(trimmed)
}

/** Exported for tests. */
export function stripDiffFileHeaders(diff: string): string {
  const lines = diff.split('\n')
  let start = 0

  for (; start < lines.length; start += 1) {
    const line = lines[start]

    if (line.startsWith('@@')) {
      break
    }

    if (line.trim() === '' || isArrowHeaderLine(line) || DIFF_HEADER_PREFIXES.some(prefix => line.startsWith(prefix))) {
      continue
    }

    break
  }

  return lines.slice(start).join('\n')
}

function parseHunks(diff: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = []
  let active: null | ParsedHunk = null

  for (const line of stripDiffFileHeaders(diff).split('\n')) {
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)

      if (!match) {
        active = null

        continue
      }

      active = { oldStart: Number(match[1]), newStart: Number(match[2]), lines: [] }
      hunks.push(active)

      continue
    }

    if (!active || line.startsWith('\\')) {
      continue
    }

    active.lines.push({ kind: diffKind(line), text: stripDiffMarker(line) })
  }

  return hunks
}

// Cleaned diff → renderable lines: file-headers + `@@` hunks dropped (a blank
// separator kept between hunks), markers stripped, kind recorded. Old/new line
// numbers are tracked from each `@@ -a,b +c,d @@` header so a caller that wants
// a gutter (the preview) can render them; the blank separator carries none.
/** Exported for tests. */
export function parseDiff(diff: string): DiffLine[] {
  const hunks = parseHunks(diff)

  if (hunks.length === 0) {
    // Fallback for unexpected non-hunk payloads.
    return stripDiffFileHeaders(diff)
      .split('\n')
      .map(line => ({ kind: diffKind(line), text: stripDiffMarker(line) }))
  }

  const out: DiffLine[] = []
  let emitted = false
  let oldNo = 1
  let newNo = 1

  for (const hunk of hunks) {
    oldNo = hunk.oldStart
    newNo = hunk.newStart

    if (emitted) {
      out.push({ kind: 'context', text: '' })
    }

    for (const line of hunk.lines) {
      const entry: DiffLine = { kind: line.kind, text: line.text }

      if (line.kind === 'add') {
        entry.newNo = newNo++
      } else if (line.kind === 'remove') {
        entry.oldNo = oldNo++
      } else {
        entry.oldNo = oldNo++
        entry.newNo = newNo++
      }

      out.push(entry)
      emitted = true
    }
  }

  return out
}

// Build a full-file diff view anchored to the CURRENT file text. Every current
// line is emitted from `fullText` with its real new-file line number; hunks only
// mark those rows as added and insert deleted rows between them. That keeps the
// preview's SOURCE and DIFF views on the same line map even when git returns
// compact hunks or removed-only rows.
function parseFullFileDiff(diff: string, fullText: string): DiffLine[] {
  const hunks = parseHunks(diff)
  const fullLines = fullText.split('\n')

  if (hunks.length === 0) {
    return fullLines.map((text, index) => ({ kind: 'context', newNo: index + 1, oldNo: index + 1, text }))
  }

  const added = new Set<number>()
  const oldNoByNewNo = new Map<number, number>()
  const removalsByNewNo = new Map<number, DiffLine[]>()
  const out: DiffLine[] = []

  for (const hunk of hunks) {
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart

    for (const line of hunk.lines) {
      if (line.kind === 'add') {
        added.add(newNo)
        newNo += 1
      } else if (line.kind === 'remove') {
        const anchor = Math.max(1, Math.min(newNo, fullLines.length + 1))
        const bucket = removalsByNewNo.get(anchor) ?? []

        bucket.push({ kind: 'remove', oldNo, text: line.text })
        removalsByNewNo.set(anchor, bucket)
        oldNo += 1
      } else {
        oldNoByNewNo.set(newNo, oldNo)
        oldNo += 1
        newNo += 1
      }
    }
  }

  for (let index = 0; index < fullLines.length; index += 1) {
    const newNo = index + 1
    const removals = removalsByNewNo.get(newNo)

    if (removals) {
      out.push(...removals)
    }

    out.push({
      kind: added.has(newNo) ? 'add' : 'context',
      newNo,
      oldNo: oldNoByNewNo.get(newNo),
      text: fullLines[index] ?? ''
    })
  }

  const trailingRemovals = removalsByNewNo.get(fullLines.length + 1)

  if (trailingRemovals) {
    out.push(...trailingRemovals)
  }

  return out
}

/** Exported for the lazily-loaded SyntaxDiff (syntax-diff.tsx). */
/** One review comment row — fixed 20px like its neighbours so windowed diffs
 *  keep their scroll math; long bodies ellipsize inside `max-w-[80ch]`. */
function CommentRow({ line }: { line: DiffLine }) {
  return (
    <span
      className={cn(
        'block h-5 max-w-[80ch] truncate whitespace-nowrap px-2.5 leading-5',
        DIFF_KIND_TINT.comment,
        DIFF_KIND_TEXT.comment
      )}
      title={line.text}
    >
      <Codicon className="mr-1.5 opacity-60" name="comment" size="0.75rem" />
      {line.text}
    </span>
  )
}

/** A review comment to splice under the diff line it names (`line` is the
 *  1-based NEW-file line number). */
export interface DiffComment {
  body: string
  line: number
}

/** A user-authored comment anchored to a diff line range (1-based NEW-file
 *  line numbers; removed rows anchor by their old-file number). */
export interface DiffLineComment {
  endLine: number
  startLine: number
  text: string
}

// The line a user comment anchors to: the new-file number where one exists,
// else the removed row's old-file number (there is no new-file line to name).
const commentAnchorLine = (line: DiffLine): number | undefined => line.newNo ?? line.oldNo

/** Hover affordance on a commentable diff row — a '+' that starts a comment
 *  (shift-click extends the anchored range), matching hosted-review UX. */
function LineCommentButton({
  anchor,
  onAnchor
}: {
  anchor: number
  onAnchor: (anchor: number, extend: boolean) => void
}) {
  const { t } = useI18n()

  return (
    <button
      aria-label={t.statusStack.coding.commentOnLine(anchor)}
      className="absolute inset-y-0 left-0 hidden w-4 items-center justify-center text-muted-foreground/80 hover:text-(--ui-text-secondary) group-hover/dr:flex"
      onClick={event => onAnchor(anchor, event.shiftKey)}
      type="button"
    >
      <Codicon name="add" size="0.6rem" />
    </button>
  )
}

/** One windowed diff row: the line text (or its Shiki tokens) plus, when the
 *  panel opted into commenting, a hover '+' anchored to this line. */
function WindowedRow({
  line,
  onLineAnchor,
  tokens
}: {
  line: DiffLine
  onLineAnchor?: (anchor: number, extend: boolean) => void
  tokens?: ThemedToken[]
}) {
  const anchor = onLineAnchor ? commentAnchorLine(line) : undefined

  return (
    <span
      className={cn(PREVIEW_DIFF_LINE_BASE, DIFF_KIND_TINT[line.kind], anchor !== undefined && 'group/dr relative')}
    >
      {anchor !== undefined && onLineAnchor && <LineCommentButton anchor={anchor} onAnchor={onLineAnchor} />}
      {tokens && tokens.length > 0
        ? tokens.map((token, tokenIndex) => (
            <span key={`${tokenIndex}-${token.offset}`} style={tokenStyle(token)}>
              {token.content}
            </span>
          ))
        : line.text || ' '}
    </span>
  )
}

/**
 * Interleave self-review comments into parsed diff rows as 'comment' lines,
 * each anchored directly below the deepest-parsed row carrying its new-file
 * line number. Comments naming a removed line fall back to the removed row
 * (`oldNo`); anything else unanchored is dropped. Returns `lines` unchanged
 * when there is nothing to splice.
 */
export function insertDiffComments(lines: DiffLine[], comments: readonly DiffComment[]): DiffLine[] {
  if (comments.length === 0 || lines.length === 0) {
    return lines
  }

  const byNewLine = new Map<number, string[]>()

  for (const comment of comments) {
    const body = comment.body.replace(/\s+/g, ' ').trim()

    if (!body || !Number.isFinite(comment.line) || comment.line < 1) {
      continue
    }

    const bucket = byNewLine.get(comment.line)

    if (bucket) {
      bucket.push(body)
    } else {
      byNewLine.set(comment.line, [body])
    }
  }

  if (byNewLine.size === 0) {
    return lines
  }

  const out: DiffLine[] = []

  for (const line of lines) {
    out.push(line)

    const anchor = line.newNo
    const bodies = anchor === undefined ? undefined : byNewLine.get(anchor)

    if (anchor !== undefined && bodies) {
      for (const body of bodies) {
        out.push({ kind: 'comment', text: body })
      }

      byNewLine.delete(anchor)
    }
  }

  // Leftovers target lines the new file no longer shows in this diff (removed
  // regions): anchor them under the removed row they name instead of dropping.
  if (byNewLine.size > 0) {
    for (let i = 0; i < out.length; i += 1) {
      const line = out[i]

      if (line.kind !== 'remove' || line.oldNo === undefined) {
        continue
      }

      const bodies = byNewLine.get(line.oldNo)

      if (!bodies) {
        continue
      }

      const rows: DiffLine[] = bodies.map(body => ({ kind: 'comment', text: body }))

      out.splice(i + 1, 0, ...rows)
      byNewLine.delete(line.oldNo)
      i += rows.length
    }
  }

  return out
}

export function DiffBody({ lines, syntax }: { lines: DiffLine[]; syntax?: boolean }) {
  return (
    <>
      {lines.map((line, index) =>
        line.kind === 'comment' ? (
          <CommentRow key={`${index}-${line.text}`} line={line} />
        ) : (
          <span
            className={cn(DIFF_LINE_BASE, DIFF_KIND_TINT[line.kind], !syntax && DIFF_KIND_TEXT[line.kind])}
            key={`${index}-${line.text}`}
          >
            {line.text || ' '}
          </span>
        )
      )}
    </>
  )
}

// shiki FontStyle is a bitmask: Italic=1, Bold=2, Underline=4.
function tokenStyle({ bgColor, color, fontStyle = 0 }: ThemedToken): React.CSSProperties | undefined {
  if (!color && !bgColor && !fontStyle) {
    return undefined
  }

  return {
    backgroundColor: bgColor,
    color,
    fontStyle: fontStyle & 1 ? 'italic' : undefined,
    fontWeight: fontStyle & 2 ? 700 : undefined,
    textDecorationLine: fontStyle & 4 ? 'underline' : undefined
  }
}

function useThemeName() {
  const current = () => (document.documentElement.classList.contains('dark') ? SHIKI_THEME.dark : SHIKI_THEME.light)
  const [theme, setTheme] = React.useState(current)

  React.useEffect(() => {
    const observer = new MutationObserver(() => setTheme(current()))

    observer.observe(document.documentElement, { attributeFilter: ['class'], attributes: true })

    return () => observer.disconnect()
  }, [])

  return theme
}

function PreviewDiffRows({
  afterLines = 0,
  beforeLines = 0,
  chunks,
  onLineAnchor,
  tokens
}: {
  afterLines?: number
  beforeLines?: number
  chunks: Array<LineChunk<DiffLine>>
  onLineAnchor?: (anchor: number, extend: boolean) => void
  tokens?: ThemedToken[][] | null
}) {
  return (
    <>
      {beforeLines > 0 && <div aria-hidden style={{ height: beforeLines * PREVIEW_LINE_PX }} />}
      {chunks.map(chunk => (
        <div className="block" key={chunk.start}>
          {chunk.lines.map((line, offset) => {
            const index = chunk.start + offset

            if (line.kind === 'comment') {
              return <CommentRow key={`${index}-${line.text}`} line={line} />
            }

            return (
              <WindowedRow
                key={`${index}-${line.text}`}
                line={line}
                onLineAnchor={onLineAnchor}
                tokens={tokens?.[index] ?? []}
              />
            )
          })}
        </div>
      ))}
      {afterLines > 0 && <div aria-hidden style={{ height: afterLines * PREVIEW_LINE_PX }} />}
    </>
  )
}

function TokenizedDiffBody({
  afterLines,
  beforeLines,
  chunked = false,
  chunks,
  language,
  lines,
  onLineAnchor
}: {
  afterLines?: number
  beforeLines?: number
  chunked?: boolean
  chunks?: Array<LineChunk<DiffLine>>
  language: string
  lines: DiffLine[]
  onLineAnchor?: (anchor: number, extend: boolean) => void
}) {
  const code = React.useMemo(() => lines.map(line => line.text).join('\n'), [lines])
  const theme = useThemeName()
  const [tokens, setTokens] = React.useState<ThemedToken[][] | null>(null)

  React.useEffect(() => {
    let cancelled = false

    setTokens(null)
    // Dynamic import so the multi-MB shiki chunk stays off the cold-start
    // path — this effect only runs once a highlightable diff is on screen.
    void import('shiki')
      .then(({ codeToTokens }) => codeToTokens(code, { lang: language as BundledLanguage, theme }))
      .then(result => {
        if (!cancelled) {
          setTokens(result.tokens)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTokens([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [code, language, theme])

  if (!tokens) {
    return chunked ? (
      <PreviewDiffRows
        afterLines={afterLines}
        beforeLines={beforeLines}
        chunks={chunks ?? chunkLines(lines, PREVIEW_CHUNK_LINES)}
        onLineAnchor={onLineAnchor}
      />
    ) : (
      <DiffBody lines={lines} />
    )
  }

  if (chunked) {
    return (
      <PreviewDiffRows
        afterLines={afterLines}
        beforeLines={beforeLines}
        chunks={chunks ?? chunkLines(lines, PREVIEW_CHUNK_LINES)}
        onLineAnchor={onLineAnchor}
        tokens={tokens}
      />
    )
  }

  return (
    <>
      {lines.map((line, index) => {
        if (line.kind === 'comment') {
          return <CommentRow key={`${index}-${line.text}`} line={line} />
        }

        return <WindowedRow key={`${index}-${line.text}`} line={line} tokens={tokens[index] ?? []} />
      })}
    </>
  )
}

// Shiki transformer: tag each `.line` with the diff tint for its kind, so the
// syntax-highlighted output keeps add/remove backgrounds + the gutter accent.
// Exported for the lazily-loaded SyntaxDiff (syntax-diff.tsx).
export function diffLineTransformer(kinds: DiffKind[]): ShikiTransformer {
  return {
    line(node, line) {
      const kind = kinds[line - 1] ?? 'context'

      const existing = Array.isArray(node.properties.className)
        ? (node.properties.className as string[])
        : node.properties.className
          ? [String(node.properties.className)]
          : []

      node.properties.className = [...existing, DIFF_LINE_BASE, DIFF_KIND_TINT[kind]]
    }
  }
}

function SyntaxDiff({ language, lines }: { language: string; lines: DiffLine[] }) {
  // The Shiki hook lives in a lazily-loaded module (syntax-diff.tsx) so the
  // multi-MB shiki chunk stays off the cold-start path. Until it (and the
  // highlight itself) resolves, show the plain colored diff — no flash.
  //
  // A rejected dynamic import (e.g. a packaged app whose renderer window is
  // pointed at the asar copy of dist/ while the chunk only exists in
  // app.asar.unpacked, #93479) throws past Suspense, which only covers the
  // pending state. Without a local boundary that throw reaches the workspace
  // ContribBoundary and blanks the whole pane instead of just this diff.
  return (
    <ErrorBoundary fallback={() => <DiffBody lines={lines} />} label="syntax-diff">
      <React.Suspense fallback={<DiffBody lines={lines} />}>
        <LazySyntaxDiff language={language} lines={lines} />
      </React.Suspense>
    </ErrorBoundary>
  )
}

const LazySyntaxDiff = React.lazy(() => import('./syntax-diff'))

interface DiffLinesProps extends Omit<React.ComponentProps<'pre'>, 'children'> {
  text: string
}

export function DiffLines({ className, text, ...props }: DiffLinesProps) {
  const lines = React.useMemo(() => parseDiff(text), [text])

  return (
    <pre className={cn(DIFF_BOX_CLASS, className)} data-slot="diff-lines" {...props}>
      <DiffBody lines={lines} />
    </pre>
  )
}

// Coalesce consecutive same-kind changed rows into runs, each placed by line
// fraction (no DOM measurement). Context rows produce no tick.
function overviewRuns(lines: DiffLine[]): { kind: 'add' | 'remove'; sizePct: number; startPct: number }[] {
  const total = lines.length || 1
  const runs: { kind: 'add' | 'remove'; sizePct: number; startPct: number }[] = []

  for (let i = 0; i < lines.length;) {
    const kind = lines[i].kind

    if (kind !== 'add' && kind !== 'remove') {
      i += 1

      continue
    }

    let j = i + 1

    while (j < lines.length && lines[j].kind === kind) {
      j += 1
    }

    runs.push({ kind, sizePct: ((j - i) / total) * 100, startPct: (i / total) * 100 })
    i = j
  }

  return runs
}

// VS Code-style overview ruler: a thin strip pinned to the diff's right edge with
// a green/red tick per change, positioned by line fraction. Pinned to the
// viewport (not the scrolled content) by living as an absolute sibling of the
// scroller inside a relative wrapper — so no scroll listener or measurement.
function DiffOverviewRuler({ lines }: { lines: DiffLine[] }) {
  const runs = React.useMemo(() => overviewRuns(lines), [lines])

  if (runs.length === 0) {
    return null
  }

  return (
    <div aria-hidden className="pointer-events-none absolute top-0 right-0 bottom-0 w-1.5 opacity-80">
      {/* Cap the tick field to the diff's natural height (rows × line px) so a
          short diff renders thin, line-aligned ticks instead of stretching a few
          changes into gross full-height blocks. A long diff hits the 100% cap and
          compresses into a true overview. */}
      <div className="relative w-full" style={{ height: `min(100%, ${lines.length * PREVIEW_LINE_PX}px)` }}>
        {runs.map((run, index) => (
          <div
            className={cn(
              'absolute inset-x-0',
              run.kind === 'add' ? 'bg-(--ui-diff-add-border)' : 'bg-(--ui-diff-remove-border)'
            )}
            key={index}
            style={{ height: `max(0.125rem, ${run.sizePct}%)`, top: `${run.startPct}%` }}
          />
        ))}
      </div>
    </div>
  )
}

/** Bottom bar for a user-authored diff comment: names the anchored line
 *  range and collects the feedback text. Enter submits, Esc cancels — it
 *  never sends anything itself; the caller owns where the draft lands. */
function DiffCommentBar({
  anchor,
  path,
  onCancel,
  onSubmit
}: {
  anchor: { end: number; start: number }
  path?: string
  onCancel: () => void
  onSubmit: (text: string) => void
}) {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const [text, setText] = React.useState('')
  const start = Math.min(anchor.start, anchor.end)
  const end = Math.max(anchor.start, anchor.end)
  const label = `${displayPath(path) || ''}:${start === end ? start : `${start}-${end}`}`

  return (
    <div className="flex items-center gap-1.5 border-t border-(--ui-stroke-secondary) px-2 py-1">
      <span className="shrink-0 truncate font-mono text-[0.62rem] text-muted-foreground/70">{label}</span>
      <input
        autoFocus
        className="min-w-0 flex-1 bg-transparent text-[0.7rem] text-(--ui-text-secondary) outline-none placeholder:text-muted-foreground/50"
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && text.trim()) {
            onSubmit(text.trim())
          } else if (event.key === 'Escape') {
            onCancel()
          }
        }}
        placeholder={c.diffCommentPlaceholder}
        value={text}
      />
      <Tip label={c.diffCommentSend}>
        <Button
          aria-label={c.diffCommentSend}
          className="size-5"
          disabled={!text.trim()}
          onClick={() => onSubmit(text.trim())}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name="check" size="0.75rem" />
        </Button>
      </Tip>
      <Tip label={t.common.cancel}>
        <Button aria-label={t.common.cancel} className="size-5" onClick={onCancel} size="icon-xs" variant="ghost">
          <Codicon name="close" size="0.75rem" />
        </Button>
      </Tip>
    </div>
  )
}

interface FileDiffPanelProps {
  /** Override the default (tool-card) box styling — the full-height preview
   *  cancels the bleed/clamp so the diff fills its pane. */
  className?: string
  /** Self-review comments to splice under the lines they name. */
  comments?: readonly DiffComment[]
  diff: string
  /** Current file text. When provided, the panel expands hunked diffs into a
   *  full-file view so unchanged lines are preserved between hunks. */
  fullText?: string
  /** Opt-in per-line commenting (the review pane's diff → composer feedback):
   *  rows get a hover '+' anchor and a bottom editor bar. Only mounted on the
   *  windowed path — compact tool-card diffs stay read-only. */
  onDiffComment?: (comment: DiffLineComment) => void
  path?: string
  /** Render an old/new line-number gutter (the full preview diff). The compact
   *  tool-card + inline review diff leave this off. */
  showLineNumbers?: boolean
  /** Window the rows (fixed-row virtualization) WITHOUT a gutter — for a large
   *  diff in a scrolling pane (the review panel), so only visible rows mount
   *  instead of highlighting every line. `showLineNumbers` implies windowing. */
  virtualized?: boolean
}

export function FileDiffPanel({
  className,
  comments,
  diff,
  fullText,
  onDiffComment,
  path,
  showLineNumbers = false,
  virtualized = false
}: FileDiffPanelProps) {
  const lines = React.useMemo(
    () => insertDiffComments(fullText != null ? parseFullFileDiff(diff, fullText) : parseDiff(diff), comments ?? []),
    [comments, diff, fullText]
  )

  // The open comment anchor: click '+' on a row to anchor, shift-click another
  // to extend the range. A file/diff swap drops it so a stale range can't
  // submit against the wrong lines.
  const [commentAnchor, setCommentAnchor] = React.useState<null | { end: number; start: number }>(null)

  React.useEffect(() => setCommentAnchor(null), [diff, path])

  const onLineAnchor = React.useCallback((line: number, extend: boolean) => {
    setCommentAnchor(current => (extend && current ? { ...current, end: line } : { end: line, start: line }))
  }, [])

  const lineChunks = React.useMemo(() => chunkLines(lines, PREVIEW_CHUNK_LINES), [lines])

  const { afterRows, beforeRows, endChunk, onScroll, scrollerRef, startChunk } = useFixedRowWindow({
    overscanRows: PREVIEW_OVERSCAN_LINES,
    rowPx: PREVIEW_LINE_PX,
    rowsPerChunk: PREVIEW_CHUNK_LINES,
    totalRows: lines.length
  })

  const visibleLineChunks = lineChunks.slice(startChunk, endChunk + 1)

  const language = shikiLanguageForFilename(path)
  const canHighlight = Boolean(language) && !exceedsHighlightBudget(fullText ?? diff)
  const windowed = showLineNumbers || virtualized

  // Windowed: we own fixed-height rows and render only the visible chunks, so a
  // large diff never mounts (or Shiki-highlights) every line. Compact tool cards
  // are small/clamped, so they let Shiki own the rows (SyntaxDiff).
  const anchoredAnchor = onDiffComment ? onLineAnchor : undefined

  const windowedBody = canHighlight ? (
    <TokenizedDiffBody
      afterLines={afterRows}
      beforeLines={beforeRows}
      chunked
      chunks={visibleLineChunks}
      language={language}
      lines={lines}
      onLineAnchor={anchoredAnchor}
    />
  ) : (
    <PreviewDiffRows
      afterLines={afterRows}
      beforeLines={beforeRows}
      chunks={visibleLineChunks}
      onLineAnchor={anchoredAnchor}
    />
  )

  const compactBody = !canHighlight ? (
    <DiffBody lines={lines} />
  ) : fullText != null ? (
    <TokenizedDiffBody language={language} lines={lines} />
  ) : (
    <SyntaxDiff language={language} lines={lines} />
  )

  if (!windowed) {
    return (
      <div className={cn(DIFF_BOX_CLASS, className)} data-slot="file-diff-panel">
        {compactBody}
      </div>
    )
  }

  // Windowed: a fixed-row scroller renders only the visible rows (killing the
  // full-Shiki-of-every-line freeze on large diffs). With `showLineNumbers` a
  // VS Code-style gutter (new number for context/adds, old for removals) sits in
  // a left column; the scroller owns scroll so the overview ruler (an absolute
  // sibling) stays viewport-fixed.
  return (
    <div className={cn(DIFF_BOX_CLASS, 'relative overflow-hidden', className)} data-slot="file-diff-panel">
      <div
        className={cn('absolute inset-0 overflow-auto', showLineNumbers && 'pr-2.5')}
        onScroll={onScroll}
        ref={scrollerRef}
      >
        {showLineNumbers ? (
          <div className="grid min-w-max grid-cols-[auto_minmax(0,1fr)]">
            <div
              className="sticky left-0 z-1 select-none bg-(--ui-editor-surface-background) py-3 text-muted-foreground/55"
              // Masks the code scrolling horizontally beneath it, so it has to
              // stay opaque when window glass thins the field. See
              // `[data-glass-opaque]` in styles.css.
              data-glass-opaque=""
            >
              {beforeRows > 0 && <div aria-hidden style={{ height: beforeRows * PREVIEW_LINE_PX }} />}
              {visibleLineChunks.map(chunk => (
                <div className="block" key={chunk.start}>
                  {chunk.lines.map((line, offset) => {
                    const index = chunk.start + offset

                    return (
                      <div
                        className="h-5 w-9 pr-2 text-right leading-5 tabular-nums"
                        key={`${index}-${line.oldNo}-${line.newNo}`}
                      >
                        {line.newNo ?? ''}
                      </div>
                    )
                  })}
                </div>
              ))}
              {afterRows > 0 && <div aria-hidden style={{ height: afterRows * PREVIEW_LINE_PX }} />}
            </div>
            <div className="min-w-0">{windowedBody}</div>
          </div>
        ) : (
          <div className="min-w-0">{windowedBody}</div>
        )}
      </div>
      {commentAnchor && onDiffComment && (
        <DiffCommentBar
          anchor={commentAnchor}
          onCancel={() => setCommentAnchor(null)}
          onSubmit={text => {
            onDiffComment({
              endLine: Math.max(commentAnchor.start, commentAnchor.end),
              startLine: Math.min(commentAnchor.start, commentAnchor.end),
              text
            })
            setCommentAnchor(null)
          }}
          path={path}
        />
      )}
      <DiffOverviewRuler lines={lines} />
    </div>
  )
}
