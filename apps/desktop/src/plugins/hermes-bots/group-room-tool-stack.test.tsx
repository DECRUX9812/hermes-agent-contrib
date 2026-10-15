import type { RpcEvent } from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { groupSessionKey } from './group-membership'
import { ActivityLine } from './group-room-cards'
import { ThreadTail } from './group-room-command'
import { $memberToolParts, recordGroupToolEvent } from './group-room-tool-cards'
import { groupClarifyKey } from './group-room-tool-stack'
import { translateBots } from './i18n-test-helper'
import type { GroupMember, GroupPrompt } from './types'

const { host, stores } = vi.hoisted(() => {
  const stores: { statusItems: Record<string, unknown>; storedByRuntime: Record<string, string> } = {
    statusItems: {},
    storedByRuntime: {}
  }

  const quiet = (get: () => unknown) => ({ get, listen: () => () => undefined })

  return {
    host: {
      state: {
        statusItemsBySession: quiet(() => stores.statusItems),
        storedSessionByRuntimeId: quiet(() => stores.storedByRuntime)
      }
    } as Record<string, unknown>,
    stores
  }
})

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')
  const base = await pluginSdkMock(host)
  const { ToolActivityStack, toolCardsFromParts } = await import('@/components/assistant-ui/tool-cards')
  const { upsertToolPart } = await import('@/lib/chat-messages')

  return {
    ...base,
    Button: (props: React.ComponentProps<'button'>) => <button type="button" {...props} />,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Codicon: ({ name }: { name: string }) => <span aria-hidden data-icon={name} />,
    relativeTime: () => 'now',
    Tip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    ToolActivityStack,
    toolCardsFromParts,
    upsertToolPart,
    usePluginI18n: () => translateBots
  }
})

vi.mock('./avatar', () => ({
  avatarColor: (color: string) => color,
  botAppearance: () => ({ color: '#336699', image: null, shape: 'circle' }),
  BotFace: ({ name }: { name: string }) => <span data-name={name} data-testid="mock-face" />
}))

vi.mock('./avatar-image', () => ({
  isBackfilledFacePng: () => false
}))

vi.mock('./routing', () => ({
  botRosterMeta: () => null
}))

const MEMBERS: GroupMember[] = [
  { name: 'builder', title: '' },
  { name: 'ops', title: '' }
]

const event = (type: string, session: string, payload: Record<string, unknown>) =>
  recordGroupToolEvent({ payload, session_id: session, type } as unknown as RpcEvent)

const approvalFor = (memberKey: string): GroupPrompt => ({
  at: 1,
  choices: ['once'],
  group: 'room',
  kind: 'approval',
  member: memberKey,
  memberKey,
  question: 'Run the build?',
  requestId: 'req-1',
  thread: 'thread-1'
})

const renderLine = (approvals?: GroupPrompt[]) =>
  render(
    <ActivityLine
      allMeta={{}}
      approvals={approvals}
      members={MEMBERS}
      nameOf={name => name}
      names={['builder', 'ops']}
      onStop={vi.fn()}
      sessionOf={name => `${name}-stored`}
      workingSince={new Map()}
    />
  )

const stacksOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-slot="tool-activity-stack"]'))

beforeEach(() => {
  $memberToolParts.set({})
  stores.statusItems = {}
  stores.storedByRuntime = { 'builder-runtime': 'builder-stored', 'ops-runtime': 'ops-stored' }
})

afterEach(() => {
  cleanup()
})

describe('ActivityLine tool card stacks', () => {
  it('gives each working bot its own stack under its own row', () => {
    event('tool.start', 'builder-runtime', { name: 'web_search', tool_id: 'call-b' })
    event('tool.start', 'ops-runtime', { name: 'read_file', tool_id: 'call-o' })
    event('tool.complete', 'ops-runtime', { name: 'read_file', result: 'ok', tool_id: 'call-o' })

    const { container } = renderLine()

    const [builderStack, opsStack] = stacksOf(container)

    expect(stacksOf(container)).toHaveLength(2)
    expect(within(builderStack.parentElement as HTMLElement).getByText('builder is working')).toBeTruthy()
    expect(within(opsStack.parentElement as HTMLElement).getByText('ops is working')).toBeTruthy()
    expect(builderStack.querySelector('[data-tool-card="running"]')).not.toBeNull()
    expect(opsStack.querySelector('[data-tool-card="done"]')).not.toBeNull()
    expect(opsStack.querySelector('[data-tool-card="running"]')).toBeNull()
  })

  it('wears the teammate face on the stack', () => {
    event('tool.start', 'builder-runtime', { name: 'web_search', tool_id: 'call-b' })

    const { container } = renderLine()

    const [builderStack] = stacksOf(container)
    const faces = within(builderStack).getAllByTestId('mock-face')

    expect(faces.length).toBeGreaterThan(0)

    for (const face of faces) {
      expect(face.getAttribute('data-name')).toBe('builder')
    }
  })

  it('offers Review on a waiting bot and scrolls its clarify card into view', () => {
    event('tool.start', 'builder-runtime', { name: 'terminal', tool_id: 'shell-1' })
    const approval = approvalFor('builder')

    render(
      <>
        <ActivityLine
          allMeta={{}}
          approvals={[approval]}
          members={MEMBERS}
          nameOf={name => name}
          names={['builder']}
          sessionOf={name => `${name}-stored`}
          workingSince={new Map()}
        />
        <div data-group-clarify={groupClarifyKey(approval)} data-testid="clarify-target" />
      </>
    )

    const target = screen.getByTestId('clarify-target')
    target.scrollIntoView = vi.fn()

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('offers no Review when nothing is waiting on an approval', () => {
    event('tool.start', 'builder-runtime', { name: 'terminal', tool_id: 'shell-1' })

    renderLine([])

    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
  })

  it('keeps a bot blocked on approval in the thread tail so Review stays reachable', () => {
    event('tool.start', 'builder-runtime', { name: 'terminal', tool_id: 'shell-1' })

    render(
      <ThreadTail
        allMeta={{}}
        clarifies={[approvalFor('builder')]}
        commands={{} as never}
        escalations={[]}
        live={new Map()}
        members={MEMBERS}
        nameOf={name => name}
        onDismiss={vi.fn()}
        sessions={{ [groupSessionKey('thread-1', MEMBERS[0])]: 'builder-stored' }}
        thread="thread-1"
        workingSince={new Map()}
      />
    )

    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy()
  })
})
