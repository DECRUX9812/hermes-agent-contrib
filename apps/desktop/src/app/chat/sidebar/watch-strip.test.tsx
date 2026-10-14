import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { $sessions } from '@/store/session'
import { $watchedSessionKeys, toggleSessionWatched } from '@/store/session-watch'

import { SessionWatchStrip } from './watch-strip'

const session = (id: string, title: string) =>
  ({ id, profile: 'default', title }) as unknown as (typeof $sessions.value)[number]

beforeEach(() => {
  window.localStorage.clear()
  $watchedSessionKeys.set({})
  $sessions.set([])
})

afterEach(cleanup)

describe('SessionWatchStrip', () => {
  it('renders nothing while no session is watched, even as the list refreshes', () => {
    const { container } = render(<SessionWatchStrip onOpen={() => {}} />)

    act(() => $sessions.set([session('s1', 'First chat')]))

    expect(container.innerHTML).toBe('')
  })

  it('shows a chip once a session is watched and follows later list updates', () => {
    $sessions.set([session('s1', 'First chat')])
    render(<SessionWatchStrip onOpen={() => {}} />)

    act(() => void toggleSessionWatched('s1'))
    expect(screen.getByText('First chat')).toBeTruthy()

    act(() => $sessions.set([session('s1', 'Renamed chat')]))
    expect(screen.getByText('Renamed chat')).toBeTruthy()
  })
})
