import { MessagePrimitive, useAuiState } from '@assistant-ui/react'
import { type FC, useState } from 'react'

import { MarkdownTextContent } from '@/components/assistant-ui/markdown-text'
import { messageContentText } from '@/components/assistant-ui/thread/content'
import { MessageTimelineTimestamp } from '@/components/assistant-ui/thread/timeline-timestamp'
import { DisclosureRow } from '@/components/chat/disclosure-row'
import { SCAFFOLD_GLYPH_CLASS, SCAFFOLD_LABEL_CLASS, ScaffoldRow } from '@/components/chat/scaffold-row'
import { Codicon } from '@/components/ui/codicon'
import { LogView } from '@/components/ui/log-view'
import { ToolIcon } from '@/components/ui/tool-icon'
import { LinkifiedText } from '@/lib/external-link'
import { cn } from '@/lib/utils'

const SLASH_STATUS_RE = /^slash:(?<command>\/[^\n]+)\n(?<output>[\s\S]*)$/
const STEER_NOTE_RE = /^steer:(?<text>[\s\S]+)$/
const REVIEW_NOTE_RE = /^review:(?<label>[^:\n]+):?\s*(?<detail>[\s\S]*)$/
// One applied write in a review summary: `Skill '<name>' <verb>[ (<file>)]`.
const REVIEW_SKILL_SEGMENT_RE = /^Skill\s+'(?<name>[^']+)'\s+(?<verb>[^\s(]+)(?:\s+\((?<file>.+)\))?$/

interface ReviewWrite {
  verb: string
  file?: string
}

interface ReviewGroup {
  name: string
  writes: ReviewWrite[]
}

/** Split a review summary into one group per skill, preserving the backend's order. Non-skill
 *  clauses (memory/profile updates) come back untouched in `notes`. */
export function groupReviewDetail(detail: string): { groups: ReviewGroup[]; notes: string[] } {
  const groups: ReviewGroup[] = []
  const notes: string[] = []

  for (const raw of detail.split(/\s+·\s+/)) {
    const segment = raw.trim()

    if (!segment) {
      continue
    }

    const match = segment.match(REVIEW_SKILL_SEGMENT_RE)

    if (!match?.groups?.name) {
      notes.push(segment)
      continue
    }

    const existing = groups.find(group => group.name === match.groups?.name)

    if (existing) {
      existing.writes.push({ verb: match.groups.verb, file: match.groups.file })
      continue
    }

    groups.push({ name: match.groups.name, writes: [{ verb: match.groups.verb, file: match.groups.file }] })
  }

  return { groups, notes }
}

/** The row's one-line face: `name ×4` for a skill the review wrote to repeatedly, `name verb` for a
 *  single write, then any memory clauses. The backend emits a clause per applied write, so four
 *  edits to one skill read as four near-identical `Skill 'x' patched (<file>)` runs and the row
 *  becomes a wall of filenames. Opening the row lists every write; the files are in the skill's own
 *  history. */
export function compactReviewDetail(detail: string): string {
  const { groups, notes } = groupReviewDetail(detail)

  if (!groups.length) {
    return detail
  }

  const skills = groups.map(({ name, writes }) =>
    writes.length > 1 ? `${name} ×${writes.length}` : `${name} ${writes[0]?.verb ?? ''}`.trim()
  )

  return [...skills, ...notes].join(' · ')
}

// A usage-window plan gauge exactly as the backend renders it: `[` + 10 cells of
// `|` then spaces + `]`. Only a window plan's /usage output carries one.
const USAGE_WINDOW_GAUGE_RE = /\[(?=[| ]{10}\])\|* *\]/

interface BackgroundResultProps {
  text: string
  report: string
  process?: boolean
}

