import { describe, expect, it } from 'vitest'

import type { RosterRow } from '../types'

import { fill, localBots } from './cloud'

const row = (name: string, remoteSource?: string) => ({ name, remoteSource }) as unknown as RosterRow

describe('browser settings helpers', () => {
  it('fills placeholders and keeps unknown ones', () => {
    expect(fill('Switch {bot}?', { bot: 'coder' })).toBe('Switch coder?')
    expect(fill('{a} {b}', { a: 'x' })).toBe('x {b}')
  })

  it('lists each local bot once and never a remote one', () => {
    expect(localBots([row('coder'), row('assistant'), row('coder'), row('far', 'lan-box'), row('')]).map(b => b.name)).toEqual([
      'coder',
      'assistant'
    ])
  })
})
