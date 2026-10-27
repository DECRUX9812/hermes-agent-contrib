import type { ApprovalChoice } from '@hermes/shared'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $gateway } from '@/store/gateway'
import { type ApprovalRequest, clearApprovalRequest, receiveApprovalRequest } from '@/store/prompts'

import { ApprovalCard, ApprovalComposerEntry, type ApprovalDecision } from './approval'

const request: ApprovalRequest & { requestId: string } = {
  command: 'rm -rf /tmp/cache',
  description: 'Remove generated cache files',
  requestId: 'request-1',
  sessionId: 'runtime-1',
  toolName: 'terminal'
}

/** A recorded outcome, as a plugin that keeps its own approval log would pass it. */
function row(choice: ApprovalChoice | null = 'once', status = 'allowed', reason: string | null = null) {
  return { choice, reason, status }
}

function decision(overrides: Partial<ApprovalDecision> = {}): ApprovalDecision {
  return { choice: 'once', resolved: true, ...overrides }
}

afterEach(cleanup)

describe('ApprovalCard', () => {
  it('optimistically disables every decision and restores the buttons with an inline error on failure', async () => {
    let rejectAnswer!: (error: Error) => void

    const onAnswer = vi.fn(
      () =>
        new Promise<ApprovalDecision>((_resolve, reject) => {
          rejectAnswer = reject
        })
    )

    render(<ApprovalCard onAnswer={onAnswer} request={request} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    const choices = [
      screen.getByRole('button', { name: 'Allow once' }),
      screen.getByRole('button', { name: 'Always allow' }),
      screen.getByRole('button', { name: 'Deny' })
    ]

    expect(choices.every(button => (button as HTMLButtonElement).disabled)).toBe(true)
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('once')

    await act(async () => rejectAnswer(new Error('request failed')))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not send your answer')
    expect(choices.every(button => (button as HTMLButtonElement).disabled)).toBe(false)
  })

  it('confirms Always allow inline without mounting a dialog', async () => {
    const onAnswer = vi.fn(async () => decision({ choice: 'always' }))
    render(<ApprovalCard onAnswer={onAnswer} request={request} />)

    fireEvent.click(screen.getByRole('button', { name: 'Always allow' }))

    expect(screen.getByText(/Always allow “rm -rf \/tmp\/cache”\?/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(onAnswer).toHaveBeenCalledExactlyOnceWith('always'))
    expect((await screen.findByRole('status')).textContent).toContain('Decision recorded: Always allow')
  })

  it('hides Always allow when the backend will not honour a permanent allow', () => {
    render(<ApprovalCard onAnswer={vi.fn(async () => decision())} request={{ ...request, allowPermanent: false }} />)

    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Always allow' })).toBeNull()
  })

  it('shows the recorded row when another answer already resolved the request', async () => {
    const onAnswer = vi.fn(async () =>
      decision({
        approval: row('deny', 'denied'),
        choice: 'deny',
        resolved: false
      })
    )

    render(<ApprovalCard onAnswer={onAnswer} request={request} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    expect((await screen.findByRole('status')).textContent).toContain('Decision recorded: Deny')
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull()
  })

  it('says the prompt was denied when its session stopped', () => {
    const stopped = row(null, 'denied', 'session_stopped')
    render(
      <ApprovalCard
        initialDecision={decision({ approval: stopped, choice: null, resolved: false })}
        onAnswer={vi.fn()}
        request={request}
      />
    )

    expect(screen.getByRole('status').textContent).toBe('Denied, session stopped.')
  })
})

describe('ApprovalComposerEntry', () => {
  it('answers a live prompt over the stock respond RPC and keeps the outcome briefly', async () => {
    const send = vi.fn(async () => ({}))
    $gateway.set({ request: send } as never)
    await act(() => receiveApprovalRequest(null, request))

    render(<ApprovalComposerEntry runtimeSessionId="runtime-1" storedSessionId="stored-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    await waitFor(() =>
      expect(send.mock.calls.map(call => (call as unknown[])[0])).toContain('approval.respond')
    )
    expect((await screen.findByRole('status')).textContent).toContain('Decision recorded: Allow once')
    $gateway.set(null as never)
  })

  it('drops a prompt withdrawn by an interrupt instead of leaving a hanging card', async () => {
    $gateway.set({} as never)
    await act(() => receiveApprovalRequest(null, request))

    const { container } = render(<ApprovalComposerEntry runtimeSessionId="runtime-1" storedSessionId="stored-1" />)
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy()

    act(() => clearApprovalRequest('runtime-1', request.requestId))

    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull()
    expect(container.querySelector('[data-approval-stack]')).toBeNull()
    $gateway.set(null as never)
  })
})
