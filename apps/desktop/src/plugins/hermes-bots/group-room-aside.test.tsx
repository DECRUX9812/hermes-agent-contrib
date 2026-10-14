import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

vi.mock('@hermes/plugin-sdk', async () => {
  const { useStore } = await import('@nanostores/react')
  const { atom } = await import('nanostores')

  return {
    atom,
    Button: (props: React.ComponentProps<'button'>) => <button type="button" {...props} />,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Codicon: ({ name }: { name: string }) => <span aria-hidden data-icon={name} />,
    Tip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    usePluginI18n: () => translateBots,
    useValue: useStore
  }
})

const { ASIDE_DEFAULT, ASIDE_MAX, GroupRoomAside, roomLayoutFor } = await import('./group-room-aside')
const { $roomPrefs } = await import('./group-room-prefs')
const { useArrivals } = await import('./motion')

const base = {
  collapsed: false,
  label: 'Room panel',
  onExpand: () => undefined,
  onSheetClose: () => undefined,
  panel: <div data-testid="members">members</div>,
  panelKey: 'members',
  sheetOpen: false,
  strip: <div data-testid="faces">faces</div>
}

beforeEach(() => {
  window.localStorage.clear()
  $roomPrefs.set({ desktopAlerts: false, lastOpened: {}, pins: {}, snoozes: {} })
})

afterEach(cleanup)

describe('room layout', () => {
  it('buckets the room width at the panel and rail breakpoints', () => {
    expect([400, 600, 900, 1130, 1600].map(roomLayoutFor)).toEqual(['narrow', 'compact', 'medium', 'wide', 'xwide'])
  })

  it('shows the panel inline on wide rooms and only the strip once folded', () => {
    const { rerender } = render(<GroupRoomAside {...base} layout="wide" />)
    expect(screen.getByTestId('members')).toBeTruthy()
    expect(screen.queryByTestId('faces')).toBeNull()

    rerender(<GroupRoomAside {...base} collapsed layout="wide" />)
    expect(screen.queryByTestId('members')).toBeNull()
    expect(screen.getByTestId('faces')).toBeTruthy()
  })

  it('keeps medium rooms to the strip and opens the panel as a sheet that Escape closes', () => {
    const onSheetClose = vi.fn()
    const { rerender } = render(<GroupRoomAside {...base} layout="medium" onSheetClose={onSheetClose} />)
    expect(screen.queryByTestId('members')).toBeNull()
    expect(screen.getByTestId('faces')).toBeTruthy()

    rerender(<GroupRoomAside {...base} layout="medium" onSheetClose={onSheetClose} sheetOpen />)
    expect(screen.getByTestId('group-room-sheet').textContent).toContain('members')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onSheetClose).toHaveBeenCalledTimes(1)
  })

  it('narrow rooms show nothing inline', () => {
    render(<GroupRoomAside {...base} layout="narrow" />)
    expect(screen.queryByTestId('faces')).toBeNull()
    expect(screen.queryByTestId('members')).toBeNull()
  })
})

describe('panel resize', () => {
  it('steps with the arrow keys, clamps, remembers the width and resets on double-click', () => {
    render(<GroupRoomAside {...base} layout="wide" />)
    const sash = screen.getByRole('separator')
    expect(sash.getAttribute('aria-valuenow')).toBe(String(ASIDE_DEFAULT))

    fireEvent.keyDown(sash, { key: 'ArrowLeft' })
    expect($roomPrefs.get().asideWidth).toBe(ASIDE_DEFAULT + 16)
    expect(screen.getByTestId('group-room-aside').style.width).toBe(`${ASIDE_DEFAULT + 16}px`)

    fireEvent.keyDown(sash, { key: 'Home' })
    expect($roomPrefs.get().asideWidth).toBe(ASIDE_MAX)
    fireEvent.keyDown(sash, { key: 'ArrowLeft' })
    expect($roomPrefs.get().asideWidth).toBe(ASIDE_MAX)
    expect(JSON.parse(window.localStorage.getItem('hermes.bots.roomPrefs.v1') || '{}').asideWidth).toBe(ASIDE_MAX)

    fireEvent.doubleClick(sash)
    expect($roomPrefs.get().asideWidth).toBe(ASIDE_DEFAULT)
  })
})

describe('arrivals', () => {
  it('animates only rows that land after the room opened', () => {
    const { rerender, result } = renderHook(({ room }) => useArrivals(room), { initialProps: { room: 'a' } })
    expect(result.current('old', Date.now())).toBe(false)

    rerender({ room: 'a' })
    expect(result.current('old', Date.now())).toBe(false)
    expect(result.current('history', 1)).toBe(false)
    expect(result.current('new', Date.now() + 10)).toBe(true)

    rerender({ room: 'a' })
    expect(result.current('new', Date.now() + 10)).toBe(true)

    rerender({ room: 'b' })
    expect(result.current('new', Date.now() + 10)).toBe(false)
  })
})