export const BackgroundResult: FC<BackgroundResultProps> = ({ text, report, process }) => {
  const [open, setOpen] = useState(false)

  return (
    <div
      className="flex w-full min-w-0 flex-col self-start py-1 pl-(--message-text-indent)"
      data-slot="aui_background-result"
    >
      <div data-conversation-scaffold="">
        <ScaffoldRow
          onToggle={report ? () => setOpen(!open) : undefined}
          open={open}
          trailing={
            <>
              {' '}
              <MessageTimelineTimestamp />
            </>
          }
        >
          {process && (
            <span className={SCAFFOLD_GLYPH_CLASS}>
              <ToolIcon className="text-(--ui-text-tertiary)" name="terminal" size="0.875rem" />
            </span>
          )}
          <span className={cn(SCAFFOLD_LABEL_CLASS, 'min-w-0 truncate')}>{text}</span>
        </ScaffoldRow>
      </div>
      {open &&
        (process ? (
          <LogView className="mt-2 max-h-80 overscroll-x-contain overscroll-y-auto">{report}</LogView>
        ) : (
          <div className="mt-2 max-h-80 min-w-0 max-w-full overflow-auto overscroll-x-contain overscroll-y-auto wrap-anywhere">
            <MarkdownTextContent isRunning={false} text={report} />
          </div>
        ))}
    </div>
  )
}

/** The self-improvement review row: one line by default (one clause per skill), a caret on hover
 *  that opens the whole list — every skill the review wrote to and every verb + file behind the
 *  count. It wears the same chrome as a landed `memory` write: brain glyph with the gold→purple
 *  glow, gradient label, purple detail, left-aligned in the reading column. */
const ReviewRow: FC<{ label: string; detail: string }> = ({ label, detail }) => {
  const [open, setOpen] = useState(false)
  const { groups, notes } = groupReviewDetail(detail)
  const expandable = groups.length > 0 || notes.length > 0

  return (
    <MessagePrimitive.Root
      className="w-full min-w-0 max-w-full self-start"
      data-role="system"
      data-slot="aui_system-message-root"
    >
      <div className="flex min-w-0 flex-col gap-1 py-0.5">
        <DisclosureRow onToggle={expandable ? () => setOpen(!open) : undefined} open={open}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="tool-memory-legendary-glyph flex h-(--conversation-line-height) w-3.5 shrink-0 items-center justify-center">
              <ToolIcon className="text-(--tool-memory-legendary-icon)" name="brain" size="0.875rem" />
            </span>
            <span className={cn(SCAFFOLD_LABEL_CLASS, 'tool-memory-legendary-title shrink-0 text-transparent')}>
              {label}
            </span>
            {detail && (
              <span
                className={cn(SCAFFOLD_LABEL_CLASS, 'tool-memory-legendary-meta min-w-0 wrap-anywhere')}
                title={detail}
              >
                {compactReviewDetail(detail)}
              </span>
            )}
          </span>
        </DisclosureRow>
        {open && (
          <ul className="flex min-w-0 flex-col gap-0.5 pl-5" data-slot="aui_review-writes">
            {groups.map(group => (
              <li className={cn(SCAFFOLD_LABEL_CLASS, 'flex min-w-0 flex-wrap items-baseline gap-x-1.5')} key={group.name}>
                <span className="tool-memory-legendary-meta shrink-0">{group.name}</span>
                <span className="min-w-0 wrap-anywhere text-(--conversation-scaffold-meta)">
                  {group.writes
                    .map(write => (write.file ? `${write.verb} ${write.file}` : write.verb))
                    .join(' · ')}
                </span>
              </li>
            ))}
            {notes.map(note => (
              <li className={cn(SCAFFOLD_LABEL_CLASS, 'min-w-0 wrap-anywhere text-(--conversation-scaffold-meta)')} key={note}>
                {note}
              </li>
            ))}
          </ul>
        )}
      </div>
    </MessagePrimitive.Root>
  )
}

