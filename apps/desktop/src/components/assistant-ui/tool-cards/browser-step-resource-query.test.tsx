import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { type PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useBrowserStepSnapshot, useBrowserStepThumbnail } from './browser-step-resource'

const { requestForSessionProfileMock, requestGatewayMock } = vi.hoisted(() => ({
  requestForSessionProfileMock: vi.fn(),
  requestGatewayMock: vi.fn()
}))

vi.mock('@/app/gateway/hooks/use-gateway-request', () => ({
  useGatewayRequest: () => ({ requestGateway: requestGatewayMock })
}))

vi.mock('@/store/session-request-router', () => ({
  requestForSessionProfile: requestForSessionProfileMock
}))

afterEach(() => {
  cleanup()
  requestForSessionProfileMock.mockReset()
  requestGatewayMock.mockReset()
})

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('browser step query hooks', () => {
  it('waits until the pill is visible and routes the persisted capture by its session owner', async () => {
    const owner = { connectionId: 'conn-1', profile: 'desktop', targetProfile: 'research' }
    const step = { owner, profile: 'default', sessionId: 'session-1', toolCallId: 'call-1' }
    requestForSessionProfileMock.mockResolvedValue({ found: false, reason: 'too_large' })

    const { rerender, result } = renderHook(({ visible }) => useBrowserStepThumbnail(step, visible), {
      initialProps: { visible: false },
      wrapper
    })

    expect(requestForSessionProfileMock).not.toHaveBeenCalled()
    rerender({ visible: true })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requestForSessionProfileMock).toHaveBeenCalledWith(
      owner,
      requestGatewayMock,
      'fork.browser.thumbnail',
      { profile: 'research', session_id: 'session-1', tool_call_id: 'call-1' },
      undefined,
      expect.any(AbortSignal)
    )
  })

  it('loads the DOM snapshot only after the Step pane opens', async () => {
    const step = { profile: 'research', sessionId: 'session-2', toolCallId: 'call-2' }
    requestForSessionProfileMock.mockResolvedValue({ found: true, text: '<body>Ready</body>' })

    const { result } = renderHook(() => useBrowserStepSnapshot(step), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requestForSessionProfileMock).toHaveBeenCalledWith(
      'research',
      requestGatewayMock,
      'fork.browser.snapshot',
      { profile: 'research', session_id: 'session-2', tool_call_id: 'call-2' },
      undefined,
      expect.any(AbortSignal)
    )
  })
})
