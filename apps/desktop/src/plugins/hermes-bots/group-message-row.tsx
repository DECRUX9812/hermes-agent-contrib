import type * as sdk from '@hermes/plugin-sdk'
import { Button, cn, Codicon, CopyButton, relativeTime, Tip } from '@hermes/plugin-sdk'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import type { groupMentionComponents, groupMentionText } from './group-mention-text'
import { isLongReply } from './group-message-runs'
import { withoutTextLine } from './group-room-handoffs'
import { useBots } from './i18n'
import type { BotMeta, GroupMember, GroupMessage } from './types'

/** Shared bubble width cap for BOTH sides of the room. The user row mirrors
 *  the bot row's avatar gutter (pl-2/pr-11 vs px-2 + 26px face + gap), so the
 *  two content columns are the same width — one percentage here keeps the
 *  left and right edges of long messages perfectly aligned. */
const GROUP_BUBBLE_MAX_W = 'max-w-[85%]'

// Focus mode: history quiets, the live exchange stays lit. Hover or tab-focus
// restores a dimmed row — nothing is ever unreachable.
const DIMMED_ROW = 'opacity-30 transition-opacity hover:opacity-100 focus-within:opacity-100'

export interface GroupMessageRowProps {
  /** Landed while the room was open: the row eases in. */
  arrived?: boolean
  dimmed: boolean
  display: string
  entry: GroupMessage
  /** 0-based line of the entry text a chip below already says; hidden here. */
  handoffLine?: number
  index: number
  label: string
  lead: boolean
  mentionComponents: ReturnType<typeof groupMentionComponents>
  mentionText: ReturnType<typeof groupMentionText>
  MessageTextContent?: typeof sdk.MessageTextContent
  member: GroupMember | null
  meta: BotMeta | null | undefined
  onOpenThread: (() => void) | null
  onReply: () => void
  onToggleReveal: () => void
  replyTag: string
  revealed: boolean
  /** This room's role label for the speaker; falls back to `roleTitle`. */
  roomRole?: string
  roleTitle: string
  runStart: boolean
  Streamdown?: typeof sdk.Streamdown
}

