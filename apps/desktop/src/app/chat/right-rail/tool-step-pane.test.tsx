import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PreviewTarget } from '@/store/preview'

import { ToolStepPane } from './tool-step-pane'

const { browserThumbnailSourceMock } = vi.hoisted(() => ({ browserThumbnailSourceMock: vi.fn() }))

vi.mock('@/hooks/use-media-image', () => ({
  useMediaImage: (src: string) => ({ failed: false, onError: vi.fn(), onLoad: vi.fn(), src })
}))

vi.mock('@/components/assistant-ui/tool-cards/browser-step-resource', () => ({
  browserThumbnailSource: browserThumbnailSourceMock,
  useBrowserStepSnapshot: () => ({
    data: { found: true, text: '<html>\n  <body>Ready</body>\n</html>', url: 'https://example.com/docs' }
  }),
  useBrowserStepThumbnail: () => ({
    data: { found: true, data_base64: 'aGVsbG8=', mime: 'image/png' }
  })
}))

afterEach(() => {
  cleanup()
  browserThumbnailSourceMock.mockReset()
})

const browserStep = {
  action: 'Clicked Sign in',
  args: { selector: 'button.sign-in' },
  durationLabel: '1.2s',
  family: 'browser',
  name: 'Browser',
  result: { success: true },
  sessionId: 'session-1',
  state: 'done' as const,
  toolCallId: 'call-1',
  toolName: 'browser_click',
  url: 'https://example.com/docs'
}

const target: PreviewTarget = {
  kind: 'step',
  label: 'Browser steps',
  source: 'call-1',
  transient: true,
  url: '',
  step: browserStep
}

describe('ToolStepPane', () => {
  it('shows request, output, action, duration, URL, screenshot, and a scrollable DOM snapshot', () => {
    browserThumbnailSourceMock.mockReturnValue('data:image/png;base64,aGVsbG8=')
    const { container } = render(<ToolStepPane target={target} />)

    expect(screen.getByText('Clicked Sign in')).toBeTruthy()
    expect(screen.getByText('Request').nextElementSibling?.textContent).toContain('"selector": "button.sign-in"')
    expect(screen.getByText('Output').nextElementSibling?.textContent).toContain('"success": true')
    expect(screen.getByText('1.2s')).toBeTruthy()
    expect(screen.getByText('https://example.com/docs')).toBeTruthy()


    expect(Array.from(container.querySelectorAll('pre')).some(pre => pre.textContent?.includes('<html>'))).toBe(true)
    expect(container.querySelector('pre.overflow-auto.font-mono')).not.toBeNull()
    expect(container.querySelector('img[src^="data:image/png"]')).not.toBeNull()
  })

  it('renders no empty image container for a step without a thumbnail', () => {
    const terminal: PreviewTarget = {
      ...target,
      step: { ...browserStep, family: 'terminal', name: 'Terminal', toolName: 'terminal', url: undefined }
    }

    browserThumbnailSourceMock.mockReturnValue(undefined)

    const { container } = render(<ToolStepPane target={terminal} />)

    expect(container.querySelector('img')).toBeNull()
  })
})
