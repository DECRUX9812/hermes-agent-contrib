import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { $sessions, $sessionsLoading } from '@/store/session'
import { makeSessionInfo } from '@/test/session-info'

import { ActivityTab } from './activity-tab'

afterEach(() => {
  cleanup()
  $sessions.set([])
  $sessionsLoading.set(true)
})

describe('ActivityTab', () => {
  it('treats session last_active as epoch seconds, not milliseconds', () => {
    act(() => {
      $sessions.set([
        makeSessionInfo({
          id: 'recent',
          title: 'Recently active session',
          last_active: Date.now() / 1000 - 120
        })
      ])
      $sessionsLoading.set(false)
    })

    render(<ActivityTab />)

    // relativeTime expects milliseconds; a seconds epoch read as ms renders
    // "~20,728 days ago" instead of about two minutes.
    expect(screen.getByText(/2 min(ute)?s?\.? ago/)).toBeDefined()
    expect(screen.queryByText(/days ago/)).toBeNull()
  })
})
