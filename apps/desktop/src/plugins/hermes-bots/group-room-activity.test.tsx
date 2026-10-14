import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GroupActivityEntry } from './group-activity'
import { activitySummary, GroupRoomActivityBar } from './group-room-activity'
import { translateBots } from './i18n-test-helper'

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

vi.mock('./group-chat', () => ({
  groupSpeakerLabel: (name: string) => name
}))

afterEach(cleanup)

function event(kind: GroupActivityEntry['kind'], member: null | string, at: number): GroupActivityEntry {
  return { at, epoch: 1, kind, member }
}

describe('activitySummary', () => {
  it('returns null with no events', () => {
    expect(activitySummary([], false)).toBeNull()
    expect(activitySummary([], true)).toBeNull()
  })

  it('returns the latest event while the run is still going', () => {
    const events = [event('working', 'builder', 1), event('failed', 'builder', 2), event('working', 'writer', 3)]

    expect(activitySummary(events, true)).toBe(events[2])
  })

  it('lets an unresolved failure win once the run stopped', () => {
    const events = [event('failed', 'builder', 1), event('settled', null, 2)]

    expect(activitySummary(events, false)).toBe(events[0])
  })

  it('a later success for that member clears the failure', () => {
    const events = [event('failed', 'builder', 1), event('replied', 'builder', 2), event('settled', null, 3)]

    expect(activitySummary(events, false)).toBe(events[2])
  })

  it('a failure for one member does not hide another member settling later', () => {
    const events = [event('failed', 'builder', 1), event('delivered', 'builder', 2)]

    expect(activitySummary(events, false)).toBe(events[1])
  })
})

describe('GroupRoomActivityBar', () => {
  const events = [event('working', 'builder', 1), event('replied', 'builder', 2)]

  function panelOf(container: HTMLElement, toggle: HTMLElement): HTMLElement {
    const id = toggle.getAttribute('aria-controls')
    const node = container.querySelector(`[id="${id}"]`)

    if (!(node instanceof HTMLElement)) {
      throw new Error('expected the activity panel')
    }

    return node
  }

  it('starts collapsed with the summary, and opens on toggle', () => {
    const { container } = render(
      <GroupRoomActivityBar events={events} group="Room" onStopAll={() => {}} running={false} />
    )

    const toggle = screen.getByRole('button', { name: /^Activity/ })

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe('group-activity:Room')
    expect(panelOf(container, toggle).parentElement?.getAttribute('data-open')).toBe('false')
    expect(screen.getAllByText('builder replied')).toHaveLength(1)

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(panelOf(container, toggle).parentElement?.getAttribute('data-open')).toBe('true')
    expect(panelOf(container, toggle)).toBeTruthy()
    // Open, the list carries the events and the collapsed summary steps
    // aside, so no text appears twice.
    expect(toggle.textContent).not.toContain('builder replied')
    expect(panelOf(container, toggle).textContent).toContain('builder replied')

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(panelOf(container, toggle).parentElement?.getAttribute('data-open')).toBe('false')
  })

  it('shows Stop all only while running and calls onStopAll', () => {
    const onStopAll = vi.fn()

    const { rerender } = render(
      <GroupRoomActivityBar events={events} group="Room" onStopAll={onStopAll} running={true} />
    )

    const stop = screen.getByRole('button', { name: 'Stop all' })
    fireEvent.click(stop)
    expect(onStopAll).toHaveBeenCalledTimes(1)

    rerender(<GroupRoomActivityBar events={events} group="Room" onStopAll={onStopAll} running={false} />)
    expect(screen.queryByRole('button', { name: 'Stop all' })).toBeNull()
  })
})
