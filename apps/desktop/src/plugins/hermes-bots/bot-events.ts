/**
 * Inbound event derivation (bot-mode G5) — pure, directly tested.
 *
 * The cards are a read-only projection of signals the renderer already holds:
 * mailbox notes addressed to the bot (its `to.kind === 'bot'` identity, shared
 * with the roster badge via `noteAddressesMember`), the relay lane and the
 * recorded attention flag, and `cron.manage` job completions. Everything the
 * component needs to know about React, atoms, and RPC lives in
 * bot-events-view.tsx; this file never imports them.
 */

import { routineRunTitle } from './bot-runs'
import { type MailboxNote, noteAddressesMember } from './mailbox'
import type { GroupMember, RoutineJob } from './types'

/** Recency window for settled events — an 'open' mailbox note is pending
 *  forever, but a done/declined one and a routine completion age out. */
export const INBOUND_WINDOW_MS = 24 * 60 * 60 * 1000

const INBOUND_LIMIT = 6

export type BotEventKind = 'mail' | 'relay' | 'routine'

export interface BotInboundEvent {
  /** Where the card's link goes, when it has one. */
  action?: 'group' | 'routines'
  /** Milliseconds epoch — cards sort newest first. */
  at: number
  /** Codicon name — the provenance glyph. */
  icon: string
  id: string
  kind: BotEventKind
  /** Source name (mailbox sender, routine title); may be empty. */
  label: string
  /** Classified attention reason when the card is a relay failure. */
  reason?: string
  /** Group room name when action === 'group'. */
  room?: string
  status: 'attention' | 'failed' | 'ok' | 'running'
  /** Detail text after the label; may be empty. */
  summary: string
}

export interface BotInboundSignals {
  attention: { at: number; message: string; reason: string } | null
  jobs: RoutineJob[]
  /** The bot's mailbox identity — name/handle/connectionId, the same triple
   *  the roster badge matches on. */
  member: GroupMember
  notes: MailboxNote[]
  /** Milliseconds epoch (Date.now()). Mailbox `created_at`/`updated_at`
   *  arrive as epoch SECONDS — converted inside. */
  now: number
  relayInflight: boolean
}

function firstLine(text: unknown): string {
  return (
    String(text || '')
      .split('\n')
      .map(line => line.trim())
      .find(Boolean) || ''
  )
}

/** Provenance glyph for a mailbox note's kind. 'task' (the default) is the
 *  bot-to-bot letter; webhook/git-style kinds get their own marks so a PR
 *  event doesn't read as mail. */
function noteIcon(kind: unknown): string {
  const k = String(kind || 'task').toLowerCase()

  if (k === 'webhook' || k === 'hook') {
    return 'broadcast'
  }

  if (k === 'git' || k.startsWith('git-')) {
    return 'git-merge'
  }

  return k === 'task' ? 'mail' : 'inbox'
}

function senderLabel(note: MailboxNote): string {
  const sender = note?.sender

  return String(sender?.name || sender?.handle || sender?.profile || '').trim()
}

/** Cards the inbound strip shows for one bot, newest first, capped at
 *  INBOUND_LIMIT. */
export function deriveInboundEvents(signals: BotInboundSignals): BotInboundEvent[] {
  const events: BotInboundEvent[] = []
  const now = signals.now

  if (signals.relayInflight) {
    events.push({
      at: now,
      icon: 'sync',
      id: 'relay:inflight',
      kind: 'relay',
      label: '',
      status: 'running',
      summary: ''
    })
  }

  if (signals.attention && Number(signals.attention.at) > 0) {
    const at = Number(signals.attention.at)

    events.push({
      at,
      icon: 'warning',
      id: `relay:attention:${at}`,
      kind: 'relay',
      label: '',
      reason: String(signals.attention.reason || ''),
      status: 'attention',
      summary: firstLine(signals.attention.message)
    })
  }

  for (const note of Array.isArray(signals.notes) ? signals.notes : []) {
    if (!note?.id || !noteAddressesMember(note, signals.member)) {
      continue
    }

    const open = note.status === 'open'
    // created_at/updated_at arrive as epoch seconds.
    const at = (Number(note.updated_at || 0) || Number(note.created_at || 0)) * 1000

    if (!open && (!at || now - at > INBOUND_WINDOW_MS)) {
      continue
    }

    events.push({
      action: note.room ? 'group' : undefined,
      at,
      icon: noteIcon(note.kind),
      id: `mail:${note.connectionId || ''}:${note.id}`,
      kind: 'mail',
      label: senderLabel(note),
      room: note.room ? String(note.room) : undefined,
      status: note.status === 'declined' ? 'failed' : 'ok',
      summary: firstLine(note.title) || firstLine(note.body)
    })
  }

  for (const job of Array.isArray(signals.jobs) ? signals.jobs : []) {
    const at = Date.parse(String(job?.last_run_at || ''))

    if (!Number.isFinite(at) || now - at > INBOUND_WINDOW_MS) {
      continue
    }

    const failed = Boolean(job.last_status) && job.last_status !== 'ok'

    events.push({
      action: 'routines',
      at,
      icon: 'watch',
      id: `routine:${job.job_id}:${at}`,
      kind: 'routine',
      label: routineRunTitle(job),
      status: failed ? 'failed' : 'ok',
      summary: failed ? firstLine(job.last_fire_error) || firstLine(job.last_delivery_error) : ''
    })
  }

  events.sort((a, b) => b.at - a.at)

  return events.slice(0, INBOUND_LIMIT)
}
