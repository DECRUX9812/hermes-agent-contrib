import * as sdk from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { type CanonicalGroupAttachment, CanonicalGroupAttachments, fetchCanonicalGroupAttachment } from './canonical-group-attachments'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import type { CanonicalGroupBinding, CanonicalRoomMember } from './canonical-groups'

const MessageTextContent = typeof sdk === 'undefined' ? undefined : sdk.MessageTextContent
const Streamdown = typeof sdk === 'undefined' ? undefined : sdk.Streamdown

export interface CanonicalGroupEvent {
  seq: number
  event_id?: string
  room_id?: string
  kind: string
  payload: { text?: string; content?: string; attachments?: CanonicalGroupAttachment[]; member_id?: string; error?: string; reason?: string; reason_code?: string; status?: string }
  actor?: { kind?: string; id?: string; display_name?: string }
  created_at?: number
}

interface CanonicalGroupHistoryProps {
  binding: CanonicalGroupBinding
  events: CanonicalGroupEvent[]
  members?: CanonicalRoomMember[]
  disabled?: boolean
}

function eventAuthor(event: CanonicalGroupEvent, roster: Map<string, CanonicalRoomMember>, isMessage: boolean) {
  const memberId = isMessage
    ? event.actor?.kind === 'member' ? event.actor.id : undefined
    : event.payload.member_id

  const member = roster.get(memberId ?? '')

  // The log's label preserves who spoke even if the roster has since changed.
  return (isMessage ? event.actor?.display_name : undefined) || member?.display_name || member?.handle ||
    (isMessage ? event.actor?.id : memberId)
}

function EventTime({ short, timestamp }: { short?: boolean; timestamp?: number }) {
  if (typeof timestamp !== 'number') {return null}
  const at = new Date(timestamp * 1000)

  if (!Number.isFinite(at.getTime())) {return null}

  return <time className={short ? 'text-[0.5625rem]' : 'text-[length:var(--conversation-caption-font-size)]'} dateTime={at.toISOString()}>
    {short ? at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : sdk.relativeTime(at.getTime())}
  </time>
}

function EventBody({ event }: { event: CanonicalGroupEvent }) {
  const text = event.payload.text || event.payload.content || ''

  return <div className="min-w-0 text-[length:var(--conversation-text-font-size)] text-(--ui-text-secondary) [&_p]:mb-1 [&_p:last-child]:mb-0 [&_ul]:mb-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:mb-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_pre]:whitespace-pre-wrap [&_pre]:wrap-anywhere" data-selectable-text="true">
    {/* The shared renderer (layout and large-message safeguards). media={false}: room text
        may come from another machine, so its MEDIA: paths never resolve against this gateway;
        room files keep their own download path below. */}
    {MessageTextContent ? <MessageTextContent media={false} text={text} />
      : Streamdown ? <Streamdown>{text}</Streamdown> : text}
  </div>
}

// Previews download the whole file over RPC; larger or unsized images keep only Download.
const IMAGE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024

// Automatic previews share a small download budget per connection, in request order; a file already
// downloading is joined rather than requested again. Manual Download stays outside it. The budget is
// per connection because a remote whose dial hangs holds its slots for good, and must not stall others.
type Preview = Awaited<ReturnType<typeof fetchCanonicalGroupAttachment>>
interface PreviewQueue { slots: number; waiters: Array<() => void> }
const previewDownloads = new Map<string, Promise<Preview>>()
const previewQueues = new Map<string, PreviewQueue>()

function releasePreviewSlot(queue: PreviewQueue) {
  const next = queue.waiters.shift()

  if (next) {next()} else {queue.slots++}
}

function queuePreview(connectionId: string, key: string, fetch: () => Promise<Preview>, onPreview: (preview: Preview) => void) {
  const queue = previewQueues.get(connectionId) ?? { slots: 2, waiters: [] }
  previewQueues.set(connectionId, queue)
  let cancelled = false
  const deliver = (download: Promise<Preview>) => void download.then(preview => { if (!cancelled) {onPreview(preview)} }, () => undefined)

  const run = () => {
    let download = previewDownloads.get(key)

    if (download) {releasePreviewSlot(queue)} else {
      download = fetch().finally(() => { previewDownloads.delete(key); releasePreviewSlot(queue) })
      previewDownloads.set(key, download)
    }

    deliver(download)
  }

  const running = previewDownloads.get(key)

  if (running) {deliver(running)} else if (queue.slots > 0) {queue.slots--; run()} else {queue.waiters.push(run)}

  // A preview that leaves before its turn gives up its place without sending a request.
  return () => {
    cancelled = true
    const at = queue.waiters.indexOf(run)

    if (at >= 0) {queue.waiters.splice(at, 1)}
  }
}

