import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    'aria-pressed': ariaPressed,
    children,
    className,
    'data-testid': testId,
    onClick,
    title
  }: {
    'aria-label'?: string
    'aria-pressed'?: boolean
    children?: ReactNode
    className?: string
    'data-testid'?: string
    onClick?: () => void
    title?: string
  }) => (
    <button
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className={className}
      data-testid={testId}
      onClick={onClick}
      title={title}
    >
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
  // The room wires Escape through this input to close the open reply box;
  // the stub keeps that contract visible so a room test can press it.
  GroupMentionInput: ({
    'aria-label': label,
    onChange,
    onEscape,
    value
  }: {
    'aria-label'?: string
    onChange?: (value: string) => void
    onEscape?: () => void
    value?: string
  }) => (
    <textarea
      aria-label={label}
      onChange={event => onChange?.(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          onEscape?.()
        }
      }}
      value={value || ''}
    />
  )
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
    within(screen.getByTestId('group-room-log'))
      .getAllByRole('button')
      .filter(el => (el.textContent || '').trim().toLowerCase() === want)

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
  // Each hue is mixed toward the foreground so dark avatar colors stay legible.
  expect(rowColors.map(color => color.includes('#0f0') || color.includes('#f00'))).toEqual([true, true])
  expect(rowColors[0]).toContain('#0f0')
  expect(rowColors[1]).toContain('#f00')
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

it('separates calendar days in the room log with a hairline Today/Yesterday row', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  // Noon today: "an hour before yesterday's now" must stay yesterday even
  // when the suite runs just after midnight.
  const now = new Date().setHours(12, 0, 0, 0)
  const DAY = 86_400_000

  const log = [
    {
      id: 'm1',
      thread: 'a',
      from: { kind: 'member' as const, name: 'builder' },
      text: 'from yesterday',
      at: now - DAY - 3_600_000
    },
    {
      id: 'm2',
      thread: 'a',
      from: { kind: 'member' as const, name: 'builder' },
      text: 'still yesterday',
      at: now - DAY
    },
    { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'today now', at: now }
  ]

  $groupChats.set({ Room: { log, watermarks: {}, sessions: {} } })

  const { container, getAllByTestId } = render(
    <GroupChatWorkspace group="Room" members={[{ name: 'builder' }] as never} />
  )

  // Two day changes → two separators; the same-day pair shares one.
  const separators = getAllByTestId('group-day-separator')
  expect(separators).toHaveLength(2)
  expect(separators[0].textContent).toBe('Yesterday')
  expect(separators[1].textContent).toBe('Today')

  // The separators sit BEFORE the entries of their day, in order (read the
  // log itself — the thread rail re-prints thread titles).
  const text = container.querySelector('[data-testid="group-room-log"]')?.textContent || ''
  expect(text.indexOf('Yesterday')).toBeLessThan(text.indexOf('from yesterday'))
  expect(text.indexOf('still yesterday')).toBeLessThan(text.indexOf('Today'))
  expect(text.indexOf('Today')).toBeLessThan(text.indexOf('today now'))
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
  expect(screen.getAllByRole('button', { name: /^(Show|Hide) members$/ })).toHaveLength(1)
})

it('leaves a reader in history when a reply lands, and offers a jump back with the unseen count', async () => {
  const scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  const first = { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'go', at: 1 }
  $groupChats.set({ Room: { log: [first], watermarks: {}, sessions: {} } })
  const { rerender } = render(<GroupChatWorkspace group="Room" members={[{ name: 'builder' }] as never} />)

  // The reader scrolls 500px up from the bottom of the log.
  const scroller = screen.getByTestId('group-room-log')
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 1500 },
    scrollTop: { configurable: true, value: 600, writable: true }
  })
  fireEvent.scroll(scroller)
  scrollIntoView.mockClear()

  const reply = { id: 'm1', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'done', at: 2 }
  // The SDK mock's useValue is a plain read, so repaint after the store moves.
  $groupChats.set({ Room: { log: [first, reply], watermarks: {}, sessions: {} } })
  rerender(<GroupChatWorkspace group="Room" members={[{ name: 'builder' }] as never} />)

  expect(scrollIntoView).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '1 new message' }))
  expect(scrollIntoView).toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '1 new message' })).toBeNull()
})

