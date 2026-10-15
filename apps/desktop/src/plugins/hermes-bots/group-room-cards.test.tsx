import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'
import type { GroupMember } from './types'

const { host, stores } = vi.hoisted(() => {
  const stores: { statusItems: Record<string, unknown>; storedByRuntime: Record<string, string> } = {
    statusItems: {},
    storedByRuntime: {}
  }

  const quiet = (get: () => unknown) => ({ get, listen: () => () => undefined })

  return {
    host: {
      state: {
        cronJobs: quiet(() => []),
        dotStateBySession: quiet(() => ({})),
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
    useI18n: () => ({ t: { common: {} } }),
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

beforeEach(() => {
  vi.resetModules()
  stores.statusItems = { 'runtime-1': [{ currentTool: 'Read', state: 'running' }] }
  stores.storedByRuntime = { 'runtime-1': 'builder-stored' }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ActivityLine working rows', () => {
  it('renders one row per working bot with ringed face, is-working name, tool, elapsed and Stop', async () => {
    const { ActivityLine } = await import('./group-room-cards')
    const onStop = vi.fn()
    const since = Date.now() - 65_000

    render(
      <ActivityLine
        allMeta={{}}
        members={MEMBERS}
        nameOf={name => name}
        names={['builder', 'ops']}
        onStop={onStop}
        sessionOf={name => `${name}-stored`}
        workingSince={new Map([['builder', since]])}
      />
    )

    const line = screen.getByTestId('group-activity-line')

    expect(line.getAttribute('aria-live')).toBe('polite')
    expect(within(line).getAllByTestId('mock-face')).toHaveLength(2)
    // Faces breathe inside a brand ring instead of pulsing on their own.
    expect(line.querySelectorAll('.motion-ring.text-brand')).toHaveLength(2)
    expect(line.querySelector('.motion-safe\\:animate-pulse')).toBeNull()
    // "<Name> is working" in the muted token tone (no hardcoded colour mixes); the tool rides a shimmer.
    expect(within(line).getByText('builder is working').classList.contains('text-fg-secondary')).toBe(true)
    expect(within(line).getByText('ops is working')).toBeTruthy()
    expect(within(line).getByText('now: Read').closest('.motion-shimmer')).toBeTruthy()
    // With no tool to name, the shimmer rides the name line instead of repeating "working".
    expect(within(line).getByText('ops is working').classList.contains('motion-shimmer')).toBe(true)
    expect(within(line).queryByText('working…')).toBeNull()
    // Elapsed as m:ss, only where a working stamp exists.
    expect(within(line).getByText('1:05')).toBeTruthy()
    expect(within(line).queryAllByText(/\d+:\d\d/)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Stop builder' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop ops' })).toBeTruthy()
  })

  it('calls onStop with the row member when its Stop is clicked', async () => {
    const { ActivityLine } = await import('./group-room-cards')
    const onStop = vi.fn()

    render(
      <ActivityLine
        allMeta={{}}
        members={MEMBERS}
        nameOf={name => name}
        names={['builder', 'ops']}
        onStop={onStop}
        sessionOf={name => `${name}-stored`}
        workingSince={new Map()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Stop ops' }))

    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onStop).toHaveBeenCalledWith(MEMBERS[1])
  })

  it('hides the Stop buttons when no stop handler is wired', async () => {
    const { ActivityLine } = await import('./group-room-cards')

    render(
      <ActivityLine
        allMeta={{}}
        members={MEMBERS}
        nameOf={name => name}
        names={['builder']}
        sessionOf={() => null}
        workingSince={new Map()}
      />
    )

    expect(screen.getByTestId('group-activity-line')).toBeTruthy()
    expect(screen.getByText('builder is working')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing when nobody is working', async () => {
    const { ActivityLine } = await import('./group-room-cards')

    render(<ActivityLine nameOf={name => name} names={[]} sessionOf={() => null} />)

    expect(screen.queryByTestId('group-activity-line')).toBeNull()
  })
})
