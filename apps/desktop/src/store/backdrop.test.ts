import { beforeEach, describe, expect, it, vi } from 'vitest'

// The picker replaced a boolean: a v1 user's stored "on" must come back as the
// statue they had, and the v1 key keeps tracking on/off for the plugin SDK.
async function load(seed: Record<string, string> = {}) {
  vi.resetModules()
  window.localStorage.clear()

  for (const [key, value] of Object.entries(seed)) {
    window.localStorage.setItem(key, value)
  }

  return import('./backdrop')
}

describe('backdrop store', () => {
  beforeEach(() => window.localStorage.clear())

  it("migrates a v1 'on' to the statue and a missing setting to off", async () => {
    expect((await load({ 'hermes.desktop.backdrop.v1': 'true' })).$backdropScene.get()).toBe('statue')
    expect((await load()).$backdropScene.get()).toBe('off')
  })

  it('keeps the v1 boolean view and key in step with the scene', async () => {
    const store = await load()

    store.setBackdropScene('aurora')
    expect(store.$backdrop.get()).toBe(true)
    expect(window.localStorage.getItem('hermes.desktop.backdrop.v1')).toBe('true')

    // v1 "on" never downgrades a chosen scene to the statue.
    store.setBackdrop(true)
    expect(store.$backdropScene.get()).toBe('aurora')

    store.setBackdrop(false)
    expect(store.$backdropScene.get()).toBe('off')
    expect(window.localStorage.getItem('hermes.desktop.backdrop.v1')).toBe('false')
  })

  it('choosing an image shows it; forgetting it leaves the custom scene', async () => {
    const store = await load()

    store.setBackdropImage('data:image/jpeg;base64,abc')
    expect(store.$backdropScene.get()).toBe('custom')

    store.setBackdropImage(null)
    expect(store.$backdropScene.get()).toBe('off')
    expect(window.localStorage.getItem('hermes.desktop.backdrop.image.v1')).toBeNull()
  })
})