it('shows each voice’s role and lights the face of whoever is working right now', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  const log = [{ id: 'm1', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'on it', at: 1 }]
  $groupChats.set({ Room: { log, watermarks: {}, sessions: {}, running: true, turn: { name: 'builder' } } } as never)

  render(
    <GroupChatWorkspace
      group="Room"
      members={[{ name: 'builder', title: 'Frontend engineer' }, { name: 'reviewer' }] as never}
    />
  )

  expect(screen.getByTestId('group-speaker-role').textContent).toBe('Frontend engineer')
  // Only the bot mid-turn wears the working ring in the header's face pile.
  const pile = screen.getByRole('button', { name: /^(Show|Hide) members$/ })
  expect(pile.querySelectorAll('[data-working]')).toHaveLength(1)
  expect(pile.querySelector('[data-working]')?.classList).toContain('motion-ring')
})

it('runs the room as threads: the rail opens one beside the room, with its own header and reply box', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  const log = [
    { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'fix the header', at: 1 },
    { id: 'm1', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'fixed', at: 2 },
    { id: 'u2', thread: 'b', from: { kind: 'user' as const, name: 'You' }, text: 'theme plugin next', at: 3 }
  ]

  $groupChats.set({ Room: { log, watermarks: {}, sessions: {} } })
  render(<GroupChatWorkspace group="Room" members={[{ name: 'builder' }] as never} />)

  // The team panel sits beside the room with the squad in it.
  expect(screen.getByTestId('group-room-panel')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Builder, details' })).toBeTruthy()

  // Rail → the thread opens beside the room; the room keeps every thread.
  const rail = screen.getByTestId('group-thread-rail')
  fireEvent.click(within(rail).getByText('fix the header'))
  expect(screen.getByTestId('group-room-log').textContent).toContain('theme plugin next')
  const panel = screen.getByTestId('group-thread-panel')
  expect(within(panel).getByTestId('group-thread-log').textContent).toContain('fixed')
  expect(within(panel).getByTestId('group-thread-log').textContent).not.toContain('theme plugin next')
  expect(within(panel).getByTestId('group-thread-header').textContent).toContain('Answered')
  expect(within(panel).getByLabelText('Reply in thread')).toBeTruthy()
  // The main composer keeps starting new threads.
  expect(screen.getByTestId('group-composer-context').textContent).not.toContain('Replying in')

  // Back to All closes the thread and the members panel returns.
  fireEvent.click(within(rail).getByText('All activity'))
  expect(screen.queryByTestId('group-thread-panel')).toBeNull()
  expect(screen.getByTestId('group-room-panel')).toBeTruthy()
})

it('nudges only what arrived while you were elsewhere: a rail badge for a grown thread, cleared by opening it', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')
  const { $groupThreadReadAt } = await import('./group-unread')

  // Thread b grew while the user was away: their read mark for it is behind
  // its newest member entry. Thread a they have been reading, so it is current.
  $groupThreadReadAt.set({ 'name:Room::a': 2, 'name:Room::b': 2 })

  const log = [
    { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'fix the header', at: 1 },
    { id: 'm1', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'fixed', at: 2 },
    { id: 'u2', thread: 'b', from: { kind: 'user' as const, name: 'You' }, text: 'theme plugin next', at: 3 },
    { id: 'm2', thread: 'b', from: { kind: 'member' as const, name: 'builder' }, text: 'shipped', at: 4 }
  ]

  $groupChats.set({ Room: { log, watermarks: {}, sessions: {} } })
  render(<GroupChatWorkspace group="Room" members={[{ name: 'builder' }] as never} />)

  // Only the thread they were NOT in nudges — one badge, count one.
  const rail = screen.getByTestId('group-thread-rail')
  const badges = within(rail).getAllByTestId('group-thread-row-unseen')
  expect(badges).toHaveLength(1)
  expect(badges[0]!.textContent).toBe('1')
  expect(badges[0]!.getAttribute('title')).toBe('1 new')
  expect(badges[0]!.getAttribute('aria-label')).toBe('1 new')

  // "All activity" carries the same count up top, so one glance is enough.
  expect(within(rail).getByTestId('group-thread-unseen').textContent).toBe('1')

  // Opening it is reading it: the badge clears the moment the thread is.
  fireEvent.click(within(rail).getByText('theme plugin next'))
  expect(within(screen.getByTestId('group-thread-rail')).queryAllByTestId('group-thread-row-unseen')).toHaveLength(0)
  expect(within(screen.getByTestId('group-thread-rail')).queryByTestId('group-thread-unseen')).toBeNull()
})

