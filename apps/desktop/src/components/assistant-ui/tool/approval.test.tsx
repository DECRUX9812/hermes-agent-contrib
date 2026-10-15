import type { ApprovalChoice, ForkApproval } from '@hermes/shared'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApprovalDecision, ApprovalRequest } from '@/store/prompts'

import { ApprovalCard } from './approval'

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
})
