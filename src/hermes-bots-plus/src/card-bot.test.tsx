import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetCardBotPrime, useCardBot } from './card-bot'
import { $lastRoster as roster } from './data'
import { PreviewSessionContext } from './tool-card-session'
import type { RosterRow } from './types'

const { cache, prime } = vi.hoisted(() => ({
  cache: { rows: null as null | unknown[] },
  prime: vi.fn(async () => {})
}))

vi.mock(import('./data'), async importOriginal => ({
  ...(await importOriginal()),
  cachedUnionRoster: () => ((cache.rows ? { profiles: cache.rows } : null) as never),
  primeRoster: () => prime()
}))

vi.mock(import('./chat-empty'), async importOriginal => ({
  ...(await importOriginal()),
  botForChat: (rows: readonly RosterRow[], storedId: string) =>
    rows.find(row => (row as { canonical_session?: string }).canonical_session === storedId) ?? null
}))

const scout = { canonical_session: 's1', name: 'scout' } as unknown as RosterRow
let seen: null | RosterRow | undefined

function Probe() {
  seen = useCardBot()

  return null
}

function inChat(storedId: null | string): (props: { children: ReactNode }) => ReactNode {
  return ({ children }) => (
    <PreviewSessionContext.Provider value={{ runtimeId: null, storedId }}>{children}</PreviewSessionContext.Provider>
  )
}

afterEach(() => {
  cleanup()
  roster.set([])
  cache.rows = null
  prime.mockReset()
  prime.mockImplementation(async () => {})
  resetCardBotPrime()
  seen = undefined
})

describe('useCardBot', () => {
  it('reads the published roster when the Bots pane has loaded it', () => {
    roster.set([scout])
    render(<Probe />, { wrapper: inChat('s1') })

    expect(seen).toBe(scout)
    expect(prime).not.toHaveBeenCalled()
  })

  it('falls back to the roster cache without the Bots pane', () => {
    cache.rows = [scout]
    render(<Probe />, { wrapper: inChat('s1') })

    expect(seen).toBe(scout)
    expect(prime).not.toHaveBeenCalled()
  })

  it('fetches the roster once on a miss, then finds the bot', async () => {
    prime.mockImplementation(async () => {
      cache.rows = [scout]
    })

    render(
      <>
        <Probe />
        <Probe />
      </>,
      { wrapper: inChat('s1') }
    )

    expect(seen).toBeNull()
    await act(async () => {})

    expect(seen).toBe(scout)
    expect(prime).toHaveBeenCalledTimes(1)
  })

  it('stays quiet outside a chat', () => {
    render(<Probe />, { wrapper: inChat(null) })

    expect(seen).toBeNull()
    expect(prime).not.toHaveBeenCalled()
  })
})
