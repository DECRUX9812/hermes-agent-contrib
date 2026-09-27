/**
 * D2 — group goal + round summary invariants.
 *
 *   1. `groupRoundContributions` reads the round as the log's tail after the
 *      LAST user entry: one line per member (the first non-blank line of
 *      their first reply), members before the boundary never counted.
 *   2. `setGroupChatGoal` persists the goal through the room's normal durable
 *      record — same updateGroupChat door as image/holdDetection, so it rides
 *      the same ui_meta sync.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GroupMessage } from './types'

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

interface Chat {
  chat: typeof import('./group-chat')
}

async function loadChat(): Promise<Chat & { storage: Map<string, unknown> }> {
  vi.resetModules()

  for (const key of Object.keys(host)) {
    delete host[key]
  }

  const { createGroupGateway, pluginSdkMock: _unused, scriptedStorage } = await import('./group-test-utils')
  const gateway = createGroupGateway()

  Object.assign(host, gateway.host)

  const [chat, shared] = await Promise.all([import('./group-chat'), import('./shared')])

  shared.setPluginCtx(scriptedStorage(gateway.storage))

  return { chat, storage: gateway.storage }
}

const msg = (kind: 'member' | 'user', name: string, text: string): GroupMessage =>
  ({ at: Date.now(), from: { kind, name }, text }) as GroupMessage

describe('groupRoundContributions', () => {
  it('lists one first-line contribution per member in the tail after the last user entry', async () => {
    const { chat } = await loadChat()

    const room = {
      log: [
        msg('member', 'old-bot', 'from a previous round — never counted'),
        msg('user', 'You', 'compare the two approaches'),
        msg('member', 'research', 'Vector search wins on recall\nwith a longer second line'),
        msg('member', 'builder', '   \nKeyword is cheaper to operate'),
        msg('member', 'research', 'a follow-up — ignored, first message wins')
      ]
    }

    expect(chat.groupRoundContributions(room)).toEqual([
      { line: 'Vector search wins on recall', name: 'research' },
      { line: 'Keyword is cheaper to operate', name: 'builder' }
    ])
  })

  it('returns [] when no round has landed (no member entries after the last prompt)', async () => {
    const { chat } = await loadChat()

    expect(chat.groupRoundContributions({ log: [msg('user', 'You', 'hello')] })).toEqual([])
    expect(chat.groupRoundContributions({ log: [] })).toEqual([])
  })
})

describe('setGroupChatGoal', () => {
  it('persists through the room’s durable record like the other group meta', async () => {
    const { chat, storage } = await loadChat()

    chat.updateGroupChat('Ops Room', room => room)
    chat.setGroupChatGoal('Ops Room', '  Keep the fleet green  ')

    await Promise.resolve()

    const durable = storage.get('group-chats') as Record<string, { goal?: string }>

    expect(durable['Ops Room']?.goal).toBe('Keep the fleet green')

    chat.setGroupChatGoal('Ops Room', '   ')
    await Promise.resolve()

    const cleared = storage.get('group-chats') as Record<string, { goal?: string }>

    expect(cleared['Ops Room']?.goal).toBeUndefined()
  })
})
