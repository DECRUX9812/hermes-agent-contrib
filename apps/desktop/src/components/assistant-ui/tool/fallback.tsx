'use client'

import { type ToolCallMessagePartProps, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import {
  Children,
  createContext,
  type FC,
  Fragment,
  type PropsWithChildren,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { AnsiText } from '@/components/assistant-ui/ansi-text'
import { MarkdownImage } from '@/components/assistant-ui/markdown-text'
import { SET_THEME_TOOL, setThemeCall } from '@/components/assistant-ui/theme-picker/args'
import { TimelineTimestamp } from '@/components/assistant-ui/thread/timeline-timestamp'
import { toolCardView, ToolStepPill } from '@/components/assistant-ui/tool-cards'
import { useElapsedSeconds } from '@/components/chat/activity-timer'
import { ActivityTimerText } from '@/components/chat/activity-timer-text'
import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { FileDiffPanel } from '@/components/chat/diff-lines'
import { DisclosureRow } from '@/components/chat/disclosure-row'
import {
  SCAFFOLD_GLYPH_CLASS,
  SCAFFOLD_LABEL_CLASS,
  SCAFFOLD_META_CLASS
} from '@/components/chat/scaffold-row'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { CopyButton } from '@/components/ui/copy-button'
import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { FadeText } from '@/components/ui/fade-text'
import { FileTypeIcon } from '@/components/ui/file-type-icon'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { ToolIcon } from '@/components/ui/tool-icon'
import { useI18n } from '@/i18n'
import { connectorCalls, mcpTargets } from '@/lib/connector-tools'
import { PrettyLink, LinkifiedText as SharedLinkifiedText, urlSlugTitleLabel } from '@/lib/external-link'
import { AlertCircle, CheckCircle2 } from '@/lib/icons'
import { toolResultRecord } from '@/lib/tool-result-metadata'
import { useEnterAnimation } from '@/lib/use-enter-animation'
import { useStoresSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { recordPreviewArtifact } from '@/store/preview-status'
import { $botChatSessionIds, $sessionStates, $sessionTiles, isBotChatSession } from '@/store/session-states'
import { $showToolActivity } from '@/store/tool-activity'
import { $toolRowDismissed, dismissToolRow } from '@/store/tool-dismiss'
import {
  $hideCodeDiffs,
  $toolDisclosureOpen,
  $toolViewMode,
  setToolDisclosureOpen
} from '@/store/tool-view'

import { BotToolCards } from './bot-tool-cards'
import {
  buildToolView,
  clampForDisplay,
  cleanVisibleText,
  CONNECTION_CARD_KEY,
  countDiffLineStats,
  inlineDiffFromResult,
  isCardTool,
  isFileEditTool,
  isPreviewableTarget,
  looksRedundant,
  type SearchResultRow,
  selectMessageRunning,
  stableHash,
  toolCopyPayload,
  toolEntryDisclosureId,
  type ToolPart,
  type ToolStatus,
  type ToolTitleAction
} from './fallback-model'
import { McpAppFrame } from './mcp-app'

// `true` when a ToolEntry is rendered inside an embedding wrapper that owns
// the per-row chrome (timer / preview). The flat ToolGroupSlot sets this
// false, so every row currently owns its own chrome; kept as a seam for any
// future embedding surface.
const ToolEmbedContext = createContext(false)

// A search hit's title is result *content* inside an expanded row, not one of
// the scaffolding lines, so it keeps the brighter secondary grey.
const SEARCH_HIT_TITLE_CLASS =
  'text-[length:var(--conversation-tool-font-size)] font-medium leading-(--conversation-line-height) text-(--ui-text-secondary)'

const TOOL_HEADER_SUBTITLE_CLASS =
  'text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)'

const TOOL_HEADER_GLYPH_WRAP_CLASS = cn(SCAFFOLD_GLYPH_CLASS, 'self-center')

const toolValueIds = new WeakMap<object, number>()
let nextToolValueId = 0

function toolValueKey(value: unknown): string {
  if (value && typeof value === 'object') {
    const existing = toolValueIds.get(value)

    if (existing !== undefined) {
      return `o${existing}`
    }

    const next = ++nextToolValueId
    toolValueIds.set(value, next)

    return `o${next}`
  }

  if (typeof value === 'string') {
    return `s${value.length}:${stableHash(value)}`
  }

  return `${typeof value}:${String(value)}`
}

function toolCallDataKey(part: ToolPart): string {
  return [
    part.toolName,
    part.toolCallId ?? '',
    toolValueKey(part.args),
    toolValueKey(part.result),
    toolValueKey(part.toolResultMetadata),
    part.timestamp ?? '',
    part.completedAt ?? '',
    part.isError ?? '',
    part.interrupted ?? ''
  ].join(':')
}

// Glass-style section label that sits above any pre/JSON/output block.
// Lowercase tracking + tiny size so it reads as a quiet field label rather
// than a chrome heading. Used for "stdout", "stderr", "Search results", etc.
const TOOL_SECTION_LABEL_CLASS = 'mb-1 text-[0.65rem] font-medium uppercase tracking-[0.08em] text-(--ui-text-tertiary)'

// Inset scroll surface for any detail body. The expanded tool row owns the
// border; the payload itself is just clipped raw text.
const TOOL_SECTION_SURFACE_CLASS =
  'max-h-20 max-w-full overflow-auto bg-transparent px-2 py-1.5 text-(--ui-text-secondary)'

const TOOL_EXPANDED_SHELL_CLASS = 'rounded-[0.3125rem] border border-(--ui-stroke-tertiary)'

const TOOL_SECTION_PRE_CLASS = cn(TOOL_SECTION_SURFACE_CLASS, 'font-mono text-[0.7rem] leading-relaxed')

// Raw args/result dump — reference material, so a notch smaller than a body.
const TOOL_PAYLOAD_PRE_CLASS = cn(TOOL_SECTION_SURFACE_CLASS, 'font-mono text-[0.65rem] leading-relaxed')

/**
 * Technical-mode raw payload, behind a chevron disclosure.
 *
 * Collapsed by default — in technical mode every tool row carries one, and
 * expanding them all buries the transcript. Uses `DisclosureCaret` rather than
 * a native `<details>`, whose marker is a browser-drawn triangle matching
 * nothing else here.
 */
function ToolPayloadDisclosure({ args, result }: { args: unknown; result: unknown }) {
  const [open, setOpen] = useState(false)

  return (
    // `py-0.5` tops up the parent's `p-1.5` to an even block on both edges.
    <div className="max-w-full py-0.5">
      <button
        aria-expanded={open}
        className={cn(
          TOOL_SECTION_LABEL_CLASS,
          'mb-0 flex items-center gap-1 bg-transparent transition-colors hover:text-(--ui-text-secondary)'
        )}
        onClick={() => setOpen(value => !value)}
        type="button"
      >
        <DisclosureCaret className="text-(--ui-text-tertiary)" open={open} size="0.625rem" />
        Tool payload
      </button>
      {open && (
        <pre className={cn(TOOL_PAYLOAD_PRE_CLASS, 'mt-1 whitespace-pre-wrap wrap-anywhere')}>
          {technicalTrace(args, result)}
        </pre>
      )}
    </div>
  )
}

interface ToolStatusCopy {
  statusDone: string
  statusError: string
  statusRecovered: string
  statusRunning: string
}

function prettyTechnicalValue(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return value
    }

    try {
      const parsed = JSON.parse(value)

      return parsed && typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : value
    } catch {
      return value
    }
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function technicalTrace(args: unknown, result: unknown): string {
  const parts = [
    ['Arguments', args],
    ['Result', result]
  ]
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([label, value]) => `${label}:\n${prettyTechnicalValue(value)}`)

  return clampForDisplay(parts.join('\n\n'))
}

function statusGlyph(status: ToolStatus, copy: ToolStatusCopy): ReactNode {
  if (status === 'running') {
    return (
      <GlyphSpinner
        ariaLabel={copy.statusRunning}
        className="size-3.5 shrink-0 text-[0.95rem] text-(--ui-text-tertiary)"
        spinner="breathe"
      />
    )
  }

  if (status === 'error') {
    return <AlertCircle aria-label={copy.statusError} className="size-3.5 shrink-0 text-danger" />
  }

  if (status === 'warning') {
    return (
      <AlertCircle aria-label={copy.statusRecovered} className="size-3.5 shrink-0 text-warning" />
    )
  }

  return (
    <CheckCircle2
      aria-label={copy.statusDone}
      className="size-3.5 shrink-0 text-success"
    />
  )
}

// Leading glyph for any tool-row header. Status (running/error/warning)
// takes precedence; otherwise falls back to the tool's codicon. Returns
// null when neither applies so callers can render unconditionally.
function ToolGlyph({
  copy,
  filePath,
  icon,
  legendary,
  status
}: {
  copy: ToolStatusCopy
  filePath?: string
  icon?: string
  /** Landed memory write — keep the brain glyph, tint it gold→purple. */
  legendary?: boolean
  status?: ToolStatus
}) {
  const node = status ? (
    statusGlyph(status, copy)
  ) : filePath ? (
    <FileTypeIcon className="text-(--ui-text-tertiary)" path={filePath} size="0.875rem" />
  ) : icon ? (
    <ToolIcon
      className={legendary ? 'text-(--tool-memory-legendary-icon)' : 'text-(--ui-text-tertiary)'}
      name={icon}
      size="0.875rem"
    />
  ) : null

  return node ? (
    <span className={cn(TOOL_HEADER_GLYPH_WRAP_CLASS, legendary && 'tool-memory-legendary-glyph')}>{node}</span>
  ) : null
}

// Which status (if any) should pre-empt the tool's icon in the leading
// slot. Success is silent — the row reads as "done" without a checkmark.
function leadingStatus(isPending: boolean, status: ToolStatus): ToolStatus | undefined {
  if (isPending) {
    return 'running'
  }

  return status === 'success' || status === 'notice' ? undefined : status
}

function SearchResultsList({ hits }: { hits: SearchResultRow[] }) {
  return (
    <ol className="m-0 grid list-none gap-2.5 p-0">
      {hits.map((hit, index) => {
        const key = `${hit.url || hit.title}-${index}`
        const trimmedTitle = hit.title.trim()

        return (
          <li className="grid min-w-0 gap-0.5" key={key}>
            {hit.url ? (
              <PrettyLink
                className={cn(SEARCH_HIT_TITLE_CLASS, 'block max-w-full')}
                fallbackLabel={trimmedTitle || urlSlugTitleLabel(hit.url)}
                href={hit.url}
                label={trimmedTitle || undefined}
              />
            ) : (
              <span className={SEARCH_HIT_TITLE_CLASS}>{trimmedTitle}</span>
            )}
            {hit.snippet && <p className={cn(TOOL_HEADER_SUBTITLE_CLASS, 'm-0 line-clamp-3')}>{hit.snippet}</p>}
          </li>
        )
      })}
    </ol>
  )
}

function LinkifiedText({ className, text }: { className?: string; text: string }) {
  return <SharedLinkifiedText className={className} pretty text={cleanVisibleText(text)} />
}

function ToolTitle({
  isPending,
  legendary,
  status,
  title,
  titleAction
}: {
  isPending: boolean
  legendary?: boolean
  status: ToolStatus
  title: string
  titleAction?: ToolTitleAction
}) {
  return (
    <FadeText
      className={cn(
        SCAFFOLD_LABEL_CLASS,
        isPending && 'text-(--conversation-scaffold-meta)',
        status === 'error' && 'text-danger',
        status === 'warning' && 'text-warning',
        legendary && !isPending && 'tool-memory-legendary-title text-transparent'
      )}
    >
      {isPending && titleAction ? (
        <>
          {titleAction.prefix}
          <span className="shimmer">{titleAction.text}</span>
          {titleAction.suffix}
        </>
      ) : (
        title
      )}
    </FadeText>
  )
}

interface ToolEntryProps {
  part: ToolPart
}

function useDisclosureOpen(disclosureId: string, fallbackOpen = false): boolean {
  const persistedOpen = useStore($toolDisclosureOpen(disclosureId))

  return persistedOpen ?? fallbackOpen
}

function ToolEntry({ part }: ToolEntryProps) {
  const { t } = useI18n()
  const copy = t.assistant.tool
  const statusCopy = t.statusStack
  const messageId = useAuiState(s => s.message.id)
  const messageRunning = useAuiState(selectMessageRunning)
  const embedded = useContext(ToolEmbedContext)
  const toolViewMode = useStore($toolViewMode)
  const hideCodeDiffs = useStore($hideCodeDiffs)

  // `ToolFallback` rebuilds the `part` wrapper each render, defeating the memos
  // below and re-running buildToolView (full JSON.stringify of result) on every
  // stream delta — the freeze on big `/learn` runs. Re-derive a stable part from
  // the referentially-stable args/result so the memos hold across deltas.
  const {
    args,
    completedAt,
    innerToolName,
    interrupted,
    isError,
    result,
    toolResultMetadata,
    timestamp,
    toolCallId,
    toolName
  } = part

  const stablePart = useMemo<ToolPart>(
    () => ({
      args,
      completedAt,
      innerToolName,
      interrupted,
      isError,
      result,
      toolResultMetadata,
      timestamp,
      toolCallId,
      toolName,
      type: 'tool-call'
    }),
    [
      args,
      completedAt,
      innerToolName,
      interrupted,
      isError,
      result,
      toolResultMetadata,
      timestamp,
      toolCallId,
      toolName
    ]
  )

  const disclosureId = toolEntryDisclosureId(messageId, stablePart)
  const dismissed = useStore($toolRowDismissed(disclosureId))
  const isPending = messageRunning && result === undefined && completedAt === undefined
  const inlineDiff = inlineDiffFromResult(toolResultRecord(stablePart))
  const isFileEdit = isFileEditTool(toolName)
  const defaultOpen = Boolean(inlineDiff) && !hideCodeDiffs
  const disclosureOpen = useDisclosureOpen(disclosureId, defaultOpen)
  const canDismiss = !isPending && !embedded
  // Only animate entries that mount while their message is actively
  // streaming — historical sessions mount with `messageRunning === false`,
  // so they paint statically without a settle cascade. The wrapping group
  // handles its own enter animation, so embedded children skip it.
  const enterRef = useEnterAnimation(messageRunning && !embedded, `tool-entry:${disclosureId}`)
  const elapsed = useElapsedSeconds(isPending, `tool:${disclosureId}`)

  // A stopped turn is not evidence that an unobserved tool succeeded. Use a
  // presentation-only completion marker, never manufacture a result.
  const view = useMemo(() => {
    const p =
      !isPending && result === undefined ? { ...stablePart, completedAt: stablePart.completedAt ?? 0 } : stablePart

    return buildToolView(p, inlineDiff)
  }, [inlineDiff, isPending, result, stablePart])

  // Keep counts and saved disclosure intent, but never mount code while hidden.
  // Failed edits still expose their explanation.
  const summaryOnly = hideCodeDiffs && isFileEdit && view.status !== 'error'
  const open = disclosureOpen && !summaryOnly
  const showInlineDiff = Boolean(view.inlineDiff) && !hideCodeDiffs
  const showPayload = toolViewMode === 'technical' && !(hideCodeDiffs && isFileEdit)

  // Surface a previewable artifact (HTML file / localhost URL) as a compact link
  // in the composer status stack rather than a bulky inline card. Uses the same
  // detected target the old inline card did. Idempotent + dedup'd, so re-renders
  // don't churn.
  const previewTarget = view.previewTarget
  // The session whose transcript this row is IN, which is not necessarily the
  // primary one: a tool row inside a session tile must feed that tile's composer.

  const {
    $cwd: $sessionCwd,
    $runtimeId: $sessionRuntimeId,
    $storedId: $sessionStoredId,
    $messages: $sessionMessages
  } = useSessionView()

  useEffect(() => {
    if (view.status !== 'success' || !previewTarget || !isPreviewableTarget(previewTarget)) {
      return
    }

    // Read (don't subscribe) session/cwd: this only fires when a previewable
    // target appears, and subscribing re-rendered every tool row on any session
    // or cwd change.
    const sessionId = $sessionRuntimeId.get()

    // A route switch can paint the previous assistant row while these atoms
    // already describe the next chat. Only that chat's own messages may feed it.
    if (sessionId && $sessionMessages.get().some(message => message.id === messageId)) {
      recordPreviewArtifact(sessionId, previewTarget, $sessionCwd.get() || '', $sessionStoredId.get() ?? sessionId)
    }
  }, [$sessionCwd, $sessionRuntimeId, $sessionStoredId, $sessionMessages, messageId, previewTarget, view.status])

  const detailSections = useMemo(() => {
    if (!view.detail) {
      return { body: '', summary: '' }
    }

    if (view.status !== 'error') {
      return { body: view.detail, summary: '' }
    }

    const chunks = view.detail
      .split(/\n\s*\n+/)
      .map(chunk => chunk.trim())
      .filter(Boolean)

    // The subtitle is not rendered in the header; keep its explanation here.
    const [summary = '', ...rest] = chunks

    return { body: rest.join('\n\n').trim(), summary }
  }, [view.detail, view.status])

  // `looksRedundant` normalizes the FULL (uncapped) detail payload — a
  // read_file / terminal result can be huge. Memoize on the view fields so it
  // recomputes only when the tool's content changes, not on every parent
  // re-render (tool rows re-render on every stream tick of the running message).
  const detailMatchesSubtitle = useMemo(() => looksRedundant(view.subtitle, view.detail), [view.subtitle, view.detail])
  const detailMatchesTitle = useMemo(() => looksRedundant(view.title, view.detail), [view.title, view.detail])

  const showDetail =
    (!view.inlineDiff || (hideCodeDiffs && view.status === 'error')) &&
    (Boolean(view.stdout || view.stderr) ||
      (view.status === 'error' && Boolean(detailSections.summary || detailSections.body)) ||
      (view.status === 'notice' && Boolean(view.detail)) ||
      (view.status !== 'error' && Boolean(view.detail) && !detailMatchesTitle && !detailMatchesSubtitle))

  const renderDetailAsCode =
    view.status !== 'error' &&
    (part.toolName === 'terminal' || part.toolName === 'execute_code' || part.toolName === 'read_file')

  const hasSearchHits = Boolean(view.searchHits?.length)
  const searchResultsLabel = part.toolName === 'web_search' ? 'Search results' : view.detailLabel

  const hasExpandableContent =
    !summaryOnly &&
    Boolean(
      view.imageUrl ||
      showInlineDiff ||
      showDetail ||
      hasSearchHits ||
      view.stdout ||
      view.stderr ||
      view.terminalCommand ||
      view.terminalExitCode !== undefined ||
      showPayload
    )

  // copyAction reads the uncapped view.detail; clampForDisplay below only bounds
  // what's painted, so the row's Copy button still yields the full output.
  const copyAction = useMemo(() => toolCopyPayload(stablePart, view), [stablePart, view])

  const diffStats = useMemo(
    () => (isFileEdit && view.inlineDiff ? countDiffLineStats(view.inlineDiff) : null),
    [isFileEdit, view.inlineDiff]
  )

  const showDiffStats = !isPending && Boolean(diffStats && (diffStats.added > 0 || diffStats.removed > 0))

  // Landed memory write gets gold→purple chrome instead of the plain scaffold grey.
  const memoryLegendary = !isPending && part.toolName === 'memory' && view.status === 'success'
  const memoryMetaClass = memoryLegendary ? 'tool-memory-legendary-meta' : undefined

  // The header trailing slot only carries the live duration timer while the
  // tool is running. The copy control used to live here too, but an
  // `opacity-0` (yet still clickable) button straddling the caret/duration made
  // the disclosure caret hard to hit. Copy now lives in the expanded body's
  // top-right, where it can't fight the caret for the right edge.
  const trailing = !embedded ? (
    <span className="flex shrink-0 items-center gap-1.5">
      <TimelineTimestamp className={SCAFFOLD_META_CLASS} completedAt={completedAt} timestamp={timestamp} />
      {isPending && <ActivityTimerText className={SCAFFOLD_META_CLASS} seconds={elapsed} />}
    </span>
  ) : undefined

  // Once a turn has settled, a hover/focus-revealed dismiss lets the user clear
  // a completed/failed row that would otherwise sit at the tail of the chat.
  // It goes in the in-flow `action` slot (not `trailing`) so it can't overlap
  // the disclosure caret's hit-target — see the comment above `trailing`.
  const dismissAction = canDismiss ? (
    <Button
      aria-label={statusCopy.dismiss}
      className={cn(
        'size-5 rounded-md text-(--ui-text-tertiary) transition-opacity hover:text-(--ui-text-primary) hover:opacity-100',
        open
          ? 'opacity-80'
          : 'opacity-0 group-hover/disclosure-row:opacity-80 group-focus-within/disclosure-row:opacity-80'
      )}
      onClick={event => {
        event.stopPropagation()
        dismissToolRow(disclosureId)
      }}
      size="icon-xs"
      type="button"
      variant="ghost"
    >
      <Codicon name="close" size="0.75rem" />
    </Button>
  ) : undefined

  if (dismissed) {
    return null
  }

  // A completed file edit with no diff to review is a bare, unexpandable row.
  // This is almost always a `write_file` create after a reload: only `patch`
  // persists its diff in the tool result, so creates rehydrate diff-less and
  // read like dead duplicates of the real diff row. Hide them — but keep
  // in-flight writes (activity) and failures (errors) visible.
  if (isFileEdit && !isPending && view.status !== 'error' && !view.inlineDiff) {
    return null
  }

  const card = toolCardView(stablePart)

  if (view.status === 'error') {
    return <ToolStepPill card={card} />
  }

  if (isFileEdit && view.inlineDiff && !hideCodeDiffs) {
    return (
      <div className="grid min-w-0 gap-1">
        <ToolStepPill card={card} />
        <FileDiffPanel diff={view.inlineDiff} path={view.subtitle} />
      </div>
    )
  }

  if (part.toolResultMetadata?.mcp_app && !isPending) {
    return (
      <div className="grid min-w-0 gap-1">
        <ToolStepPill card={card} />
        <McpAppFrame app={part.toolResultMetadata.mcp_app} args={part.args} result={part.result} />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group/tool-block min-w-0 max-w-full overflow-hidden text-ui-xs text-fg-muted',
        open && TOOL_EXPANDED_SHELL_CLASS
      )}
      data-conversation-scaffold=""
      data-file-edit={isFileEdit && open ? '' : undefined}
      data-slot="tool-block"
      data-tool-open={open ? '' : undefined}
      data-tool-row=""
      ref={enterRef}
    >
      <div className={cn(open && 'border-b border-(--ui-stroke-tertiary) px-2 py-1.5')}>
        <DisclosureRow
          action={dismissAction}
          onToggle={
            hasExpandableContent
              ? () => {
                  setToolDisclosureOpen(disclosureId, !open)
                }
              : undefined
          }
          open={open}
          trailing={trailing}
        >
          <span
            className="flex min-w-0 items-center gap-1.5"
            title={isFileEdit && view.subtitle ? view.subtitle : undefined}
          >
            <ToolGlyph
              copy={copy}
              filePath={isFileEdit ? view.subtitle : undefined}
              icon={view.icon}
              legendary={memoryLegendary}
              status={leadingStatus(isPending, view.status)}
            />
            <ToolTitle
              isPending={isPending}
              legendary={memoryLegendary}
              status={view.status}
              title={view.title}
              titleAction={view.titleAction}
            />
            {!isPending && view.countLabel && (
              <span className={cn(SCAFFOLD_META_CLASS, memoryMetaClass)}>{view.countLabel}</span>
            )}
            {showDiffStats && diffStats && (
              <span className="flex shrink-0 items-center gap-1 font-mono text-[0.625rem] tabular-nums">
                {diffStats.added > 0 && (
                  <span className="text-success">+{diffStats.added}</span>
                )}
                {diffStats.removed > 0 && (
                  <span className="text-danger">−{diffStats.removed}</span>
                )}
              </span>
            )}
            {!isFileEdit && !isPending && view.durationLabel && (
              <span className={cn(SCAFFOLD_META_CLASS, memoryMetaClass)}>{view.durationLabel}</span>
            )}
          </span>
        </DisclosureRow>
      </div>
      {part.toolResultMetadata?.mcp_app && !isPending && (
        // The tool's own MCP App is the call's deliverable: shown whether or not the row is expanded.
        <div className="w-full min-w-0 max-w-full p-1.5">
          <McpAppFrame app={part.toolResultMetadata.mcp_app} args={part.args} result={part.result} />
        </div>
      )}
      {open && (
        <div className="relative grid w-full min-w-0 max-w-full gap-1.5 overflow-hidden p-1.5">
          {copyAction.text && (
            <CopyButton
              appearance="inline"
              className="absolute right-4 top-1.5 z-10 h-5 gap-0 rounded-md px-1 opacity-5 transition-opacity group-hover/tool-block:opacity-100 hover:opacity-100 focus-visible:opacity-100"
              iconClassName="size-3"
              label={copyAction.label}
              showLabel={false}
              side="left"
              stopPropagation
              text={copyAction.text}
            />
          )}
          {part.toolName === 'terminal' && toolViewMode !== 'technical' && (
            <TerminalTranscript command={view.terminalCommand} exitCode={view.terminalExitCode} />
          )}
          {view.imageUrl && (
            <div className="max-w-72 overflow-hidden rounded-[0.25rem] border border-(--ui-stroke-tertiary)">
              <MarkdownImage alt={copy.outputAlt} src={view.imageUrl} />
            </div>
          )}
          {hasSearchHits && view.searchHits && (
            <div className="max-w-full text-xs leading-relaxed text-(--ui-text-secondary)">
              {view.searchQuery && (
                <p className="mb-1 flex min-w-0 gap-1.5 wrap-anywhere">
                  <span className="shrink-0 font-medium text-(--ui-text-tertiary)">Search</span>
                  <span>{view.searchQuery}</span>
                </p>
              )}
              {searchResultsLabel && <p className={TOOL_SECTION_LABEL_CLASS}>{searchResultsLabel}</p>}
              <SearchResultsList hits={view.searchHits} />
            </div>
          )}
          {showInlineDiff && (
            <FileDiffPanel className="-mt-1.5" diff={view.inlineDiff} path={isFileEdit ? view.subtitle : undefined} />
          )}
          {showDetail &&
            !showPayload &&
            ((view.status as string) === 'error' ? (
              detailSections.summary || detailSections.body ? (
                <div className="max-w-full text-xs leading-relaxed text-danger">
                  {detailSections.summary && (
                    <LinkifiedText className="block font-medium" text={detailSections.summary} />
                  )}
                  {detailSections.body && (
                    <pre
                      className={cn(
                        'max-h-56 overflow-auto whitespace-pre-wrap wrap-anywhere font-mono text-[0.7rem] leading-[1.55] text-(--ui-text-secondary)',
                        detailSections.summary && 'mt-1.5'
                      )}
                    >
                      {clampForDisplay(detailSections.body)}
                    </pre>
                  )}
                </div>
              ) : null
            ) : view.stdout || view.stderr ? (
              // Stdout + stderr split: render both as labeled blocks. stderr
              // is intentionally NOT painted destructive — many CLIs log
              // informational output there.
              <div className="max-w-full text-xs leading-relaxed text-(--ui-text-secondary)">
                {view.detailLabel && <p className={TOOL_SECTION_LABEL_CLASS}>{view.detailLabel}</p>}
                {view.stdout && (
                  <div className="space-y-0.5">
                    {view.stderr && <p className={TOOL_SECTION_LABEL_CLASS}>stdout</p>}
                    <pre className={cn(TOOL_SECTION_PRE_CLASS, 'whitespace-pre-wrap wrap-anywhere')}>
                      {view.rendersAnsi ? (
                        <AnsiText text={clampForDisplay(view.stdout)} />
                      ) : (
                        clampForDisplay(view.stdout)
                      )}
                    </pre>
                  </div>
                )}
                {view.stderr && (
                  <div className={cn('space-y-0.5', view.stdout && 'mt-1.5')}>
                    <p className={TOOL_SECTION_LABEL_CLASS}>stderr</p>
                    <pre
                      className={cn(
                        TOOL_SECTION_PRE_CLASS,
                        'whitespace-pre-wrap wrap-anywhere text-(--ui-text-tertiary)'
                      )}
                    >
                      {view.rendersAnsi ? (
                        <AnsiText text={clampForDisplay(view.stderr)} />
                      ) : (
                        clampForDisplay(view.stderr)
                      )}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="max-w-full text-xs leading-relaxed text-(--ui-text-secondary)">
                {view.detailLabel && <p className={TOOL_SECTION_LABEL_CLASS}>{view.detailLabel}</p>}
                {renderDetailAsCode ? (
                  <pre className={cn(TOOL_SECTION_PRE_CLASS, 'whitespace-pre-wrap wrap-anywhere')}>
                    {view.rendersAnsi ? <AnsiText text={clampForDisplay(view.detail)} /> : clampForDisplay(view.detail)}
                  </pre>
                ) : (
                  <CompactMarkdown
                    className={cn(TOOL_SECTION_SURFACE_CLASS, 'wrap-anywhere')}
                    text={clampForDisplay(view.detail)}
                  />
                )}
              </div>
            ))}
          {showPayload && <ToolPayloadDisclosure args={part.args} result={part.result} />}
        </div>
      )}
    </div>
  )
}

interface TerminalTranscriptProps {
  command?: string
  exitCode?: number
}

function TerminalTranscript({ command, exitCode }: TerminalTranscriptProps) {
  if (!command && exitCode === undefined) {
    return null
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[0.25rem] border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) px-2 py-1.5 font-mono text-[0.7rem] leading-relaxed">
      {command && (
        <code className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere text-(--ui-text-secondary)">
          <span aria-hidden className="select-none text-(--ui-accent-secondary)">
            ${' '}
          </span>
          {command}
        </code>
      )}
      {exitCode !== undefined && (
        <span
          className={cn(
            'shrink-0 rounded bg-(--ui-bg-tertiary) px-1 py-px text-[0.6rem] tabular-nums',
            exitCode === 0 ? 'text-success' : 'text-warning'
          )}
        >
          exit {exitCode}
        </span>
      )}
    </div>
  )
}

// Tools that draw their own surface and must never be folded into a run's
// summary live in `fallback-model` (`isCardTool`) — the DOM render budget
// prices a turn by the same rule, so both sides have to agree on which rows
// collapse into a summary line and which mount their own markup.

export type RunItem = { end: number; kind: 'run'; start: number } | { index: number; kind: 'card' }

/**
 * Split a range of parts into cards and the runs of activity between them.
 *
 * Order is preserved rather than sorted into "all the runs, then all the
 * cards": a turn that reads, edits, then reads again shows a summary, the
 * diff, then a second summary, in the sequence it happened. Indices are
 * relative to the range. An empty name is a part that isn't a tool call at
 * all, which passes through as its own card.
 */
export function splitRunItems(toolNames: readonly string[]): RunItem[] {
  const items: RunItem[] = []
  let run: null | Extract<RunItem, { kind: 'run' }> = null

  toolNames.forEach((name, index) => {
    if (!name || isCardTool(name)) {
      run = null
      items.push({ index, kind: 'card' })

      return
    }

    if (run) {
      run.end = index
    } else {
      run = { end: index, kind: 'run', start: index }
      items.push(run)
    }
  })

  return items
}

/**
 * The live run, as one line.
 *
 * A run in progress shows only what it is doing right now; each new action
 * slides the one before it up and out of a single-line window, so a turn that
 * touches thirty files reads as one line ticking over in place instead of a
 * list growing down the page. When the run settles the ticker goes away and
 * the summary above it is all that's left.
 */
// The one grey line that stands in for a run of tool calls — "Explored 3
// files, ran 5 commands". Live, it narrates in the present tense above the
// ticker by default; its toggle can reveal the activity before it settles.
// The name the run splitter classifies a part by: connector and MCP calls are cards, and so is set_theme
// reached through the tool_call bridge (a reloaded transcript).
function toolGroupKey(
  toolName: string,
  args: ToolCallMessagePartProps['args'],
  metadata?: ToolPart['toolResultMetadata'],
  part?: ToolPart
): string {
  if (
    metadata?.mcp_app ||
    (part && toolCardView(part).state === 'error') ||
    connectorCalls(toolName, args).length ||
    mcpTargets(toolName, args).length
  ) {
    return CONNECTION_CARD_KEY
  }

  return setThemeCall(toolName, args) ? SET_THEME_TOOL : toolName
}

/**
 * A range of consecutive tool calls, split into the cards that must stay on
 * screen and the runs of activity between them.
 *
 * assistant-ui hands the whole adjacent range over as one group; what belongs
 * together is a narrower question than adjacency. A diff or a question for the
 * user is the point of the turn and renders in place, while the reads and
 * commands around it collapse into a line. Splitting here rather than asking
 * for different ranges keeps the decision next to the rendering that depends
 * on it.
 */
export const ToolGroupSlot: FC<PropsWithChildren<{ endIndex: number; startIndex: number }>> = ({
  children,
  endIndex,
  startIndex
}) => {
  const showToolActivity = useStore($showToolActivity)
  const sessionId = useStore(useSessionView().$runtimeId)

  // A Bot Chat's transcript renders its tool runs as cards; every other
  // session keeps the answer-only passthrough below. The same three-store
  // resolution the composer uses — the scope set records the answer, and
  // resolving this runtime id to its stored id reads the other two.
  const botChat = useStoresSelector([$botChatSessionIds, $sessionStates, $sessionTiles], () =>
    isBotChatSession(sessionId)
  )

  // Joined rather than returned as an array: assistant-ui compares selector
  // results with `Object.is` and re-runs them on every store update, so a
  // fresh array would re-render the whole group on every text delta.
  const toolNameKey = useAuiState(state =>
    state.message.parts
      .slice(Math.max(0, startIndex), endIndex + 1)
      .map(part =>
        part.type === 'tool-call'
          ? toolGroupKey(part.toolName, part.args, (part as ToolPart).toolResultMetadata, part as ToolPart)
          : ''
      )
      .join('\u0000')
  )

  const toolDataKey = useAuiState(state =>
    state.message.parts
      .slice(Math.max(0, startIndex), endIndex + 1)
      .map(part => (part.type === 'tool-call' ? toolCallDataKey(part as ToolPart) : ''))
      .join('\u0000')
  )

  const items = useMemo(() => splitRunItems(toolNameKey.split('\u0000')), [toolNameKey])
  const rows = Children.toArray(children)

  if (botChat) {
    return (
      <ToolEmbedContext.Provider value={false}>
        {items.map(item =>
          item.kind === 'card' ? (
            <Fragment key={`card:${item.index}`}>{rows[item.index]}</Fragment>
          ) : (
            <BotToolCards
              endIndex={startIndex + item.end}
              key={`run:${item.start}`}
              revision={toolDataKey}
              startIndex={startIndex + item.start}
            >
              {rows.slice(item.start, item.end + 1)}
            </BotToolCards>
          )
        )}
      </ToolEmbedContext.Provider>
    )
  }

  // The run scaffold ("Explored N files") is part of the tool feed and follows
  // display.tool_progress. Children still mount so clarify, diffs, and failed
  // calls can render on their own.
  if (!showToolActivity) {
    return children
  }

  return (
    <ToolEmbedContext.Provider value={false}>
      {items.map(item =>
        item.kind === 'card' ? (
          <Fragment key={`card:${item.index}`}>{rows[item.index]}</Fragment>
        ) : (
          <BotToolCards
            endIndex={startIndex + item.end}
            key={`run:${item.start}`}
            revision={toolDataKey}
            startIndex={startIndex + item.start}
          >
            {rows.slice(item.start, item.end + 1)}
          </BotToolCards>
        )
      )}
    </ToolEmbedContext.Provider>
  )
}

/**
 * Per-tool fallback. Now strictly returns a single ToolEntry — the
 * grouping decision lives in ToolGroupSlot above, so this never swaps
 * its return type and the underlying ToolEntry stays mounted across
 * group-shape changes.
 */
type TimelineToolCallProps = ToolCallMessagePartProps &
  Pick<ToolPart, 'completedAt' | 'innerToolName' | 'interrupted' | 'timestamp' | 'toolResultMetadata'>

export const ToolFallback = ({
  toolCallId,
  toolName,
  args,
  completedAt,
  innerToolName,
  interrupted,
  isError,
  result,
  toolResultMetadata,
  timestamp
}: TimelineToolCallProps) => {
  const part: ToolPart = {
    args,
    completedAt,
    innerToolName,
    interrupted,
    isError,
    result,
    toolResultMetadata,
    timestamp,
    toolCallId,
    toolName,
    type: 'tool-call'
  }

  return <ToolEntry part={part} />
}
