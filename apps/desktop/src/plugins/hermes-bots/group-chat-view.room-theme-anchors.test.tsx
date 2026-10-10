/**
 * Contract test for the `room-theme` desktop plugin's CSS anchors.
 *
 * That plugin lives outside this repo and scopes every rule with selectors
 * it derives from THIS markup — a renamed testid, a dropped class or a
 * restructured bubble would break it silently, with no error anywhere. These
 * are the anchors it depends on; if one of these fails, room-theme's rules
 * stopped matching and the plugin is quietly dead.
 */
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const base = await pluginSdkMock(createGroupGateway().host)

  const Button = ({
    'aria-label': ariaLabel,
    children,
    className,
    onClick,
    title
  }: {
    'aria-label'?: string
    children?: ReactNode
    className?: string
    onClick?: () => void
    title?: string
  }) => (
    // Forwards className like the real Button (components/ui/button.tsx merges
    // it onto the node) — without this the run-name class never reaches the
    // DOM and the selector below fails for a reason that isn't there.
    <button aria-label={ariaLabel} className={className} onClick={onClick} title={title}>
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
    useI18n: () => ({ t: { common: { cancel: 'Cancel', save: 'Save' } } }),
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

it('every selector room-theme scopes with matches the rendered room', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace, openGroupChat } = await import('./group-chat-view')

  const log = [
    { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'go', at: 1 },
    { id: 'm1', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'first', at: 2 },
    // Same speaker continues the run — no second dot.
    { id: 'm2', thread: 'a', from: { kind: 'member' as const, name: 'builder' }, text: 'second', at: 3 },
    { id: 'm3', thread: 'a', from: { kind: 'member' as const, name: 'reviewer' }, text: 'other voice', at: 4 },
    { id: 'u2', thread: 'a', from: { kind: 'user' as const, name: 'You' }, text: 'again', at: 5 }
  ]

  $groupChats.set({ 'Hermes, Coder, Plugin, Nous Art': { log, watermarks: {}, sessions: {} } })
  const { container } = render(
    <GroupChatWorkspace
      group="Hermes, Coder, Plugin, Nous Art"
      members={[{ name: 'builder' }, { name: 'reviewer' }] as never}
    />
  )
  const all = (selector: string) => [...container.querySelectorAll(selector)]

  // [data-testid="group-speaker-dot"] — one per bot run start (builder,
  // reviewer), never on continuation lines.
  expect(all('[data-testid="group-speaker-dot"]')).toHaveLength(2)

  // [class*="text-(--speaker-color)"] — the run name, exactly one per dot.
  expect(all('[class*="text-(--speaker-color)"]')).toHaveLength(2)

  // div:has(> [data-slot="group-chat-message-content"]) — the bubble, one per
  // message, and nothing that isn't a bubble (this is the density target).
  const bubbles = all('div:has(> [data-slot="group-chat-message-content"])')
  expect(bubbles).toHaveLength(log.length)

  // div.grid:has(> div.group) — the log grid, uniquely (rows carry the
  // Tailwind `group` marker; nested :has() is rejected by jsdom's engine, so
  // the anchor stays flat and this assertion can actually run).
  expect(all('div.grid:has(> div.group)')).toHaveLength(1)

  // The meta-contrast override rewrites --ui-text-quaternary inside the room;
  // it only matters because the room actually renders text on that token.
  expect(all('[class*="text-(--ui-text-quaternary)"]').length).toBeGreaterThan(0)

  // The pane prefix room-theme anchors on: openWorkspace keys the pane
  // `hermes-bots:group:<slug>`, and the SDK prefixes it `plugin-workspace:`.
  const { host } = await import('@hermes/plugin-sdk')
  const opened: string[] = []
  ;(host as unknown as { openWorkspace: (id: string) => () => void }).openWorkspace = (id: string) => {
    opened.push(id)
    return () => {}
  }
  openGroupChat('Hermes, Coder, Plugin, Nous Art')
  // slugifyProfileName lowercases — room-theme anchors on the PREFIX only,
  // so a lowercased slug still matches its `[data-pane-host^=...]` scope.
  expect(opened).toEqual(['hermes-bots:group:hermes-coder-plugin-nous-art'])
  expect(`plugin-workspace:${opened[0]}`.startsWith('plugin-workspace:hermes-bots:group:')).toBe(true)

  // Sanity: the room rendered at all (otherwise every count above is vacuous).
  expect(screen.getAllByTestId('message-text-content')).toHaveLength(log.length)
})
