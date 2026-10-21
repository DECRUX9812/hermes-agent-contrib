import { beforeEach, describe, expect, it, vi } from 'vitest'

const { api, notify, notifyError, writeText } = vi.hoisted(() => ({
  api: vi.fn(),
  notify: vi.fn(),
  notifyError: vi.fn(),
  writeText: vi.fn()
}))

vi.mock('@/api/client', () => ({ hermesApi: api }))
vi.mock('@/i18n', () => ({ translateNow: (key: string) => key }))
vi.mock('@/store/notifications', () => ({ notify, notifyError }))

beforeEach(() => {
  api.mockReset()
  notify.mockReset()
  notifyError.mockReset()
  writeText.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
})

describe('shareSessionLink', () => {
  it('mints a link, copies the absolute URL, and confirms', async () => {
    api.mockResolvedValue({
      expires_at: null,
      path: '/share/view?t=abc',
      profile: 'default',
      token: 'abc',
      url: 'http://127.0.0.1:8642/share/view?t=abc'
    })
    const { shareSessionLink } = await import('./session-share')

    const url = await shareSessionLink('sess-1')

    expect(url).toBe('http://127.0.0.1:8642/share/view?t=abc')
    expect(api).toHaveBeenCalledWith({
      body: { session_id: 'sess-1' },
      method: 'POST',
      path: '/api/share/create'
    })
    expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:8642/share/view?t=abc')
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', message: 'desktop.shareLinkCopied' })
    )
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('pins the profile the session belongs to', async () => {
    api.mockResolvedValue({ url: 'https://gw.example/share/view?t=x' })
    const { shareSessionLink } = await import('./session-share')

    await shareSessionLink('sess-2', 'work')

    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({ body: { session_id: 'sess-2', profile: 'work' } })
    )
  })

  it('reports failure without copying anything', async () => {
    api.mockRejectedValue(new Error('boom'))
    const { shareSessionLink } = await import('./session-share')

    const url = await shareSessionLink('sess-3')

    expect(url).toBeNull()
    expect(writeText).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(notifyError).toHaveBeenCalledWith(expect.any(Error), 'desktop.shareLinkFailed')
  })

  it('no-ops on an empty session id', async () => {
    const { shareSessionLink } = await import('./session-share')

    expect(await shareSessionLink('')).toBeNull()
    expect(api).not.toHaveBeenCalled()
  })
})
