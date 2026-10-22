import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const gateway = createGroupGateway()

  // Upstream's GroupExecutionGate probes `groups.capabilities` before it renders
  // a room; answer the legacy shape so the $groupChats workspace mounts.
  const scripted = gateway.host.requestProfile as (
    route: unknown,
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
    options?: { spawnPriority?: 'background' | 'foreground' }
  ) => Promise<unknown>

  gateway.host.requestProfile = async (
    route: unknown,
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
    options?: { spawnPriority?: 'background' | 'foreground' }
  ) => method === 'groups.capabilities'
    ? { driver: false, persistent_process: false }
    : scripted(route, method, params, timeoutMs, options)
  const base = await pluginSdkMock(gateway.host)

  const Button = ({ children, onClick, title }: { children?: ReactNode; onClick?: () => void; title?: string }) => (
    <button onClick={onClick} title={title}>
      {children}
    </button>
  )

  return {
    ...base,
    gatewayActivationEpoch: () => 1,
    Button,
    RowButton: Button,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Codicon: () => null,
    CopyButton: () => null,
    ToggleRow: () => null,
    ConfirmDialog: () => null,
    Dialog: () => null,
    DialogContent: () => null,
    DialogDescription: () => null,
    DialogFooter: () => null,
    DialogHeader: () => null,
    DialogTitle: () => null,
    Input: () => null,
    Tip: ({ children }: { children: ReactNode }) => children,
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

it('keeps every public member reply readable in room arrival order across interleaved threads', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')

  const log = [
    { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'Build request', at: 1 },
    { id: 'm1', thread: 'a', from: { kind: 'member' as const, name: 'Builder' }, text: 'Build complete', at: 2 },
    { id: 'u2', thread: 'b', from: { kind: 'user' as const, name: 'You' }, text: 'Release request', at: 3 },
    { id: 'm2', thread: 'a', from: { kind: 'member' as const, name: 'Reviewer' }, text: 'QA complete', at: 4 },
    { id: 'm3', thread: 'b', from: { kind: 'member' as const, name: 'Lead' }, text: 'Release ready', at: 5 }
  ]

  $groupChats.set({ Room: { log, watermarks: {}, sessions: {} } })
  const { container } = render(<GroupChatWorkspace group="Room" members={[]} />)
  // Upstream's execution gate resolves asynchronously; wait for the real room
  // to mount before pruning the summary card, so the removal sticks.
  await waitFor(() => expect(container.textContent).toContain('Build request'))
  // The round summary card intentionally re-prints each member's one-liner —
  // the unreadability invariant this test guards lives in the message log.
  container.querySelector('[data-testid="group-round-summary"]')?.remove()
  // The thread rail re-prints each thread's ask as its title; read the log.
  const text = container.querySelector('[data-testid="group-room-log"]')?.textContent || ''
  let previous = -1

  for (const entry of log) {
    const index = text.indexOf(entry.text)
    expect(index, `${entry.from.name}: ${entry.text} must remain visible in arrival order`).toBeGreaterThan(previous)
    expect(text.split(entry.text)).toHaveLength(2)
    previous = index
  }

  for (const name of ['Builder', 'Reviewer', 'Lead']) {
    expect(text).toContain(name)
  }
})
