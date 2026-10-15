import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { groupMentionComponents, groupMentionText } from './group-mention-text'
import { GroupMessageRow, type GroupMessageRowProps } from './group-message-row'
import { translateBots } from './i18n-test-helper'
import type { GroupMessage } from './types'

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const base = await pluginSdkMock(createGroupGateway().host)

  const Button = ({
    'aria-label': ariaLabel,
    children,
    className,
    onClick
  }: {
    'aria-label'?: string
    children?: ReactNode
    className?: string
    onClick?: () => void
  }) => (
    <button aria-label={ariaLabel} className={className} onClick={onClick}>
      {children}
    </button>
  )

  return {
    ...base,
    Button,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    CopyButton: () => null,
    Codicon: () => null,
    Tip: ({ children }: { children: ReactNode }) => children,
    relativeTime: () => 'now',
    usePluginI18n: () => translateBots
  }
})
vi.mock('./avatar', () => ({
  avatarColor: () => '#0f0',
  botAppearance: () => ({}),
  BotFace: () => null
}))
afterEach(cleanup)

const LONG_TEXT = 'x'.repeat(1300)

function botLine(text: string): GroupMessage {
  return { at: 1, from: { kind: 'member', name: 'builder' }, text, thread: 'a' }
}

function userLine(text: string): GroupMessage {
  return { at: 1, from: { kind: 'user', name: 'You' }, text, thread: 'a' }
}

function renderRow(entry: GroupMessage, overrides: Partial<GroupMessageRowProps> = {}) {
  return render(
    <GroupMessageRow
      dimmed={false}
      display="builder"
      entry={entry}
      index={0}
      label="builder"
      lead={false}
      member={null}
      mentionComponents={groupMentionComponents([])}
      mentionText={groupMentionText([])}
      meta={null}
      onOpenThread={() => {}}
      onReply={() => {}}
      onToggleReveal={() => {}}
      replyTag="builder"
      revealed={false}
      roleTitle=""
      runStart
      {...overrides}
    />
  )
}

it('clamps a long bot reply and expands it in place', () => {
  renderRow(botLine(LONG_TEXT))

  fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
  expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
  expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy()
})

it('offers the thread beside a long bot reply only when the room is not focused on it', () => {
  const { unmount } = renderRow(botLine(LONG_TEXT), { onOpenThread: () => {} })
  expect(screen.getByRole('button', { name: 'Open this thread' })).toBeTruthy()
  unmount()

  renderRow(botLine(LONG_TEXT), { onOpenThread: null })
  expect(screen.queryByRole('button', { name: 'Open this thread' })).toBeNull()
})

it('leaves a short bot reply unclamped', () => {
  renderRow(botLine('a quick answer'))

  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Show less' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Open this thread' })).toBeNull()
})

it('never clamps the user’s own lines', () => {
  renderRow(userLine(LONG_TEXT))

  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  expect(screen.getByText(LONG_TEXT)).toBeTruthy()
})

it('lets an unbroken user line wrap inside the room column', () => {
  renderRow(userLine(`https://example.invalid/${'path/'.repeat(120)}`))

  const body = screen.getByText(/example\.invalid/)

  expect(body.className).toContain('wrap-anywhere')
  expect(body.className).toContain('max-w-full')
  expect(body.parentElement?.className).toContain('max-w-[85%]')
  expect(body.parentElement?.className).toContain('min-w-0')
})

it('prefers the room role label over the global title', () => {
  renderRow(botLine('a quick answer'), { roleTitle: 'Auditor', roomRole: 'Reviewer' })

  expect(screen.getByTestId('group-speaker-role').textContent).toBe('Reviewer')
})

it('falls back to the global title when the room names no role', () => {
  renderRow(botLine('a quick answer'), { roleTitle: 'Auditor' })

  expect(screen.getByTestId('group-speaker-role').textContent).toBe('Auditor')
})

it('shows no header on a continuation entry', () => {
  renderRow(botLine('still going'), { runStart: false })

  expect(screen.queryByTestId('group-speaker-role')).toBeNull()
  expect(screen.queryByText('builder')).toBeNull()
  expect(screen.getByText('still going')).toBeTruthy()
})

it('hides the handoff protocol line the chip below already says', () => {
  renderRow(botLine('Plan agreed.\n@coder handoff: unify replies · done when: tests green'), { handoffLine: 1 })

  expect(screen.getByText('Plan agreed.')).toBeTruthy()
  expect(screen.queryByText(/handoff:/)).toBeNull()
})

it('keeps the protocol line when no chip is shown for it', () => {
  renderRow(botLine('Plan agreed.\n@coder handoff: unify replies · done when: tests green'))

  expect(screen.getByText(/handoff:/)).toBeTruthy()
})

it('marks the room lead with the same label as before', () => {
  renderRow(botLine('hello'), { lead: true })

  expect(screen.getByLabelText('Leads this room')).toBeTruthy()
})
