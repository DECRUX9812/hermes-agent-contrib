import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { groupMemberKey } from './group-membership'
import { GroupMembersPanel, GroupMembersStrip } from './group-room-members'
import { ROOM_LISTENER_EVERYONE } from './group-team'
import { translateBots } from './i18n-test-helper'
import type { GroupMember, GroupPrompt } from './types'

vi.mock('@hermes/plugin-sdk', async () => {
  const { useStore } = await import('@nanostores/react')
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const base = await pluginSdkMock(createGroupGateway().host)

  return {
    ...base,
    Button: (props: React.ComponentProps<'button'>) => <button type="button" {...props} />,
    Codicon: ({ name }: { name: string }) => <span aria-hidden data-icon={name} />,
    Tip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    usePluginI18n: () => translateBots,
    useValue: useStore
  }
})

const { $roomPrefs } = await import('./group-room-prefs')

const [builder, reviewer, tester, docs, ops] = ['builder', 'reviewer', 'tester', 'docs', 'ops'].map(
  name => ({ name })
) as GroupMember[]

const clarify = {
  at: 1,
  group: 'Room',
  kind: 'clarify',
  member: 'reviewer',
  memberKey: groupMemberKey(reviewer),
  questions: [],
  requestId: 'reviewer-1',
  thread: 'a'
} as GroupPrompt

function renderPanel() {
  const handlers = { onListen: vi.fn(), onManage: vi.fn(), onMention: vi.fn(), onStop: vi.fn() }

  const { container } = render(
    <GroupMembersPanel
      allMeta={{}}
      available={member => member.name !== 'ops'}
      leadMember={builder}
      liveWork={new Map([['a', new Set(['tester'])]])}
      members={[builder, reviewer, tester, docs, ops]}
      prompts={[clarify]}
      roomKey="Room"
      roomWorking={new Set(['tester'])}
      sessions={undefined}
      workingSince={new Map([[groupMemberKey(tester), Date.now() - 65_000]])}
      {...handlers}
    />
  )

  return { container, handlers }
}

const card = () => within(screen.getByTestId('group-member-card'))

beforeEach(() => {
  $roomPrefs.set({ desktopAlerts: false, lastOpened: {}, pins: {}, snoozes: {} })
})

afterEach(() => {
  cleanup()
})

it('sorts members into lead, waiting, working and idle, and keeps unreachable members in idle', () => {
  const { container } = renderPanel()

  const order = [...container.querySelectorAll('li[data-flip-key]')].map(row => row.getAttribute('data-flip-key'))
  expect(order).toEqual([builder, reviewer, tester, docs, ops].map(groupMemberKey))
  expect(screen.getByText('Unreachable')).toBeTruthy()
  expect(screen.getByText('Waiting on you')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Hide idle' }).textContent).toContain('2')
})

it('folds the idle group and keeps it folded after a remount', () => {
  renderPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Hide idle' }))
  expect(screen.queryByRole('button', { name: 'Docs, details' })).toBeNull()

  cleanup()
  renderPanel()

  expect(screen.queryByRole('button', { name: 'Docs, details' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Show 2 idle' }).getAttribute('aria-expanded')).toBe('false')
})

it('opens a member card with mention and open chat, and mention reaches the room', () => {
  const { handlers } = renderPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Tester, details' }))
  expect(card().getByRole('button', { name: 'Open chat' })).toBeTruthy()

  fireEvent.click(card().getByRole('button', { name: 'Mention' }))
  expect(handlers.onMention).toHaveBeenCalledWith(tester)
  expect(screen.queryByTestId('group-member-card')).toBeNull()
})

it('offers Stop only while the member is working', () => {
  const { handlers } = renderPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Docs, details' }))
  expect(card().queryByRole('button', { name: 'Stop' })).toBeNull()

  fireEvent.click(card().getByRole('button', { name: 'Make lead' }))
  expect(handlers.onListen).toHaveBeenCalledWith(groupMemberKey(docs))
})

it('stops a working member from its card', () => {
  const { handlers } = renderPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Tester, details' }))
  fireEvent.click(card().getByRole('button', { name: 'Stop' }))
  expect(handlers.onStop).toHaveBeenCalledWith(tester)
})

it('lets everyone listen from the lead card', () => {
  const { handlers } = renderPanel()

  fireEvent.click(screen.getByRole('button', { name: 'Builder, details' }))
  fireEvent.click(card().getByRole('button', { name: 'Everyone listens' }))
  expect(handlers.onListen).toHaveBeenCalledWith(ROOM_LISTENER_EVERYONE)
})

it('shows one face per member in the folded strip, lit while working, and opens the same card', () => {
  const handlers = { onListen: vi.fn(), onMention: vi.fn(), onStop: vi.fn() }

  const { container } = render(
    <GroupMembersStrip
      allMeta={{}}
      available={member => member.name !== 'ops'}
      leadMember={builder}
      liveWork={new Map([['a', new Set(['tester'])]])}
      members={[builder, reviewer, tester, docs, ops]}
      prompts={[clarify]}
      roomKey="Room"
      roomWorking={new Set(['tester'])}
      sessions={undefined}
      workingSince={new Map()}
      {...handlers}
    />
  )

  expect(container.querySelectorAll('[data-member-face]')).toHaveLength(5)
  expect(container.querySelectorAll('[data-working]')).toHaveLength(1)

  fireEvent.click(screen.getByRole('button', { name: 'Tester, details' }))
  fireEvent.click(card().getByRole('button', { name: 'Stop' }))
  expect(handlers.onStop).toHaveBeenCalledWith(tester)
})
