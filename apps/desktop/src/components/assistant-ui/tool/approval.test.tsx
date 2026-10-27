import type { ApprovalChoice, ForkApproval } from '@hermes/shared'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $gateway } from '@/store/gateway'
import {
  type ApprovalDecision,
  type ApprovalRequest,
  clearApprovalRequest,
  listSessionApprovals,
  receiveApprovalRequest
} from '@/store/prompts'

import { ApprovalCard, ApprovalComposerEntry } from './approval'

vi.mock('@/store/prompts', async original => ({
  ...(await original<Record<string, unknown>>()),
  listSessionApprovals: vi.fn(async () => [])
}))

const request: ApprovalRequest & { requestId: string } = {
  command: 'rm -rf /tmp/cache',
  description: 'Remove generated cache files',
  requestId: 'request-1',
  sessionId: 'runtime-1',
  toolName: 'terminal'
}

function row(choice: ApprovalChoice = 'once', status: ForkApproval['status'] = 'allowed'): ForkApproval {
  return {
    choice,
    command: request.command,
    created_at: 1,
    decided_at: 2,
    description: request.description,
    ran_at: 3,
    request_id: request.requestId,
    status,
    tool_call_id: 'call-1',
    tool_name: 'terminal'
  }
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
    const stopped = { ...row('once', 'denied'), choice: null, reason: 'session_stopped', ran_at: null }
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
  it('turns a prompt withdrawn by an interrupt into a denied outcome instead of a hanging card', async () => {
    const stopped = { ...row('once', 'denied'), choice: null, reason: 'session_stopped', ran_at: null }
    const list = vi.mocked(listSessionApprovals)
    // The cancel reaches the desktop before the plugin's write: the first re-list still says pending.
    list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row('once', 'pending')])
      .mockResolvedValue([stopped])
    $gateway.set({} as never)
    await act(() => receiveApprovalRequest(null, request))

    render(<ApprovalComposerEntry runtimeSessionId="runtime-1" storedSessionId="stored-1" />)
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy()

    act(() => clearApprovalRequest('runtime-1', request.requestId))

    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull()
    expect((await screen.findByRole('status', {}, { timeout: 2000 })).textContent).toBe('Denied, session stopped.')
    $gateway.set(null as never)
  })
})
