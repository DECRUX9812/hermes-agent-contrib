import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

// Room bodies go through the shell's message renderer (the 1:1 chat's code
// card + `MEDIA:` transform) when the SDK exports it. The stub records what the
// room handed it so the test asserts the wiring, not the renderer's output.
vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const base = await pluginSdkMock(createGroupGateway().host)

  const Button = ({
    'aria-label': ariaLabel,
    children,
    onClick,
    title
  }: {
    'aria-label'?: string
    children?: ReactNode
    onClick?: () => void
    title?: string
  }) => (
    <button aria-label={ariaLabel} onClick={onClick} title={title}>
      {children}
    </button>
  )

  return {
    ...base,
    Button,
    RowButton: Button,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Codicon: () => null,
    CopyButton: () => null,
    ConfirmDialog: () => null,
    Dialog: () => null,
    DialogContent: () => null,
    DialogDescription: () => null,
    DialogFooter: () => null,
    DialogHeader: () => null,
    DialogTitle: () => null,
    Input: () => null,
    MessageTextContent: ({ media = true, text }: { media?: boolean; text: string }) => (
      <span data-media={String(media)} data-testid="message-text-content">
        {text}
      </span>
    ),
    ToggleRow: () => null,
    Tip: ({ children }: { children: ReactNode }) => children,
    relativeTime: () => 'now',
    useI18n: () => ({ t: { common: { back: 'Back', cancel: 'Cancel', save: 'Save' } } }),
    usePluginI18n: () => translateBots
  }
})
vi.mock('./avatar', () => ({
  avatarColor: (_color: unknown, name: string) => (name === 'reviewer' ? '#f00' : '#0f0'),
  botAppearance: () => ({}),
  BotFace: () => null
}))
vi.mock('./group-chat-parts', () => ({
  GroupClarifyCard: () => null,
  GroupImageControls: () => null,
  GroupMentionInput: () => null
}))
afterEach(cleanup)

it('renders member replies through the shell message renderer, resolving media only for members on this gateway', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  const log = [
    { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'Show me', at: 1 },
    { id: 'm1', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'MEDIA:/tmp/local.png', at: 2 },
    {
      id: 'm2',
      thread: 'a',
      from: { kind: 'member' as const, name: 'builder', source: 'mini' },
      text: 'MEDIA:/tmp/remote.png',
      at: 3
    }
  ]

  const members = [
    { name: 'builder' },
    { connectionId: 'mini', connectionLabel: 'mini', name: 'builder', remoteSource: true, sourceScoped: true }
  ] as never

  $groupChats.set({ Room: { log, watermarks: {}, sessions: {} } })
  const { getAllByTestId } = render(<GroupChatWorkspace group="Room" members={members} />)
  const bodies = getAllByTestId('message-text-content').map(el => [el.textContent, el.dataset.media])

  expect(bodies).toEqual([
    ['Show me', 'true'],
    ['MEDIA:/tmp/local.png', 'true'],
    ['MEDIA:/tmp/remote.png', 'false']
  ])
})

it('groups consecutive same-speaker entries under one header, breaking on thread and speaker', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  const log = [
    { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'go', at: 1 },
    { id: 'm1', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'first', at: 2 },
    { id: 'm2', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'second', at: 3 },
    { id: 'm3', thread: 'b', from: { kind: 'member' as const, name: 'builder' }, text: 'other thread', at: 4 },
    { id: 'm4', thread: 'b', from: { kind: 'member' as const, name: 'reviewer' }, text: 'other voice', at: 5 }
  ]

  $groupChats.set({ Room: { log, watermarks: {}, sessions: {} } })
  render(<GroupChatWorkspace group="Room" members={[{ name: 'builder' }, { name: 'reviewer' }] as never} />)

  const names = (want: string) =>
    screen.getAllByRole('button').filter(el => (el.textContent || '').trim().toLowerCase() === want)

  // builder: m1+m2 share one header; m3's thread change re-breaks the run.
  expect(names('builder')).toHaveLength(2)
  expect(names('reviewer')).toHaveLength(1)
  // Grouping hides repeated headers, never actions: every member line stays replyable.
  expect(screen.getAllByRole('button', { name: /^Reply to / })).toHaveLength(4)
})

it('marks each bot run start with a colored speaker dot, not on continuation lines', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  const log = [
    { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'go', at: 1 },
    { id: 'm1', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'first', at: 2 },
    // Same speaker continues the run — no second dot.
    { id: 'm2', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'second', at: 3 },
    // A different voice back to back gets its own dot in its own color.
    { id: 'm3', thread: 'a', from: { kind: 'member' as const, name: 'reviewer' }, text: 'other voice', at: 4 }
  ]

  $groupChats.set({ Room: { log, watermarks: {}, sessions: {} } })
  render(<GroupChatWorkspace group="Room" members={[{ name: 'builder' }, { name: 'reviewer' }] as never} />)

  const dots = screen.getAllByTestId('group-speaker-dot')
  expect(dots).toHaveLength(2)
  // The hue rides the ROW as --speaker-color; dot and name read it from CSS,
  // so a theme layer can recolor a voice without touching this markup.
  const rowColors = dots.map(dot => (dot.closest('[style]') as HTMLElement).style.getPropertyValue('--speaker-color'))
  expect(rowColors).toEqual(['#0f0', '#f00'])
})

it('removes Stop controls from historical working rows after the room settles', async () => {
  Element.prototype.scrollIntoView = vi.fn()

  const [{ $groupChats }, activity, { GroupChatWorkspace }] = await Promise.all([
    import('./group-chat'),
    import('./group-activity'),
    import('./group-chat-view')
  ])

  $groupChats.set({
    Settled: {
      epoch: 1,
      log: [],
      members: [{ name: 'builder' }],
      running: false,
      sessions: {},
      watermarks: {}
    }
  })
  activity.recordGroupActivity('Settled', { kind: 'working', member: 'builder' })
  activity.recordGroupActivity('Settled', { kind: 'replied', member: 'builder' })
  activity.recordGroupActivity('Settled', { kind: 'settled', member: null })

  render(<GroupChatWorkspace group="Settled" members={[{ name: 'builder' }]} />)
  fireEvent.click(screen.getByRole('button', { name: /^Activity/ }))

  expect(screen.getByText('builder is working…')).toBeTruthy()
  expect(screen.getByText('builder replied')).toBeTruthy()
  expect(screen.getByText('turn settled')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
})

it('keeps the room header to navigation and settings — no one-click delete beside the title', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  $groupChats.set({ Room: { log: [], watermarks: {}, sessions: {} } })
  render(<GroupChatWorkspace group="Room" members={[{ name: 'builder' }] as never} />)

  // Icon-only controls still answer to their names (screen readers, tests).
  expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'New Thread' })).toBeTruthy()
  // Destructive disband moved into Group settings (mocked to null here).
  expect(screen.queryByRole('button', { name: /disband|delete/i })).toBeNull()
  // One members entry point (the face pile), not two.
  expect(screen.getAllByRole('button', { name: 'Manage group members' })).toHaveLength(1)
})
