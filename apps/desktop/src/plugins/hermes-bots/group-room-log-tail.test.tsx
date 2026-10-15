import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'
import type { GroupMember } from './types'

const { host } = vi.hoisted(() => {
  const quiet = (value: unknown) => ({ get: () => value, listen: () => () => undefined })

  return {
    host: {
      state: {
        cronJobs: quiet([]),
        dotStateBySession: quiet({}),
        statusItemsBySession: quiet({}),
        storedSessionByRuntimeId: quiet({})
      }
    } as Record<string, unknown>
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
  BotFace: () => null
}))

vi.mock('./avatar-image', () => ({
  isBackfilledFacePng: () => false
}))

vi.mock('./routing', () => ({
  botRosterMeta: () => null
}))

vi.mock('./labels', () => ({
  displayName: (bot: { name: string }) => bot.name
}))

const MEMBERS: GroupMember[] = [{ name: 'builder', title: '' }]

function room(overrides: Record<string, unknown> = {}) {
  return {
    log: [],
    running: true,
    turn: { name: 'builder', title: '' },
    watermarks: {},
    ...overrides
  }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GroupLogTail working row', () => {
  it('names the on-turn member while no working row covers it', async () => {
    const { GroupLogTail } = await import('./group-room-log-tail')

    render(
      <GroupLogTail
        allMeta={{}}
        focused={false}
        members={MEMBERS}
        room={room()}
        roomClarifies={[]}
        roundContributions={[]}
        turnCovered={false}
      />
    )

    expect(screen.getByText('builder is thinking…')).toBeTruthy()
  })

  it('stays quiet when the on-turn member already paints a working row', async () => {
    const { GroupLogTail } = await import('./group-room-log-tail')

    const view = render(
      <GroupLogTail
        allMeta={{}}
        focused={false}
        members={MEMBERS}
        room={room()}
        roomClarifies={[]}
        roundContributions={[]}
        turnCovered
      />
    )

    expect(screen.queryByText(/thinking/)).toBeNull()
    expect(view.container.textContent).toBe('')
  })

  it('keeps "Waiting for your answer" while a clarify is open, even when covered', async () => {
    const { GroupLogTail } = await import('./group-room-log-tail')

    render(
      <GroupLogTail
        allMeta={{}}
        focused={false}
        members={MEMBERS}
        room={room()}
        roomClarifies={[{}]}
        roundContributions={[]}
        turnCovered
      />
    )

    expect(screen.getByText('Waiting for your answer…')).toBeTruthy()
  })

  it('shows nothing working-related once the room settles', async () => {
    const { GroupLogTail } = await import('./group-room-log-tail')

    const view = render(
      <GroupLogTail
        allMeta={{}}
        focused={false}
        members={MEMBERS}
        room={room({ running: false, turn: null })}
        roomClarifies={[]}
        roundContributions={[]}
        turnCovered={false}
      />
    )

    expect(view.container.textContent).toBe('')
  })
})
