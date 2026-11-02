/**
 * Canonical room header: the destructive action is not a neighbor of Stop.
 * It lives behind the overflow trigger, which must be reachable by name.
 */
import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { atom: nanoAtom } = await import('nanostores')

  return {
    ...sdk,
    host: {
      ...sdk.host,
      notify: vi.fn(),
      notifyError: vi.fn(),
      state: { ...sdk.host.state, focusedSessionOwner: nanoAtom(null) }
    },
    usePluginI18n: () => translateBots
  }
})

const { CanonicalGroupHeader } = await import('./canonical-group-header')

afterEach(cleanup)

const ROOM = {
  disbanded_at: null,
  members: [
    { handle: 'research', member_id: 'm-research', profile: 'research' },
    { handle: 'builder', member_id: 'm-builder', profile: 'builder' }
  ],
  name: 'Design Room',
  room_id: 'room-1'
}

function renderHeader(overrides: Partial<Parameters<typeof CanonicalGroupHeader>[0]> = {}) {
  return render(
    <CanonicalGroupHeader
      busy={false}
      canStop
      onDisband={vi.fn(async () => undefined)}
      onRename={vi.fn()}
      onStop={vi.fn()}
      phases={new Map()}
      room={ROOM}
      {...overrides}
    />
  )
}

it('keeps Stop as the only primary action and hides the destructive one behind the overflow', () => {
  renderHeader()

  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()

  // Neither rename nor disband is a header button any more — one slipped click
  // next to Stop would cost the room.
  expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Disband' })).toBeNull()

  // The trigger is icon-only, so its name is the only way in for AT.
  expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy()
})

it('opens to Rename and the destructive Disband', () => {
  renderHeader()

  const trigger = screen.getByRole('button', { name: 'More actions' })

  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  fireEvent.click(trigger)

  expect(screen.queryByRole('menuitem', { name: 'Disband' })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeTruthy()
})
