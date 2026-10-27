import { describe, expect, it } from 'vitest'

import { installReactionsDefault, REACTIONS_KEY, seedReactionsDefault } from './reactions-default'

const memoryStore = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))

  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value)
  }
}

describe('reactions default', () => {
  it('turns an unset preference on', () => {
    const store = memoryStore()

    expect(seedReactionsDefault(store)).toBe(true)
    expect(store.data.get(REACTIONS_KEY)).toBe('on')
  })

  it('keeps a stored choice, including off', () => {
    const off = memoryStore({ [REACTIONS_KEY]: 'off' })
    const on = memoryStore({ [REACTIONS_KEY]: 'on' })

    expect(seedReactionsDefault(off)).toBe(false)
    expect(off.data.get(REACTIONS_KEY)).toBe('off')
    expect(seedReactionsDefault(on)).toBe(false)
  })

  it('survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {}
    }

    expect(seedReactionsDefault(blocked)).toBe(false)
    expect(seedReactionsDefault(null)).toBe(false)
  })

  it('writes only when the window goes away', () => {
    const store = memoryStore()
    const handlers = new Map<string, () => void>()

    const win = {
      addEventListener: (type: string, fn: () => void) => void handlers.set(type, fn),
      localStorage: store,
      removeEventListener: (type: string) => void handlers.delete(type)
    }

    const dispose = installReactionsDefault(win as never)

    expect(store.data.has(REACTIONS_KEY)).toBe(false)
    handlers.get('pagehide')?.()
    expect(store.data.get(REACTIONS_KEY)).toBe('on')
    dispose()
    expect(handlers.size).toBe(0)
  })
})