function ImagePreview({ binding, eventId, attachment, disabled }: {
  binding: CanonicalGroupBinding; eventId: string; attachment: CanonicalGroupAttachment; disabled: boolean
}) {
  const [src, setSrc] = useState('')
  const [near, setNear] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const { attachment_id: attachmentId, size } = attachment
  const { connectionId, profile, roomId } = binding
  const previewable = !!attachmentId && size !== undefined && size <= IMAGE_PREVIEW_MAX_BYTES

  // History loads the whole room: fetch only near the viewport. Leaving before its turn gives up the queued place;
  // a started download runs to completion and is shared if the preview returns.
  useEffect(() => {
    const el = box.current

    if (src || disabled || !el) {return}
    const observer = new IntersectionObserver(entries => setNear(entries[entries.length - 1].isIntersecting), { rootMargin: '200px' })
    observer.observe(el)

    return () => observer.disconnect()
  }, [src, disabled])

  useEffect(() => {
    if (disabled || !near || !attachmentId || !previewable) {return}
    let url = ''
    const key = JSON.stringify([connectionId, profile, roomId, eventId, attachmentId])

    // A failed preview leaves the Download button as the way to the file.
    const cancel = queuePreview(connectionId, key, () => fetchCanonicalGroupAttachment({ connectionId, profile, roomId }, eventId, attachmentId), ({ bytes, mime }) => {
      url = URL.createObjectURL(new Blob([bytes], { type: mime }))
      setSrc(url)
    })

    // Dropping `near` makes a re-shown room wait on the observer again, not refetch every preview seen so far at once.
    return () => { cancel(); URL.revokeObjectURL(url); setSrc(''); setNear(false) }
  }, [connectionId, profile, roomId, eventId, attachmentId, disabled, near, previewable])

  return previewable ? <div ref={box}>{src && <img alt={attachment.name} className="max-h-64 max-w-full rounded object-contain" src={src} />}</div> : null
}

/** Who a message belongs to — the grouping key, independent of display names. */
function eventSpeakerKey(event: CanonicalGroupEvent): string {
  if (event.actor?.kind) {
    return `${event.actor.kind}:${event.actor.id ?? event.actor.display_name ?? ''}`
  }

  return event.payload.member_id ? `member:${event.payload.member_id}` : ''
}

/** A deterministic face seed for the speaker — member profile first, so the
 *  room face matches the roster face for the same bot. */
function eventFaceSeed(event: CanonicalGroupEvent, member?: CanonicalRoomMember): string {
  return member?.profile || member?.handle || member?.display_name || event.actor?.display_name ||
    event.actor?.id || event.payload.member_id || 'bot'
}

function SpeakerFace({ event, member }: { event: CanonicalGroupEvent; member?: CanonicalRoomMember }) {
  if (event.actor?.kind === 'user') {
    return <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-(--ui-bg-quaternary) text-[0.625rem] text-(--ui-text-tertiary)">
      <sdk.Codicon name="account" />
    </span>
  }

  const { shape, color, image } = botAppearance(eventFaceSeed(event, member), undefined)

  return <BotFace color={avatarColor(color, eventFaceSeed(event, member))} image={image || null} name={eventFaceSeed(event, member)} shape={shape} size={20} />
}

interface EventRowProps {
  author?: string
  binding: CanonicalGroupBinding
  continuation: boolean
  disabled: boolean
  event: CanonicalGroupEvent
  member?: CanonicalRoomMember
}

