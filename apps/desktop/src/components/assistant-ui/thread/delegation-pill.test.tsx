import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { $activeSessionId } from '@/store/session'
import { $subagentsBySession, upsertSubagent } from '@/store/subagents'

import { stubThreadEnvironment } from '../test-utils'

import { DelegationPill, delegationPillLabel } from './delegation-pill'

stubThreadEnvironment()

const pill = (container: HTMLElement) => container.querySelector('[data-slot="delegation-pill"]')

const spawn = (sid: string, goal: string, status = 'running', id = goal) =>
  upsertSubagent(sid, { goal, status, subagent_id: id }, true, 'subagent.start')

beforeEach(() => {
  $subagentsBySession.set({})
  $activeSessionId.set('sess-1')
})

afterEach(() => {
  cleanup()
  $subagentsBySession.set({})
  $activeSessionId.set(null)
})

describe('delegationPillLabel', () => {
  it('names the single worker by its goal', () => {
    expect(delegationPillLabel([{ goal: 'inspect repo' } as never], n => `+${n} more agents`)).toBe('inspect repo')
  })

  it('names the first worker and counts the rest of the fan-out', () => {
    const live = [{ goal: 'scan' }, { goal: 'test' }, { goal: 'lint' }] as never
    expect(delegationPillLabel(live, n => `+${n} more agents`)).toBe('scan · +2 more agents')
  })
})

describe('DelegationPill', () => {
  it('renders nothing with no live subagents', () => {
    const empty = render(<DelegationPill />)
    expect(pill(empty.container)).toBeNull()

    spawn('sess-1', 'already done', 'completed')
    const settled = render(<DelegationPill />)
    expect(pill(settled.container)).toBeNull()
  })

  it('names the worker while it runs', () => {
    spawn('sess-1', 'inspect repo')
    const { container } = render(<DelegationPill />)

    expect(pill(container)).not.toBeNull()
    expect(screen.getByText('inspect repo')).toBeTruthy()
    expect(screen.getByLabelText('Running')).toBeTruthy()
  })

  it('reads queued workers as queued', () => {
    spawn('sess-1', 'waiting worker', 'queued')
    render(<DelegationPill />)

    expect(screen.getByLabelText('Queued')).toBeTruthy()
  })

  it('counts the rest of a fan-out', () => {
    spawn('sess-1', 'first worker')
    spawn('sess-1', 'second worker')
    render(<DelegationPill />)

    expect(screen.getByText(/first worker · \+1 more agents/)).toBeTruthy()
  })

  it('scopes itself to its own session — another session’s workers do not show', () => {
    spawn('sess-other', 'foreign worker')
    const { container } = render(<DelegationPill />)

    expect(pill(container)).toBeNull()
  })

  it('expands to the session’s subagent tree, then folds back', () => {
    spawn('sess-1', 'first worker')
    spawn('sess-1', 'second worker')
    const { container } = render(<DelegationPill />)

    expect(container.querySelector('[data-slot="delegation-pill-tree"]')).toBeNull()

    fireEvent.click(screen.getByText(/first worker/))
    const tree = container.querySelector('[data-slot="delegation-pill-tree"]')
    expect(tree).not.toBeNull()
    expect(tree?.textContent).toContain('second worker')

    fireEvent.click(screen.getByText(/first worker · /))
    expect(container.querySelector('[data-slot="delegation-pill-tree"]')).toBeNull()
  })
})
