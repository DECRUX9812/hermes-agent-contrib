import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

/**
 * The shared disband sentence is prefix + bold room name + count-bearing
 * suffix. Both room surfaces feed it from their own label bundles, so the
 * composition itself is the contract worth pinning: dropping the name (or the
 * count) would silently produce "Disband  its members?" on both.
 */

vi.mock('@hermes/plugin-sdk', () => ({
  ConfirmDialog: ({ description, open, title }: { description: React.ReactNode; open: boolean; title: string }) =>
    open ? <div>{title}{description}</div> : null
}))

import { RoomDisbandDialog } from './room-disband-dialog'

afterEach(cleanup)

const props = {
  busyLabel: 'Disbanding…',
  confirmLabel: 'Disband',
  descPrefix: 'Disband ',
  descSuffix: (count: number) => ` and its ${count} members?`,
  doneLabel: 'Disbanded',
  onClose: () => undefined,
  onConfirm: async () => undefined,
  open: true,
  title: 'Disband room'
}

it('puts the room name and the member count in the sentence', () => {
  const { container } = render(<RoomDisbandDialog {...props} memberCount={3} name="Launch crew" />)

  expect(container.textContent).toBe('Disband roomDisband Launch crew and its 3 members?')
})

it('renders nothing while closed', () => {
  const { container } = render(<RoomDisbandDialog {...props} memberCount={3} name="Launch crew" open={false} />)

  expect(container.textContent).toBe('')
})