function EventRow({ author, binding, continuation, disabled, event, member }: EventRowProps) {
  const previewEventId = event.room_id === binding.roomId ? event.event_id : undefined

  return <div className={sdk.cn('group/msg grid grid-cols-[24px_minmax(0,1fr)] gap-x-2 px-2', continuation ? 'py-0.5' : 'pt-2 pb-0.5')} data-seq={event.seq}>
    <div className="pt-0.5">
      {continuation
        ? <span className="flex justify-center text-(--ui-text-quaternary) opacity-0 transition-opacity group-hover/msg:opacity-100"><EventTime short timestamp={event.created_at} /></span>
        : <SpeakerFace event={event} member={member} />}
    </div>
    <div className="min-w-0">
      {continuation ? null : (
        <div className="flex items-baseline gap-2">
          {author && <strong className="text-[length:var(--conversation-text-font-size)] font-semibold text-(--ui-accent)">{author}</strong>}
          <EventTime timestamp={event.created_at} />
        </div>
      )}
      <EventBody event={event} />
      {previewEventId && event.payload.attachments?.filter(a => a.kind === 'image').map(a =>
        <ImagePreview attachment={a} binding={binding} disabled={disabled} eventId={previewEventId} key={a.attachment_id ?? a.name} />)}
      {!!event.payload.attachments?.length && <CanonicalGroupAttachments
        attachments={event.payload.attachments.map(attachment => ({ ...attachment, event_id: event.event_id }))}
        binding={binding} disabled={disabled || !event.event_id || event.room_id !== binding.roomId} readOnly />}
    </div>
  </div>
}

function NoticeRow({ detail, event, notice, who }: { detail?: string; event: CanonicalGroupEvent; notice: string; who?: string }) {
  return <div className="flex items-baseline gap-2 px-2 py-1" data-seq={event.seq}>
    <sdk.Codicon aria-hidden className="shrink-0 self-center text-[0.625rem] text-(--ui-text-quaternary)" name="info" />
    <p className="min-w-0 flex-1 text-[length:var(--conversation-tool-font-size)] text-(--ui-text-tertiary)" data-selectable-text="true">
      <strong className="font-medium">{notice}</strong>
      {who && <> — <span className="text-(--ui-text-quaternary)">{who}</span></>}
      {detail && <> — <span className="text-(--ui-text-quaternary)">{detail}</span></>}
    </p>
    <EventTime timestamp={event.created_at} />
  </div>
}

// Back-to-back same-speaker messages within this window group under one header.
const GROUP_WINDOW_S = 300

export function CanonicalGroupHistory({ binding, events, members = [], disabled = false }: CanonicalGroupHistoryProps) {
  const labels = useCanonicalGroupLabels()
  const roster = new Map(members.map(member => [member.member_id, member]))

  const notices = new Map([
    ['turn.failed', labels.turnFailed],
    ['turn.cancelled', labels.turnCancelled],
    ['turn.deferred', labels.turnDeferred],
    ['member.unavailable', labels.memberUnavailable],
    ['room.stop_requested', labels.roomStopped],
    ['room.disbanded', labels.roomDisbanded],
    ['authority.lost', labels.authorityLost]
  ])

  let prevSpeakerKey = ''
  let prevSpeakerAt = 0

  return <>{events.map(event => {
    const notice = event.kind === 'room.activity' && event.payload.status === 'bounded'
      ? labels.workLimitReached : notices.get(event.kind)

    const isMessage = event.kind === 'message' || event.kind === 'message.user' || event.kind === 'message.member'

    if (!notice && !isMessage) {return null}

    if (notice) {
      // A status line is its own beat — the speaker group ends before it.
      prevSpeakerKey = ''
      prevSpeakerAt = 0
      const member = roster.get(event.payload.member_id ?? '')

      return <NoticeRow
        detail={event.payload.error || event.payload.reason || event.payload.reason_code}
        event={event}
        key={event.seq}
        notice={notice}
        who={member ? member.display_name || member.handle : undefined} />
    }

    const speakerKey = eventSpeakerKey(event)
    const at = typeof event.created_at === 'number' ? event.created_at : 0
    const continuation = Boolean(speakerKey) && speakerKey === prevSpeakerKey && (!at || !prevSpeakerAt || at - prevSpeakerAt < GROUP_WINDOW_S)
    prevSpeakerKey = speakerKey
    prevSpeakerAt = at

    const member = event.actor?.kind === 'member' ? roster.get(event.actor.id ?? '') : roster.get(event.payload.member_id ?? '')

    return <EventRow
      author={eventAuthor(event, roster, true)}
      binding={binding}
      continuation={continuation}
      disabled={disabled}
      event={event}
      key={event.seq}
      member={member} />
  })}</>
}