it('Escape leaves the thread but keeps the typed reply', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  // The room's composer drafts persist across tests in this file (the Work
  // tab test above leaves its reply box open) — start from a clean room.
  const { clearGroupComposerDraft, groupComposerDraftKey } = await import('./group-panes')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  const room = { log: [] as unknown[], watermarks: {}, sessions: {} }

  clearGroupComposerDraft(groupComposerDraftKey('Room', room as never))

  const log = [
    { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'fix the header', at: 1 },
    { id: 'm1', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'fixed', at: 2 }
  ]

  $groupChats.set({ Room: { log, watermarks: {}, sessions: {} } })
  render(<GroupChatWorkspace group="Room" members={[{ name: 'builder' }] as never} />)

  // Open the thread: its panel brings its own reply box.
  fireEvent.click(screen.getByRole('button', { name: /Open this thread/ }))
  const box = screen.getByLabelText('Reply in thread') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: 'one more thing' } })

  // Escape closes the thread panel; the main composer was never retargeted...
  fireEvent.keyDown(box, { key: 'Escape' })
  expect(screen.queryByLabelText('Reply in thread')).toBeNull()
  expect(screen.queryByTestId('group-thread-panel')).toBeNull()

  // ...and the draft survives, so reopening shows the half-typed reply.
  fireEvent.click(screen.getByRole('button', { name: /Open this thread/ }))
  expect((screen.getByLabelText('Reply in thread') as HTMLTextAreaElement).value).toBe('one more thing')
})

it('focus mode dims history but keeps the final run and hover-reachable', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { clearGroupComposerDraft, groupComposerDraftKey } = await import('./group-panes')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  // Clean the room's persisted draft (earlier tests leave state behind).
  clearGroupComposerDraft(groupComposerDraftKey('Room', { log: [], watermarks: {}, sessions: {} } as never))

  // Three speakers: builder's run, then reviewer's run. Focus keeps only the
  // last run (reviewer) lit; builder's two lines and the user's line dim.
  const log = [
    { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'ship it', at: 1 },
    { id: 'm1', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'on it', at: 2 },
    { id: 'm2', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'done', at: 3 },
    { id: 'm3', thread: 'a', from: { kind: 'member' as const, name: 'reviewer' }, text: 'looks good', at: 4 }
  ]

  $groupChats.set({ Room: { log, watermarks: {}, sessions: {} } })

  const { container } = render(
    <GroupChatWorkspace group="Room" members={[{ name: 'builder' }, { name: 'reviewer' }] as never} />
  )

  const rows = [...container.querySelectorAll('[data-entry-index]')]
  const dimmed = () => rows.filter(row => row.className.includes('opacity-30'))

  // Focus starts off: nothing dimmed.
  expect(rows).toHaveLength(4)
  expect(dimmed()).toHaveLength(0)

  const toggle = screen.getByTestId('group-focus-toggle')
  expect(toggle.getAttribute('aria-pressed')).toBe('false')

  // Toggle on: the three history rows dim, the final reviewer line stays lit.
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  expect(dimmed()).toHaveLength(3)

  // The live exchange (the final run) is never dimmed.
  const finalRow = rows[3]
  expect(finalRow.className).not.toContain('opacity-30')

  // Dimmed rows stay reachable — hover restores them (the class is there,
  // and the hover rule is what the theme layer reads).
  expect(dimmed().every(row => row.className.includes('hover:opacity-100'))).toBe(true)

  // Toggle off: back to full brightness.
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  expect(dimmed()).toHaveLength(0)
})

it('runs the Command Room: handoff cards, a stalled handoff escalated with a working Reassign, and the Board', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { clearGroupComposerDraft, groupComposerDraftKey } = await import('./group-panes')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  clearGroupComposerDraft(groupComposerDraftKey('Room', { log: [], watermarks: {}, sessions: {} } as never))
  const stale = Date.now() - 25 * 60_000

  const log = [
    { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'fix the header', at: stale - 1000 },
    {
      id: 'm1',
      thread: 'a',
      from: { kind: 'member' as const, name: 'builder' },
      text: 'Plan set.\n@reviewer handoff: check contrast · done when: names readable · due: 15m',
      at: stale
    }
  ]

  $groupChats.set({ Room: { log, watermarks: {}, sessions: {} } })
  render(
    <GroupChatWorkspace
      group="Room"
      members={[{ name: 'builder' }, { name: 'reviewer' }, { name: 'plugin' }] as never}
    />
  )

  // The handoff line reads as a contract card, still waiting for pickup…
  const card = screen.getByTestId('group-handoff-card')
  expect(card.textContent).toContain('check contrast')
  expect(card.textContent).toContain('names readable')
  expect(card.getAttribute('data-handoff-status')).toBe('open')

  // …and 25 minutes on, it is escalated to the user with the fixes on it.
  const escalation = screen.getAllByTestId('group-escalation-card')[0]!
  fireEvent.click(within(escalation).getByRole('button', { name: 'Reassign' }))
  fireEvent.click(within(escalation).getByRole('button', { name: /plugin/i }))
  const sent = $groupChats.get().Room!.log.at(-1)!
  expect(sent.thread).toBe('a')
  expect(sent.text).toMatch(/^@plugin handoff: check contrast · done when: names readable · due: 15m$/)

  // The Board shows the work by stage; a card opens its thread in the room.
  fireEvent.click(screen.getByRole('button', { name: 'Board' }))
  const board = screen.getByTestId('group-room-board')
  fireEvent.click(within(board).getAllByTestId('group-board-card')[0]!)
  expect(screen.queryByTestId('group-room-board')).toBeNull()
  expect(screen.getByTestId('group-thread-header').textContent).toContain('fix the header')
})

