import { afterEach, describe, expect, it, vi } from 'vitest'

import { browserBackendFor, browserBackendFrom, forgetBrowserBackends } from './browser-backend'
import type { RosterRow } from './types'

const request = vi.fn()

vi.mock(import('./routing'), async importOriginal => ({
  ...(await importOriginal()),
  requestForBot: (...args: unknown[]) => request(...args)
}))

const bot = { name: 'scout' } as RosterRow

afterEach(() => {
  forgetBrowserBackends()
  request.mockReset()
})

describe('browserBackendFrom', () => {
  it('puts a headed local browser on the desktop', () => {
    expect(browserBackendFrom({ browser: { cloud_provider: 'local', headed: true } }, '')).toBe('desktop')
    expect(browserBackendFrom({ browser: { cloud_provider: null, headed: 'yes' } }, null)).toBe('desktop')
    expect(browserBackendFrom({ browser: { cloud_provider: '', headed: 1 } }, undefined)).toBe('desktop')
  })

  it('keeps a cloud provider off the desktop', () => {
    expect(browserBackendFrom({ browser: { cloud_provider: 'nous', headed: true } }, '')).toBe('elsewhere')
    expect(browserBackendFrom({ browser: { cloud_provider: 'browserbase', headed: true } }, '')).toBe('elsewhere')
  })

  it('lets a CDP override win over a local provider', () => {
    expect(browserBackendFrom({ browser: { cloud_provider: 'local', headed: true } }, 'ws://127.0.0.1:9222')).toBe('elsewhere')
    expect(
      browserBackendFrom({ browser: { cdp_url: 'http://10.0.0.2:9222', cloud_provider: 'local', headed: true } }, '')
    ).toBe('elsewhere')
  })

  it('treats a headless or Lightpanda local browser as nothing to watch', () => {
    expect(browserBackendFrom({ browser: { cloud_provider: 'local' } }, '')).toBe('elsewhere')
    expect(browserBackendFrom({ browser: { cloud_provider: 'local', headed: 'false' } }, '')).toBe('elsewhere')
    expect(browserBackendFrom({ browser: { cloud_provider: 'local', engine: 'lightpanda', headed: true } }, '')).toBe(
      'elsewhere'
    )
  })

  it('cannot tell when the provider is left to auto-detect or the config is missing', () => {
    expect(browserBackendFrom({ browser: { headed: true } }, '')).toBe('unknown')
    expect(browserBackendFrom({}, '')).toBe('unknown')
    expect(browserBackendFrom(null, '')).toBe('unknown')
  })
})

describe('browserBackendFor', () => {
  it('asks the bot once for config and CDP status and reuses the answer', async () => {
    request.mockImplementation(async (_bot: unknown, method: string) =>
      method === 'config.get' ? { config: { browser: { cloud_provider: 'local', headed: true } } } : { url: '' }
    )

    expect(await browserBackendFor(bot)).toBe('desktop')
    expect(await browserBackendFor(bot)).toBe('desktop')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.map(call => call[1]).sort()).toEqual(['browser.manage', 'config.get'])
  })

  it('reads a failed request as unknown', async () => {
    request.mockRejectedValue(new Error('offline'))

    expect(await browserBackendFor(bot)).toBe('unknown')
  })

  it('reads again once the answer is stale', async () => {
    request.mockImplementation(async (_bot: unknown, method: string) =>
      method === 'config.get' ? { config: { browser: { cloud_provider: 'nous' } } } : { url: '' }
    )

    await browserBackendFor(bot)
    await browserBackendFor(bot, Date.now() + 60_000)
    expect(request).toHaveBeenCalledTimes(4)
  })
})
