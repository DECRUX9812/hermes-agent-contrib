import { describe, expect, it } from 'vitest'

import {
  indexMembersBySpeaker,
  isLongReply,
  memberForSpeaker,
  SPEAKER_RUN_GAP_MS,
  startsSpeakerRun
} from './group-message-runs'
import type { GroupMember, GroupMessage } from './types'

function line(at: number, overrides: Partial<GroupMessage['from']> & { thread?: string } = {}): GroupMessage {
  const { thread = 'a', ...from } = overrides

  return {
    at,
    from: { kind: 'member', name: 'builder', ...from },
    text: 'hi',
    thread
  }
}

describe('startsSpeakerRun', () => {
  it('opens a run when there is no previous line', () => {
    expect(startsSpeakerRun(null, line(1))).toBe(true)
  })

  it('continues the same voice inside the gap, including exactly at the limit', () => {
    expect(startsSpeakerRun(line(0), line(SPEAKER_RUN_GAP_MS))).toBe(false)
  })

  it('breaks the run once more than the gap has passed', () => {
    expect(startsSpeakerRun(line(0), line(SPEAKER_RUN_GAP_MS + 1))).toBe(true)
  })

  it('breaks the run when the voice, kind, source or thread changes', () => {
    expect(startsSpeakerRun(line(0), line(1, { name: 'reviewer' }))).toBe(true)
    expect(startsSpeakerRun(line(0), line(1, { source: 'mini' }))).toBe(true)
    expect(startsSpeakerRun(line(0), line(1, { thread: 'b' }))).toBe(true)
    expect(startsSpeakerRun(line(0), line(1, { kind: 'user' }))).toBe(true)
  })
})

describe('isLongReply', () => {
  it('leaves short and boundary-length replies unclamped', () => {
    expect(isLongReply('short')).toBe(false)
    expect(isLongReply('x'.repeat(1200))).toBe(false)
    expect(isLongReply(Array.from({ length: 14 }, () => 'line').join('\n'))).toBe(false)
  })

  it('clamps replies past the character or line limit', () => {
    expect(isLongReply('x'.repeat(1201))).toBe(true)
    expect(isLongReply(Array.from({ length: 15 }, () => 'line').join('\n'))).toBe(true)
  })
})

describe('memberForSpeaker', () => {
  const local = { name: 'builder' } as GroupMember

  const remote = {
    name: 'builder',
    connectionId: 'conn-7',
    connectionLabel: 'mini',
    remoteSource: true
  } as GroupMember

  const index = indexMembersBySpeaker([local, remote])

  it('matches a sourceless speaker to the member on this gateway', () => {
    expect(memberForSpeaker(index, { kind: 'member', name: 'builder' })).toBe(local)
  })

  it('matches a source-qualified speaker by connection label', () => {
    expect(memberForSpeaker(index, { kind: 'member', name: 'builder', source: 'mini' })).toBe(remote)
  })

  it('returns no member for an unknown source or a remote-only member without one', () => {
    expect(memberForSpeaker(index, { kind: 'member', name: 'builder', source: 'elsewhere' })).toBeNull()
    expect(
      memberForSpeaker(indexMembersBySpeaker([remote]), { kind: 'member', name: 'builder' })
    ).toBeNull()
  })
})
