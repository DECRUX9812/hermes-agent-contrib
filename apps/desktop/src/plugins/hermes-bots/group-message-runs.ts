import { groupThreadOf } from './group-chat'
import type { GroupMember, GroupMessage, GroupMessageAuthor } from './types'

export const SPEAKER_RUN_GAP_MS = 5 * 60 * 1000

const LONG_REPLY_CHARS = 1200
const LONG_REPLY_LINES = 14

export function startsSpeakerRun(previous: GroupMessage | null | undefined, entry: GroupMessage): boolean {
  if (!previous) {
    return true
  }

  return (
    previous.from?.kind !== entry.from?.kind ||
    previous.from?.name !== entry.from?.name ||
    (previous.from?.source || '') !== (entry.from?.source || '') ||
    groupThreadOf(previous) !== groupThreadOf(entry) ||
    entry.at - previous.at > SPEAKER_RUN_GAP_MS
  )
}

export function isLongReply(text: string): boolean {
  return text.length > LONG_REPLY_CHARS || text.split('\n').length > LONG_REPLY_LINES
}

function speakerKey(name: string, source: string): string {
  return `${source}\u0000${name}`
}

// Keeps the first member per key, so a lookup returns what a linear `find` would.
export function indexMembersBySpeaker(members: GroupMember[]): Map<string, GroupMember> {
  const index = new Map<string, GroupMember>()

  const add = (key: string, member: GroupMember) => {
    if (!index.has(key)) {
      index.set(key, member)
    }
  }

  for (const member of members) {
    if (!member.remoteSource) {
      add(speakerKey(member.name, ''), member)
    }

    const source = member.connectionLabel || member.connectionId

    if (source) {
      add(speakerKey(member.name, source), member)
    }
  }

  return index
}

export function memberForSpeaker(index: Map<string, GroupMember>, from: GroupMessageAuthor): GroupMember | null {
  return index.get(speakerKey(from.name, from.source || '')) || null
}