export function GroupMessageRow({
  arrived = false,
  dimmed,
  display,
  entry,
  handoffLine,
  index,
  label,
  lead,
  mentionComponents,
  mentionText,
  MessageTextContent,
  member,
  meta,
  onOpenThread,
  onReply,
  onToggleReveal,
  replyTag,
  revealed,
  roomRole,
  roleTitle,
  runStart,
  Streamdown
}: GroupMessageRowProps) {
  const b = useBots()
  const [expanded, setExpanded] = useState(false)
  const isUser = entry.from.kind === 'user'
  const entryKey = `${entry.at}:${index}`
  const appearance = isUser ? null : botAppearance(entry.from.name, meta)
  const image = appearance?.image ?? null
  const photo = Boolean(image && !isBackfilledFacePng(image))
  const speakerColor = appearance ? avatarColor(appearance.color, entry.from.name) : null
  const long = !isUser && isLongReply(entry.text)
  const clamped = long && !expanded
  // The handoff protocol line duplicates the chip below it: hide exactly the
  // line the parser consumed, and only when a chip is shown for it.
  const shownText = !isUser && handoffLine !== undefined && handoffLine >= 0 ? withoutTextLine(entry.text, handoffLine) : entry.text

  const body = (
    <div
      className={cn(
        'min-w-0 text-ui-sm text-fg [&_p]:mb-1 [&_p:last-child]:mb-0 [&_ul]:mb-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:mb-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere',
        clamped && 'max-h-64 overflow-hidden mask-b-from-75%'
      )}
      // The app shell sets user-select: none globally; message bodies opt
      // back in so drag-select and ⌘C work in group chat logs.
      data-selectable-text="true"
      data-slot="group-chat-message-content"
    >
      {MessageTextContent ? (
        <MessageTextContent decorateText={mentionText} media={!member?.remoteSource} text={shownText} />
      ) : Streamdown ? (
        <Streamdown components={mentionComponents}>{shownText}</Streamdown>
      ) : (
        shownText
      )}
    </div>
  )

  const attachments =
    Array.isArray(entry.images) && entry.images.length ? (
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {entry.images.map((img, imgIndex) =>
          img.kind === 'pdf' || img.kind === 'file' ? (
            <div
              className="flex items-center gap-1 rounded-control border border-line px-1.5 py-1 text-ui-2xs text-fg-muted"
              key={`${entryKey}:img:${imgIndex}`}
              title={img.name || 'attached file'}
            >
              <Codicon className="text-ui-xs" name={img.kind === 'pdf' ? 'file-pdf' : 'file'} />
              <span className="max-w-48 truncate">{img.name || 'attached file'}</span>
            </div>
          ) : (
            <img
              alt={img.name || 'attached image'}
              className="max-h-40 max-w-60 rounded-control border border-line object-contain"
              key={`${entryKey}:img:${imgIndex}`}
              src={img.data}
              title={img.name || 'attached image'}
            />
          )
        )}
      </div>
    ) : null

  // Your own lines are right-aligned bubbles reusing the 1:1 thread's
  // user-bubble tokens so the room reads like the same chat surface.
  if (isUser) {
    return (
      <div
        className={cn(
          'group flex flex-col items-end gap-0.5 pl-2 pr-11',
          runStart && index > 0 && 'pt-1.5',
          dimmed && DIMMED_ROW,
          arrived && 'motion-arrive'
        )}
        data-entry-index={index}
      >
        <div className="flex items-baseline gap-1.5 px-1 text-ui-2xs text-fg-subtle">
          {entry.text.trim() ? (
            <span className="opacity-0 pointer-events-none transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
              <CopyButton appearance="icon" buttonSize="icon" stopPropagation text={entry.text} />
            </span>
          ) : null}
          {runStart ? <span className="text-ui-xs font-semibold text-fg-muted">{label}</span> : null}
          <span>{relativeTime(entry.at)}</span>
        </div>
        <div
          className={cn(
            'rounded-card border border-line bg-surface-raised px-3 py-1.5',
            GROUP_BUBBLE_MAX_W
          )}
        >
          {body}
          {attachments}
        </div>
      </div>
    )
  }

  // Every line keeps Reply + Copy: in the run header on a run's first line,
  // floating over the line's top-right on continuations.
  const actions = (
    <div
      className={cn(
        'flex shrink-0 items-center gap-0.5 opacity-0 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
        runStart
          ? 'ml-auto'
          : 'absolute right-2 -top-1 z-10 rounded-control border border-line bg-surface-raised shadow-e2'
      )}
    >
      <Tip label={`Reply to @${replyTag}`}>
        <Button
          aria-label={`Reply to ${display}`}
          className="text-fg-muted hover:text-fg"
          onClick={onReply}
          size="icon"
          variant="ghost"
        >
          <Codicon name="reply" />
        </Button>
      </Tip>
      {entry.text.trim() ? (
        <CopyButton appearance="icon" buttonSize="icon" stopPropagation text={entry.text} />
      ) : null}
    </div>
  )

  // Long replies stay scannable in the room: clamp, then expand in place or
  // open the thread they belong to.
  const longActions = long ? (
    <div className="mt-1 flex items-center gap-3 px-1">
      <Button
        className="text-ui-2xs text-fg-muted hover:text-fg"
        onClick={() => setExpanded(current => !current)}
        size="inline"
        variant="text"
      >
        {expanded ? b.group.showLess : b.group.showMore}
      </Button>
      {onOpenThread ? (
        <Button className="text-ui-2xs text-fg-muted hover:text-fg" onClick={onOpenThread} size="inline" variant="text">
          {b.group.openThread}
        </Button>
      ) : null}
    </div>
  ) : null

  return (
    <div
      className={cn(
        'group relative flex items-start gap-3',
        runStart && index > 0 && 'pt-1.5',
        dimmed && DIMMED_ROW,
        arrived && 'motion-arrive'
      )}
      data-entry-index={index}
      // The speaker's resolved hue rides the row as a custom property, not an
      // inline color on each painted element: consumers (this file's dot and
      // name, and any theme/plugin layer) recolor the whole voice by
      // overriding --speaker-color in CSS without touching markup.
      // Mixed toward the foreground so a dark avatar hue still reads on a dark
      // room (raw hues like a deep brown vanished into the background).
      style={
        {
          '--speaker-color': speakerColor
            ? `color-mix(in oklab, ${speakerColor} 62%, var(--color-foreground))`
            : undefined
        } as CSSProperties
      }
    >
      <div className="w-8 shrink-0 self-start">
        {runStart ? (
          <div className="mt-0.5">
            <BotFace
              color={speakerColor || ''}
              image={photo ? image : null}
              name={entry.from.name}
              shape={appearance ? appearance.shape : 'squircle'}
              size={32}
            />
          </div>
        ) : (
          // Continuation lines reveal their timestamp in the avatar gutter
          // on hover (the Slack idiom) — the run header stays uncluttered.
          <div className="pt-1 text-center text-ui-2xs text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100">
            {relativeTime(entry.at)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {runStart ? (
          <div className="flex items-center gap-1.5">
            {/* Speaker dot: the run header's at-a-glance identity — two bots
                replying back to back are tellable by dot color before the
                name is read. Both dot and name read --speaker-color off the
                row, so a theme layer recolors a voice with one CSS override. */}
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-(--speaker-color)" data-testid="group-speaker-dot" />
            <Tip label={revealed ? 'Hide full handle' : 'Show full handle'}>
              <Button
                className="text-left text-ui-sm font-semibold text-(--speaker-color)"
                onClick={onToggleReveal}
                size="inline"
                variant="text"
              >
                {label}
              </Button>
            </Tip>
            {/* The room as a squad: who leads, and what each voice is for. */}
            {lead ? (
              <Tip label={b.group.roomLead}>
                <span aria-label={b.group.roomLead} data-testid="group-speaker-lead">
                  <Codicon className="text-ui-2xs text-fg-subtle" name="star-full" />
                </span>
              </Tip>
            ) : null}
            {(roomRole || roleTitle) ? (
              <span className="max-w-40 truncate text-ui-xs text-fg-muted" data-testid="group-speaker-role">
                {roomRole || roleTitle}
              </span>
            ) : null}
            <span className="text-ui-2xs text-fg-subtle">{relativeTime(entry.at)}</span>
            {actions}
          </div>
        ) : (
          actions
        )}
        {shownText.trim() || attachments ? (
          <div className="max-w-[760px]">
            {shownText.trim() ? body : null}
            {attachments}
          </div>
        ) : null}
        {longActions}
      </div>
    </div>
  )
}
