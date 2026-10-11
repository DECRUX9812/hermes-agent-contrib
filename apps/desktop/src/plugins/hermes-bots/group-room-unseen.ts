/**
 * What the reader HASN'T SEEN in a room — both of its signals, in one place
 * (the room view stays under the 2,000-line cap):
 *
 *   unseen      — the log's own jump pill: how many entries arrived while the
 *                 reader was up in history, and the jump that takes them back.
 *   unseenByThread — the rail's per-thread nudge: which threads GREW while the
 *                 reader was somewhere else, and by how much.
 *
 * The rule behind both is deliberately narrow, because a nudge that fires for
 * things you already saw is worse than no nudge at all:
 *
 *   - Opening a room marks every thread in it read — you are looking at all
 *     of it, so its history is not news.
 *   - Following the live log at the bottom keeps marking read as entries land,
 *     and so does scrolling back down to the tail. What scrolls past you is
 *     read; you were watching it.
 *   - Scrolling UP into history stops the marking, and so does focusing one
 *     thread — from then on only that thread's arrivals count as read.
 *   - Opening a thread marks just that thread.
 *
 * A mark only ever moves forward, so re-opening a stale thread can never
 * un-read something that arrived since. Runtime-only, like the room's own read
 * marks: a restart re-seeds from the hydrated log instead of resurrecting
 * stale badges.
 */

import { useValue } from '@hermes/plugin-sdk'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'

import { groupChatRoomKey } from './group-chat'
import {
  $groupThreadReadAt,
  groupThreadMarksFor,
  groupThreadUnseenCounts,
  markGroupThreadsRead,
  noteGroupThreadsSeen
} from './group-unread'
import type { GroupChat, GroupMessage } from './types'

/** How close to the bottom counts as "parked at the tail". */
const NEAR_BOTTOM_PX = 80

export interface RoomUnread {
  /** Mark what the reader is looking at read: one thread (they opened it), or
   *  the whole room — null, All activity — when they chose to see it all. */
  markRead: (thread: null | string) => void
  /** The log scrolled: update the read position and, when the reader is back
   *  at the tail, stop nudging. */
  onLogScroll: () => void
  /** Scroll the log to its newest entry and clear the pill. */
  jumpToLatest: () => void
  /** True while the reader is up in history (the pill is showing). */
  readingHistory: boolean
  /** Entries that arrived while the reader was up in history (the pill). */
  unseen: number
  /** Thread → member entries that arrived while they were elsewhere (rail). */
  unseenByThread: Readonly<Record<string, number>>
}

export function useRoomUnread({
  bottomSentinel,
  focusThread,
  group,
  log,
  logRunning,
  room,
  scroller,
  stickToBottom,
  visible
}: {
  /** The log's end marker, scrolled into view by jump/auto-follow. */
  bottomSentinel: RefObject<HTMLDivElement | null>
  /** The thread on screen, or null for All activity. */
  focusThread: null | string
  group: string
  log: readonly GroupMessage[]
  /** Whether the room is mid-turn — a fresh arrival re-anchors the log. */
  logRunning?: boolean
  /** Whether this pane is on screen (retained panes stay mounted while hidden). */
  visible: boolean
  room: GroupChat
  /** The log's own overflow div: the scroller. */
  scroller: RefObject<HTMLDivElement | null>
  /** True while the reader is parked at the log's tail. */
  stickToBottom: RefObject<boolean>
}): RoomUnread {
  const roomKey = groupChatRoomKey(group, room)

  // First sight of this room, however it was reached (openGroupChat's main
  // tab, or the in-pane fallback): its history counts as read, so both
  // signals only ever mean what arrived after this point. Idempotent and
  // forward-only, so a retained pane's later mounts are no-ops.
  const seenRoomRef = useRef<string | null>(null)

  if (seenRoomRef.current !== roomKey) {
    seenRoomRef.current = roomKey
    noteGroupThreadsSeen(group)
  }

  // What is on screen is read: one thread when one is focused, otherwise the
  // whole room. Callers only reach this when the reader really is looking —
  // parked at the tail, or a thread they just opened.
  const markRead = (thread: null | string) => {
    markGroupThreadsRead(group, thread ? [thread] : undefined)
  }

  // Log length when the reader left the bottom (null = following along);
  // everything past it is what they haven't seen.
  const [leftAtLength, setLeftAtLength] = useState<null | number>(null)
  const unseen = leftAtLength === null ? 0 : Math.max(0, log.length - leftAtLength)

  const jumpToLatest = () => {
    stickToBottom.current = true
    setLeftAtLength(null)
    bottomSentinel.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }

  // Retained-pane reopen (#89835 follow-up): a hot-mounted room pane stays
  // mounted while another workspace tab is active, so returning to it never
  // remounts and the mount-time anchor doesn't rerun. Re-anchor on the
  // hidden → visible edge — an explicit reopen, so it overrides a stale
  // read-position and mirrors what a fresh open does.
  const wasVisibleRef = useRef(visible)

  // eslint-disable-next-line no-restricted-syntax -- previous-value tracker for the hidden → visible edge; lagging a render IS the contract
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      stickToBottom.current = true
      setLeftAtLength(null)
      bottomSentinel.current?.scrollIntoView({ block: 'end' })
    }

    wasVisibleRef.current = visible
    // The refs are the point: they hold the pane's live anchor, not render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const onLogScroll = () => {
    const viewport = scroller.current

    if (!viewport) {
      return
    }

    const near = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < NEAR_BOTTOM_PX
    stickToBottom.current = near
    setLeftAtLength(current => (near ? null : (current ?? log.length)))

    // Back at the tail: they can see it all again, so the rail stops nudging.
    if (near) {
      markRead(focusThread)
    }
  }

  // Auto-follow: the log stays pinned to the bottom while the reader is
  // parked there, and what lands there is read as it lands. Scroll up and the
  // badges start again — only what shows up while you are elsewhere counts.
  useEffect(() => {
    if (stickToBottom.current) {
      bottomSentinel.current?.scrollIntoView({ block: 'end' })
      markRead(focusThread)
    }
    // markRead/focusThread are stable per render pass; the refs are the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.length, logRunning, focusThread])

  const readMarks = useValue($groupThreadReadAt)

  return {
    jumpToLatest,
    markRead,
    readingHistory: leftAtLength !== null,
    onLogScroll,
    unseen,
    unseenByThread: groupThreadUnseenCounts(log, groupThreadMarksFor(readMarks, roomKey))
  }
}
