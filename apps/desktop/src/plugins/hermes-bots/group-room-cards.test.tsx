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

  return {
    ...base,
    Button: (props: React.ComponentProps<'button'>) => <button type="button" {...props} />,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Codicon: ({ name }: { name: string }) => <span aria-hidden data-icon={name} />,
    relativeTime: () => 'now',
    Tip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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
  it('renders one row per working bot with face, speaker name, tool, elapsed and Stop', async () => {
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
        workingSince={new Map([['builder', 1000]])}
      />
    )

    const line = screen.getByTestId('group-activity-line')

    expect(line.getAttribute('aria-live')).toBe('polite')
    expect(within(line).getAllByTestId('mock-face')).toHaveLength(2)
    // The live tool through the activity formatter; the other bot is quiet.
    expect(within(line).getByText('now: Read')).toBeTruthy()
    expect(within(line).getByText('working…')).toBeTruthy()
    // Elapsed only where a working stamp exists.
    expect(within(line).getAllByText('now')).toHaveLength(1)
    // Speaker-coloured names, like the message rows.
    expect(within(line).getByText('builder').getAttribute('style')).toContain('color-mix')
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
    expect(screen.getByText('working…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing when nobody is working', async () => {
    const { ActivityLine } = await import('./group-room-cards')

    render(<ActivityLine nameOf={name => name} names={[]} sessionOf={() => null} />)

    expect(screen.queryByTestId('group-activity-line')).toBeNull()
  })
})
