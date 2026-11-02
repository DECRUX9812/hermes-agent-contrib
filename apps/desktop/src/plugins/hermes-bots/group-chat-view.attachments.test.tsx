import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

/**
 * The Desktop-local room's pending-attachment chips.
 *
 * The chip row is shared with the gateway room (`room-attachment-chips.tsx`),
 * but nothing proved the local room's wiring: it has only non-DOM suites, so
 * the "two attachments, two identical remove buttons" defect could come back
 * here without a test turning red. This renders the real composer and drives
 * its attach button.
 */

const picked = [
  { data: 'data:application/pdf;base64,AA==', kind: 'pdf' as const, name: 'spec.pdf' },
  { data: 'data:image/png;base64,AA==', kind: 'image' as const, name: 'shot.png' }
]

vi.mock('./group-attachments', () => ({
  filesToGroupAttachments: vi.fn(async () => picked),
  pickGroupAttachments: vi.fn(async () => picked)
}))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const base = await pluginSdkMock(createGroupGateway().host)

  // Keep `aria-label`: the assertion is about accessible names, and the shell's
  // real Button reads them off the prop rather than the glyph.
  const Button = ({ 'aria-label': ariaLabel, children, disabled, onClick, type }: Omit<ComponentProps<'button'>, 'aria-label'> & { 'aria-label'?: string }) => (
    <button aria-label={ariaLabel} disabled={disabled} onClick={onClick} type={type}>
      {children}
    </button>
  )

  return {
    ...base,
    Button,
    RowButton: Button,
    Codicon: () => null,
    ConfirmDialog: () => null,
    CopyButton: () => null,
    Dialog: () => null,
    DialogContent: () => null,
    DialogDescription: () => null,
    DialogFooter: () => null,
    DialogHeader: () => null,
    DialogTitle: () => null,
    Input: () => null,
    MessageTextContent: ({ text }: { text: string }) => <span>{text}</span>,
    Tip: ({ children }: { children: ReactNode }) => children,
    ToggleRow: () => null,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    relativeTime: () => 'now',
    useI18n: () => ({ t: { common: { cancel: 'Cancel', save: 'Save' } } }),
    usePluginI18n: () => translateBots
  }
})
vi.mock('./avatar', () => ({ avatarColor: () => '#888', botAppearance: () => ({}), BotFace: () => null }))
vi.mock('./group-chat-parts', () => ({
  GroupClarifyCard: () => null,
  GroupImageControls: () => null,
  GroupMentionInput: () => null
}))

afterEach(cleanup)

it('names each pending attachment in its own remove button', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  $groupChats.set({ Room: { log: [], sessions: {}, watermarks: {} } })

  render(<GroupChatWorkspace group="Room" members={[]} />)

  const attach = await screen.findByRole('button', { name: /^Attach files/ })
  fireEvent.click(attach)

  await waitFor(() => expect(screen.getAllByRole('button', { name: /^Remove attachment: / })).toHaveLength(2))
  expect(screen.getByRole('button', { name: 'Remove attachment: spec.pdf' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Remove attachment: shot.png' })).toBeTruthy()

  // Removing one leaves the other, and the survivor keeps its own name.
  fireEvent.click(screen.getByRole('button', { name: 'Remove attachment: spec.pdf' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove attachment: spec.pdf' })).toBeNull())
  expect(screen.getByRole('button', { name: 'Remove attachment: shot.png' })).toBeTruthy()
})
