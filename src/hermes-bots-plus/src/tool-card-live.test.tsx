import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'
import { ToolCard } from './tool-card'
import { CrossfadeShot, expandShot, LiveFrame } from './tool-card-live'
import type { ToolCardGroup, ToolCardView } from './tool-card-model'

const openPreview = vi.fn()

vi.mock(import('@/store/preview'), async importOriginal => ({
  ...(await importOriginal()),
  openPreview: (...args: unknown[]) => openPreview(...args)
}))

vi.mock(import('@hermes/plugin-sdk'), async importOriginal => ({
  ...(await importOriginal()),
  // The bundle lands via `ctx.i18n.register` at load; resolve it directly.
  usePluginI18n: () => translateBots
}))

const SHOT_A = 'data:image/png;base64,QQ=='
const SHOT_B = 'data:image/png;base64,Qg=='

function card(id: string, overrides: Partial<ToolCardView> = {}): ToolCardView {
  return {
    args: [],
    family: 'browser',
    icon: 'globe',
    id,
    name: 'Browser',
    state: 'done',
    status: `Step ${id}`,
    ...overrides
  }
}

function group(cards: ToolCardView[], state: ToolCardGroup['state'] = 'running'): ToolCardGroup {
  return { cards, family: 'browser', icon: 'globe', key: 'g', name: 'Browser', state }
}

const shot = (src: string, url = 'https://example.com/a') => ({ kind: 'screenshot' as const, src, url })

afterEach(() => {
  cleanup()
  openPreview.mockReset()
  vi.useRealTimers()
})

describe('LiveFrame', () => {
  it('shows the newest screenshot with a live badge while the run is going', () => {
    const { container } = render(
      <LiveFrame group={group([card('a', { thumb: shot(SHOT_A) }), card('b', { thumb: shot(SHOT_B) })])} open />
    )

    expect(container.querySelector('[data-live-frame]')?.getAttribute('data-open')).toBe('true')
    expect(container.querySelector('img[data-shot-src]')?.getAttribute('data-shot-src')).toBe(SHOT_B)
    expect(screen.getByText('Live')).toBeTruthy()
  })

  it('holds a placeholder with the page until the first screenshot lands', () => {
    render(
      <LiveFrame
        group={group([card('a', { thumb: { host: 'example.com', kind: 'site', url: 'https://example.com/a' } })])}
        open
      />
    )

    expect(screen.getByText('Waiting for the first screenshot…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open screenshot in the preview' })).toBeNull()
  })

  it('is inert and folded when closed', () => {
    const { container } = render(<LiveFrame group={group([card('a', { thumb: shot(SHOT_A) })], 'done')} open={false} />)
    const frame = container.querySelector('[data-live-frame]')

    expect(frame?.getAttribute('data-open')).toBe('false')
    expect(frame?.hasAttribute('inert')).toBe(true)
    expect(screen.queryByText('Live')).toBeNull()
  })
})

describe('ToolCard live frame', () => {
  it('renders under a running browser card and folds away once it settles', () => {
    vi.useFakeTimers()

    const running = group([card('a', { state: 'running', thumb: shot(SHOT_A) })])
    const { container, rerender } = render(<ToolCard group={running} />)

    expect(container.querySelector('[data-live-frame]')?.getAttribute('data-open')).toBe('true')

    rerender(<ToolCard group={{ ...running, cards: [card('a', { thumb: shot(SHOT_A) })], state: 'done' }} />)
    expect(container.querySelector('[data-live-frame]')?.getAttribute('data-open')).toBe('false')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(container.querySelector('[data-live-frame]')).toBeNull()
  })

  it('never shows for non-browser tools', () => {
    const terminal: ToolCardGroup = {
      cards: [card('a', { family: 'terminal', state: 'running', thumb: shot(SHOT_A) })],
      family: 'terminal',
      icon: 'terminal',
      key: 't',
      name: 'Terminal',
      state: 'running'
    }

    const { container } = render(<ToolCard group={terminal} />)

    expect(container.querySelector('[data-live-frame]')).toBeNull()
  })
})

describe('CrossfadeShot', () => {
  it('keeps the old frame up until the new one has loaded, then drops it', () => {
    vi.useFakeTimers()

    const { container, rerender } = render(<CrossfadeShot src={SHOT_A} />)

    rerender(<CrossfadeShot src={SHOT_B} />)

    let layers = container.querySelectorAll('img[data-shot-src]')
    expect(layers).toHaveLength(2)
    expect(layers[0]?.getAttribute('data-ready')).toBe('true')
    expect(layers[1]?.getAttribute('data-ready')).toBe('false')

    fireEvent.load(layers[1]!)
    layers = container.querySelectorAll('img[data-shot-src]')
    expect(layers[1]?.getAttribute('data-ready')).toBe('true')

    act(() => {
      vi.advanceTimersByTime(400)
    })
    layers = container.querySelectorAll('img[data-shot-src]')
    expect(layers).toHaveLength(1)
    expect(layers[0]?.getAttribute('data-shot-src')).toBe(SHOT_B)
  })
})

describe('expandShot', () => {
  it('opens the frame screenshot in the preview pane as an image', async () => {
    const frame = window.document.createElement('button')
    const img = window.document.createElement('img')
    img.dataset.shotSrc = SHOT_A
    img.src = SHOT_A
    Object.defineProperty(img, 'complete', { value: true })
    frame.append(img)
    window.document.body.append(frame)

    await expandShot(frame, SHOT_A, 'example.com · step 1', { runtimeId: 'rt', storedId: 'st' })

    expect(openPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        dataUrl: SHOT_A,
        kind: 'file',
        label: 'example.com · step 1',
        mimeType: 'image/png',
        previewKind: 'image',
        transient: true,
        url: expect.stringMatching(/^screenshot-[0-9a-z]+\.png$/)
      }),
      'st',
      'rt'
    )
    expect(openPreview.mock.calls[0]?.[0].url).not.toContain('base64')
    frame.remove()
  })

  it('keys a file screenshot by its path and keeps it restorable', async () => {
    const frame = window.document.createElement('button')
    const img = window.document.createElement('img')
    img.dataset.shotSrc = '/tmp/shot.png'
    img.src = SHOT_A
    Object.defineProperty(img, 'complete', { value: true })
    frame.append(img)
    window.document.body.append(frame)

    await expandShot(frame, '/tmp/shot.png', 'step 2', { runtimeId: null, storedId: null })

    const target = openPreview.mock.calls[0]?.[0]
    expect(target).toMatchObject({ kind: 'file', path: '/tmp/shot.png', url: '/tmp/shot.png' })
    expect(target.transient).toBeUndefined()
    frame.remove()
  })
})
