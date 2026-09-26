import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'

import { buildSessionRecap, SESSION_RECAP_IDLE_MS } from './session-recap'

const NOW = 1_800_000_000_000 // ms

const msg = (role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `${role}-${text.slice(0, 6)}-${extra.timestamp ?? ''}`,
  parts: text ? [{ text, type: 'text' }] : [],
  role,
  ...extra
})

const IDLE = SESSION_RECAP_IDLE_MS

describe('buildSessionRecap', () => {
  it('returns null for an empty transcript and for one fresher than the idle threshold', () => {
    expect(buildSessionRecap([], IDLE, NOW)).toBeNull()

    const fresh = [msg('user', 'hi', { timestamp: NOW / 1000 - 60 }), msg('assistant', 'hello', { timestamp: NOW / 1000 - 30 })]

    expect(buildSessionRecap(fresh, IDLE, NOW)).toBeNull()
  })

  it('summarizes an idle transcript: newest assistant line, user turns, tail timestamp', () => {
    const tailSec = NOW / 1000 - IDLE / 1000 - 5

    const messages = [
      msg('user', 'first question', { timestamp: tailSec - 300 }),
      msg('assistant', 'first answer\nsecond line is not shown', { timestamp: tailSec - 200 }),
      msg('user', 'second question', { timestamp: tailSec - 100 }),
      msg('assistant', 'last reply', { completedAt: tailSec, timestamp: tailSec - 2 })
    ]

    expect(buildSessionRecap(messages, IDLE, NOW)).toEqual({
      lastAssistantLine: 'last reply',
      lastActivitySec: tailSec,
      userTurns: 2
    })
  })

  it('ignores hidden and interim bubbles but still anchors idle on the newest visible message', () => {
    const tailSec = NOW / 1000 - IDLE / 1000 - 5

    const messages = [
      msg('assistant', 'kept answer', { timestamp: tailSec }),
      msg('assistant', 'hidden', { hidden: true, timestamp: tailSec + 10 }),
      msg('assistant', 'interim scratch', { interim: true, timestamp: tailSec + 20 })
    ]

    expect(buildSessionRecap(messages, IDLE, NOW)?.lastAssistantLine).toBe('kept answer')
    expect(buildSessionRecap(messages, IDLE, NOW)?.lastActivitySec).toBe(tailSec)
  })

  it('stays quiet while a turn is in flight', () => {
    const tailSec = NOW / 1000 - IDLE / 1000 - 5

    expect(buildSessionRecap([msg('assistant', 'draft so far', { pending: true, timestamp: tailSec })], IDLE, NOW)).toBeNull()
  })

  it('truncates a long first line for the strip', () => {
    const tailSec = NOW / 1000 - IDLE / 1000 - 5
    const longLine = 'x'.repeat(200)

    const recap = buildSessionRecap([msg('assistant', longLine, { timestamp: tailSec })], IDLE, NOW)

    expect(recap?.lastAssistantLine?.length).toBe(140)
    expect(recap?.lastAssistantLine?.endsWith('…')).toBe(true)
  })
})