it('catches the CEO up, moves by keyboard, counts handoff clocks down, and alerts on a new stall', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const sdk = await import('@hermes/plugin-sdk')
  const { $groupChats, groupChatRoomKey } = await import('./group-chat')
  const { $groupVisitAnchor } = await import('./group-unread')
  const { clearGroupComposerDraft, groupComposerDraftKey } = await import('./group-panes')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  clearGroupComposerDraft(groupComposerDraftKey('Room', { log: [], watermarks: {}, sessions: {} } as never))
  const now = Date.now()
  const min = 60_000
  const members = [{ name: 'builder' }, { name: 'reviewer' }, { name: 'plugin' }] as never

  const log = [
    {
      id: 'u1',
      thread: 'a',
      from: { kind: 'user' as const, name: 'You' },
      text: 'ship the header',
      at: now - 60 * min
    },
    {
      id: 'm1',
      thread: 'a',
      from: { kind: 'member' as const, name: 'builder' },
      text: '@reviewer handoff: check contrast · due: 5m',
      at: now - 30 * min
    },
    { id: 'm2', thread: 'a', from: { kind: 'member' as const, name: 'reviewer' }, text: 'On it.', at: now - 20 * min },
    { id: 'u2', thread: 'b', from: { kind: 'user' as const, name: 'You' }, text: 'theme plugin', at: now - 10 * min },
    {
      id: 'm3',
      thread: 'b',
      from: { kind: 'member' as const, name: 'builder' },
      text: 'drafting tokens',
      at: now - 5 * min
    }
  ]

  const room = { log, watermarks: {}, sessions: {} }
  $groupChats.set({ Room: room })
  // The user last opened the room 15 minutes ago.
  $groupVisitAnchor.set({ [groupChatRoomKey('Room', room as never)]: now - 15 * min })
  const { rerender } = render(<GroupChatWorkspace group="Room" members={members} />)

  // While you were away: only thread b moved since the visit.
  const catchUp = screen.getByTestId('group-catchup-card')
  expect(
    within(catchUp)
      .getAllByTestId('group-catchup-line')
      .map(line => line.textContent)
  ).toEqual([expect.stringContaining('theme plugin')])
  fireEvent.click(within(catchUp).getByTestId('group-catchup-line'))
  expect(screen.getByTestId('group-thread-header').textContent).toContain('theme plugin')

  // Keyboard: Esc back to All, J to the first thread in the rail's order.
  const logView = screen.getByTestId('group-room-log')
  fireEvent.keyDown(logView, { key: 'Escape' })
  expect(screen.queryByTestId('group-thread-header')).toBeNull()
  fireEvent.keyDown(logView, { key: 'j' })
  expect(screen.getByTestId('group-thread-header')).toBeTruthy()

  // The accepted handoff was due 25 minutes ago: its clock says so.
  fireEvent.keyDown(logView, { key: 'Escape' })
  expect(screen.getByTestId('group-handoff-card').textContent).toContain('overdue 25 min')

  // A NEW stalled handoff toasts the user; the ones present at open never did.
  expect(sdk.host.notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'warning' }))

  const stalled = {
    id: 'm4',
    thread: 'b',
    from: { kind: 'member' as const, name: 'builder' },
    text: '@plugin handoff: write tokens',
    at: now - 25 * min
  }

  $groupChats.set({ Room: { ...room, log: [...log, stalled] } })
  rerender(<GroupChatWorkspace group="Room" members={members} />)
  expect(sdk.host.notify).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'warning', message: expect.stringContaining('write tokens') })
  )
})

