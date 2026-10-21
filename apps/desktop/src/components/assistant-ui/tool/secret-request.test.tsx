import { cleanup, fireEvent, render as renderUi, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HermesGateway } from '@/hermes'
import { $gateway } from '@/store/gateway'
import { clearAllPrompts, setSecretRequest } from '@/store/prompts'
import { rememberServerRequest, resetServerRequestsForTests } from '@/store/server-requests'
import { $activeSessionId } from '@/store/session'

import { PendingSecretCard } from './secret-request'

function render(children: ReactNode) {
  return renderUi(<>{children}</>)
}

function mockGateway() {
  const request = vi.fn().mockResolvedValue({})
  $gateway.set({ request } as unknown as HermesGateway)

  return request
}

function liveSecretRequest(id = 'srq-secret') {
  const respond = vi.fn()
  rememberServerRequest({ fail: vi.fn(), id, method: 'secret', params: {}, respond })

  return respond
}

beforeEach(() => {
  resetServerRequestsForTests()
})

afterEach(() => {
  cleanup()
  clearAllPrompts()
  resetServerRequestsForTests()
  $activeSessionId.set(null)
  $gateway.set(null)
})

describe('PendingSecretCard', () => {
  it('renders nothing without a request', () => {
    const { container } = render(<PendingSecretCard />)

    expect(container.querySelector('[data-secret-request]')).toBeNull()
  })

  it('renders nothing for a request owned by another session', () => {
    $activeSessionId.set('sess-1')
    setSecretRequest({ envVar: 'API_KEY', prompt: 'need it', requestId: 'srq-other', sessionId: 'sess-2' })

    const { container } = render(<PendingSecretCard />)

    expect(container.querySelector('[data-secret-request]')).toBeNull()
  })

  it('renders nothing for a sessionless request (modal owns those)', () => {
    setSecretRequest({ envVar: 'API_KEY', prompt: 'need it', requestId: 'srq-app', sessionId: null })

    const { container } = render(<PendingSecretCard />)

    expect(container.querySelector('[data-secret-request]')).toBeNull()
  })

  it('answers the live server request with the masked value', () => {
    mockGateway()
    const respond = liveSecretRequest('srq-1')
    $activeSessionId.set('sess-1')
    setSecretRequest({ envVar: 'OPENAI_API_KEY', prompt: 'Enter your key', requestId: 'srq-1', sessionId: 'sess-1' })

    render(<PendingSecretCard />)

    const input = screen.getByPlaceholderText('OPENAI_API_KEY')
    expect(input.getAttribute('type')).toBe('password')
    // No focus steal — the card must never hijack the composer.
    expect(document.activeElement).not.toBe(input)

    fireEvent.change(input, { target: { value: 'sk-live-123' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(respond).toHaveBeenCalledWith({ value: 'sk-live-123' })
  })

  it('sends an empty value on skip', () => {
    mockGateway()
    const respond = liveSecretRequest('srq-2')
    $activeSessionId.set('sess-1')
    setSecretRequest({ envVar: 'TOKEN', prompt: '', requestId: 'srq-2', sessionId: 'sess-1' })

    render(<PendingSecretCard />)
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))

    expect(respond).toHaveBeenCalledWith({ value: '' })
  })

  it('clears the card after answering', () => {
    mockGateway()
    liveSecretRequest('srq-3')
    $activeSessionId.set('sess-1')
    setSecretRequest({ envVar: 'TOKEN', prompt: '', requestId: 'srq-3', sessionId: 'sess-1' })

    const { container } = render(<PendingSecretCard />)
    fireEvent.change(screen.getByPlaceholderText('TOKEN'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(container.querySelector('[data-secret-request]')).toBeNull()
  })
})