export const SystemMessage: FC = () => {
  const text = useAuiState(s => messageContentText(s.message.content))
  const asyncResult = useAuiState(s => s.message.metadata.custom?.asyncResult)
  const processResult = useAuiState(s => s.message.metadata.custom?.asyncResultKind === 'process')

  if (!text) {
    return null
  }

  if (processResult || (typeof asyncResult === 'string' && asyncResult)) {
    return (
      <MessagePrimitive.Root
        className="w-full min-w-0 self-start"
        data-role="system"
        data-slot="aui_system-message-root"
      >
        <BackgroundResult
          process={processResult}
          report={typeof asyncResult === 'string' ? asyncResult : ''}
          text={text}
        />
      </MessagePrimitive.Root>
    )
  }

  // The self-improvement review saved something to memory/skills — the same
  // kind of event as a landed `memory` write, so it wears the same chrome:
  // brain glyph with the gold→purple glow, gradient label, purple detail,
  // left-aligned in the reading column like every other scaffold line.
  const reviewNote = text.match(REVIEW_NOTE_RE)

  if (reviewNote?.groups) {
    return <ReviewRow detail={reviewNote.groups.detail.trim()} label={reviewNote.groups.label.trim()} />
  }

  const steerNote = text.match(STEER_NOTE_RE)

  if (steerNote?.groups) {
    return (
      <MessagePrimitive.Root
        className="flex max-w-[min(86%,44rem)] items-center gap-1.5 self-center px-2 py-0.5 text-[0.6875rem] leading-5 text-muted-foreground/60"
        data-role="system"
        data-slot="aui_system-message-root"
      >
        <Codicon className="text-muted-foreground/55" name="compass" size="0.75rem" />
        <span className="text-muted-foreground/55">steered</span>
        <span className="text-muted-foreground/35">·</span>
        <span className="whitespace-pre-wrap">{steerNote.groups.text.trim()}</span> <MessageTimelineTimestamp />
      </MessagePrimitive.Root>
    )
  }

  const slashStatus = text.match(SLASH_STATUS_RE)

  if (slashStatus?.groups) {
    const output = slashStatus.groups.output.trim()
    // Single-line status (e.g. "model → x") reads best centered inline; padded
    // multiline output (catalogs, usage tables) needs left-aligned, wider room
    // or the column alignment breaks.
    const multiline = output.includes('\n')
    // A window plan's /usage (token table + `[||||||    ]` plan gauges) only lines
    // up in a monospace face. Every other output keeps the default face.
    const tabular = multiline && USAGE_WINDOW_GAUGE_RE.test(output)

    return (
      <MessagePrimitive.Root
        className={cn(
          'w-[60%] max-w-[44rem] self-center px-2 py-0.5 text-[0.6875rem] leading-5 text-muted-foreground/60',
          multiline ? 'text-left' : 'text-center'
        )}
        data-role="system"
        data-slot="aui_system-message-root"
      >
        <span className="font-mono text-muted-foreground/55">{slashStatus.groups.command}</span>
        {multiline ? (
          <LinkifiedText
            className={cn('mt-0.5 block whitespace-pre-wrap', tabular && 'font-mono text-[0.65rem] leading-[1.15rem]')}
            explicitOnly
            pretty={false}
            text={output}
          />
        ) : (
          <>
            <span className="mx-1.5 text-muted-foreground/35">·</span>
            <LinkifiedText className="whitespace-pre-wrap" explicitOnly pretty={false} text={output} />
          </>
        )}{' '}
        <MessageTimelineTimestamp className={cn(multiline ? 'mt-0.5 block' : 'ml-1.5')} />
      </MessagePrimitive.Root>
    )
  }

  const multiline = text.includes('\n')

  return (
    <MessagePrimitive.Root
      className={cn(
        'w-[60%] max-w-[44rem] self-center px-2 py-0.5 text-[0.6875rem] leading-5 text-muted-foreground/55',
        multiline ? 'text-left' : 'text-center'
      )}
      data-role="system"
      data-slot="aui_system-message-root"
    >
      <LinkifiedText className="whitespace-pre-wrap" explicitOnly pretty={false} text={text} />{' '}
      <MessageTimelineTimestamp className={cn(multiline ? 'mt-0.5 block' : 'ml-1.5')} />
    </MessagePrimitive.Root>
  )
}