it('lets the CEO search, pin and snooze threads, and remembers where they left off across a restart', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats, groupChatRoomKey } = await import('./group-chat')
  const { $groupReadAt, markGroupOpened } = await import('./group-unread')
  const { $roomPrefs } = await import('./group-room-prefs')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  const log = [
    { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'fix the header', at: 10 },
    { id: 'm1', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'contrast is low', at: 20 },
    { id: 'u2', thread: 'b', from: { kind: 'user' as const, name: 'You' }, text: 'theme plugin', at: 30 },
    { id: 'm2', thread: 'b', from: { kind: 'member' as const, name: 'builder' }, text: 'tokens drafted', at: 40 }
  ]

  const room = { log, watermarks: {}, sessions: {} }
  const key = groupChatRoomKey('Room', room as never)
  $groupChats.set({ Room: room })

  // A restart re-seeded the live read mark at the tail (40), but this browser
  // remembers the user last read up to 20: the catch-up starts there.
  $groupReadAt.set({ [key]: 40 })
  $roomPrefs.set({ desktopAlerts: false, lastOpened: { [key]: 20 }, pins: {}, snoozes: {} })
  markGroupOpened('Room')
  const view = <GroupChatWorkspace group="Room" members={[{ name: 'builder' }] as never} />
  const { rerender } = render(view)
  expect(screen.getByTestId('group-catchup-card').textContent).toContain('theme plugin')
  // The SDK mock's useValue is a plain read: repaint after a preference moves.
  const repaint = () => rerender(<GroupChatWorkspace group="Room" members={[{ name: 'builder' }] as never} />)

  const rail = screen.getByTestId('group-thread-rail')

  const titles = () =>
    within(rail)
      .getAllByTestId('group-thread-row')
      .map(row => row.textContent)

  // Search reaches message text, not just titles.
  fireEvent.change(within(rail).getByTestId('group-thread-search'), { target: { value: 'contrast' } })
  expect(titles()).toEqual([expect.stringContaining('fix the header')])
  fireEvent.change(within(rail).getByTestId('group-thread-search'), { target: { value: '' } })

  // Pin b: it leads the rail in its own section.
  const rowOf = (title: string) => within(rail).getByText(title).closest('li') as HTMLElement
  fireEvent.click(within(rowOf('theme plugin')).getByTestId('group-thread-pin'))
  repaint()
  expect(rail.querySelector('[data-thread-section="pinned"]')?.textContent).toContain('theme plugin')

  // Snooze a: it leaves the work sections for a collapsed Snoozed list.
  fireEvent.click(within(rowOf('fix the header')).getByTestId('group-thread-snooze'))
  repaint()
  expect(titles()).toEqual([expect.stringContaining('theme plugin')])
  expect(rail.querySelector('[data-thread-section="snoozed"]')?.textContent).toContain('1')
})

it('renders team decision cards with live consensus and records the user call', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { clearGroupComposerDraft, groupComposerDraftKey } = await import('./group-panes')
  const { GroupChatWorkspace } = await import('./group-chat-view')
  const { decideLine } = await import('./group-room-votes')

  clearGroupComposerDraft(groupComposerDraftKey('Room', { log: [], watermarks: {}, sessions: {} } as never))

  const log = [
    {
      id: 'u1',
      thread: 'a',
      from: { kind: 'user' as const, name: 'You' },
      text: decideLine('ship or hold?', ['ship', 'hold']),
      at: 1000
    },
    {
      id: 'm1',
      thread: 'a',
      from: { kind: 'member' as const, name: 'builder' },
      text: 'ship it',
      at: 2000
    },
    {
      id: 'm2',
      thread: 'a',
      from: { kind: 'member' as const, name: 'reviewer' },
      text: 'ship',
      at: 3000
    }
  ]

  $groupChats.set({ Room: { log, watermarks: {}, sessions: {} } })
  render(
    <GroupChatWorkspace
      group="Room"
      members={[{ name: 'builder' }, { name: 'reviewer' }, { name: 'plugin' }] as never}
    />
  )

  const card = screen.getByTestId('group-vote-card')
  expect(card).toBeTruthy()
  expect(card.textContent).toContain('ship or hold?')
  expect(screen.getByTestId('group-vote-consensus').textContent).toContain('Majority')

  // Calling it records the outcome in the thread
  const callBtn = within(card).getAllByRole('button', { name: 'Call it' })[0]!
  fireEvent.click(callBtn)

  const sent = $groupChats.get().Room!.log.at(-1)!
  expect(sent.thread).toBe('a')
  expect(sent.text).toBe('decided: ship')
})
