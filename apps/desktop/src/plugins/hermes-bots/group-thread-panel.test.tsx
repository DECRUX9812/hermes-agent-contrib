import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RoomWorkItem } from './group-room-work'
import { translateBots } from './i18n-test-helper'

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')
  const base = await pluginSdkMock({})

  return {
    ...base,
    Button: (props: React.ComponentProps<'button'>) => <button type="button" {...props} />,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Codicon: ({ name }: { name: string }) => <span aria-hidden data-icon={name} />,
    Tip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useI18n: () => ({ t: { common: {} } }),
    usePluginI18n: () => translateBots
  }
})

function item(status: RoomWorkItem['status']): RoomWorkItem {
  return {
    assignees: ['atlas', 'pixel'],
    count: 3,
    lastAt: Date.now(),
    lastIndex: 2,
    status,
    thread: 't1',
    title: 'Hero polish',
    working: status === 'working' ? ['atlas'] : []
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GroupThreadPanelHeader', () => {
  it('shows the title, status, who and reply count', async () => {
    const { GroupThreadPanelHeader } = await import('./group-thread-panel')

    render(
      <GroupThreadPanelHeader
        item={item('answered')}
        nameOf={name => name}
        onClose={() => {}}
        owner={null}
        teamId={null}
      />
    )

    const header = screen.getByTestId('group-thread-header')

    expect(within(header).getByText('Hero polish')).toBeTruthy()
    expect(within(header).getByText('Answered')).toBeTruthy()
    expect(within(header).getByText('3 messages')).toBeTruthy()
  })

  it('shows Stop only while the thread is working', async () => {
    const { GroupThreadPanelHeader } = await import('./group-thread-panel')
    const onStop = vi.fn()

    const { unmount } = render(
      <GroupThreadPanelHeader
        item={item('working')}
        nameOf={name => name}
        onClose={() => {}}
        onStop={onStop}
        owner={null}
        teamId={null}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Stop work' }))

    expect(onStop).toHaveBeenCalledTimes(1)
    unmount()

    render(
      <GroupThreadPanelHeader
        item={item('answered')}
        nameOf={name => name}
        onClose={() => {}}
        onStop={onStop}
        owner={null}
        teamId={null}
      />
    )

    expect(screen.queryByRole('button', { name: 'Stop work' })).toBeNull()
  })

  it('closes through the Close button', async () => {
    const { GroupThreadPanelHeader } = await import('./group-thread-panel')
    const onClose = vi.fn()

    render(
      <GroupThreadPanelHeader
        item={item('open')}
        nameOf={name => name}
        onClose={onClose}
        owner={null}
        teamId={null}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close thread' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
