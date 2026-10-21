import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as Nanostores from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import type { ChatMessage } from '@/lib/chat-messages'
import { $selectedStoredSessionId, $sessions } from '@/store/session'
import type * as SessionStates from '@/store/session-states'
import { $sessionStates, $sessionTiles, type SessionTile } from '@/store/session-states'
import type * as SessionStatesTiles from '@/store/session-states-tiles'
import { openSessionTile } from '@/store/session-states-tiles'
import type { SessionInfo } from '@/types/hermes'

import { MissionControlView } from './index'

const { $workingSessionIdsMock } = vi.hoisted(() => {
  const { atom: nanoAtom } = require('nanostores') as typeof Nanostores

  return {
    $workingSessionIdsMock: nanoAtom<string[]>([])
  }
})

vi.mock('@/store/session-states', async importOriginal => {
  const actual = await importOriginal<typeof SessionStates>()

  return {
    ...actual,
    $workingSessionIds: $workingSessionIdsMock
  }
})

vi.mock('@/store/session-states-tiles', async importOriginal => {
  const actual = await importOriginal<typeof SessionStatesTiles>()

  return {
    ...actual,
    openSessionTile: vi.fn()
  }
})

afterEach(() => {
  cleanup()
  $workingSessionIdsMock.set([])
  $sessions.set([])
  $sessionStates.set({})
  $selectedStoredSessionId.set(null)
  $sessionTiles.set([])
  vi.clearAllMocks()
})

function createMessage(id: string, toolName: string, command: string): ChatMessage {
  return {
    id,
    parts: [
      {
        args: { command },
        argsText: JSON.stringify({ command }),
        timestamp: 100,
        toolCallId: `call-${id}`,
        toolName,
        type: 'tool-call'
      }
    ],
    role: 'assistant'
  } as ChatMessage
}

describe('MissionControlView', () => {
  it('renders the flat empty state line when nothing is running', () => {
    const onClose = vi.fn()
    const onOpenSession = vi.fn()

    render(<MissionControlView onClose={onClose} onOpenSession={onOpenSession} />)

    expect(screen.getByText('Nothing running.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Open side by side' })).toHaveProperty('disabled', true)
  })

  it('renders cards for working sessions with title, live activity, and allows opening a session', () => {
    const onClose = vi.fn()
    const onOpenSession = vi.fn()

    $sessions.set([
      { id: 'stored-1', title: 'Agent Build Mission' } as SessionInfo
    ])
    $sessionStates.set({
      'rt-1': {
        busy: true,
        messages: [createMessage('m1', 'terminal', 'cargo test')],
        storedSessionId: 'stored-1'
      } as unknown as ClientSessionState
    })
    $workingSessionIdsMock.set(['rt-1'])

    render(<MissionControlView onClose={onClose} onOpenSession={onOpenSession} />)

    expect(screen.getByText('Mission Control')).toBeDefined()
    expect(screen.getByText('Agent Build Mission')).toBeDefined()
    expect(screen.getByText('terminal: cargo test')).toBeDefined()

    const openButton = screen.getByRole('button', { name: 'Open' })

    fireEvent.click(openButton)

    expect(onOpenSession).toHaveBeenCalledWith('stored-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders a card without activity line for a state-less runtime id', () => {
    const onClose = vi.fn()
    const onOpenSession = vi.fn()

    $sessions.set([
      { id: 'rt-2', title: 'Orphaned Task' } as SessionInfo
    ])
    // rt-2 has no state in $sessionStates
    $workingSessionIdsMock.set(['rt-2'])

    render(<MissionControlView onClose={onClose} onOpenSession={onOpenSession} />)

    expect(screen.getByText('Orphaned Task')).toBeDefined()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('fires the interrupt callback and flips the card to stopping state when Stop is clicked', async () => {
    const onClose = vi.fn()
    const onOpenSession = vi.fn()
    const onStop = vi.fn().mockImplementation(() => new Promise<void>(() => {})) // pending promise

    $sessions.set([
      { id: 'stored-1', title: 'Long Running Job' } as SessionInfo
    ])
    $sessionStates.set({
      'rt-1': {
        busy: true,
        messages: [createMessage('m1', 'terminal', 'python train.py')],
        storedSessionId: 'stored-1'
      } as unknown as ClientSessionState
    })
    $workingSessionIdsMock.set(['rt-1'])

    render(<MissionControlView onClose={onClose} onOpenSession={onOpenSession} onStop={onStop} />)

    const stopButton = screen.getByRole('button', { name: 'Stop' })

    fireEvent.click(stopButton)

    expect(onStop).toHaveBeenCalledWith('rt-1')
    expect(screen.getByText('Stopping session...')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Stopping...' })).toHaveProperty('disabled', true)
  })

  it('displays a visible error message on stop failure with retry and ignore buttons', async () => {
    const onClose = vi.fn()
    const onOpenSession = vi.fn()
    const onStop = vi.fn().mockRejectedValue(new Error('Gateway timeout'))

    $sessions.set([
      { id: 'stored-1', title: 'Failing Job' } as SessionInfo
    ])
    $sessionStates.set({
      'rt-1': {
        busy: true,
        messages: [createMessage('m1', 'terminal', 'sleep 100')],
        storedSessionId: 'stored-1'
      } as unknown as ClientSessionState
    })
    $workingSessionIdsMock.set(['rt-1'])

    render(<MissionControlView onClose={onClose} onOpenSession={onOpenSession} onStop={onStop} />)

    const stopButton = screen.getByRole('button', { name: 'Stop' })

    fireEvent.click(stopButton)

    await waitFor(() => {
      expect(screen.getByText('Gateway timeout')).toBeDefined()
    })

    const retryButton = screen.getByRole('button', { name: 'Retry' })
    const ignoreButton = screen.getByRole('button', { name: 'Ignore' })

    expect(retryButton).toBeDefined()
    expect(ignoreButton).toBeDefined()

    // Clicking ignore dismisses the error message
    fireEvent.click(ignoreButton)
    expect(screen.queryByText('Gateway timeout')).toBeNull()
  })

  it('handles "Open side by side" to tile other working sessions', () => {
    const onClose = vi.fn()
    const onOpenSession = vi.fn()

    $sessions.set([
      { id: 'stored-1', title: 'Main Session' } as SessionInfo,
      { id: 'stored-2', title: 'Worker 1' } as SessionInfo,
      { id: 'stored-3', title: 'Worker 2' } as SessionInfo
    ])
    $sessionStates.set({
      'rt-1': { busy: true, storedSessionId: 'stored-1' } as unknown as ClientSessionState,
      'rt-2': { busy: true, storedSessionId: 'stored-2' } as unknown as ClientSessionState,
      'rt-3': { busy: true, storedSessionId: 'stored-3' } as unknown as ClientSessionState
    })
    $selectedStoredSessionId.set('stored-1') // focused in main
    $sessionTiles.set([{ storedSessionId: 'stored-2' } as SessionTile]) // stored-2 already tiled
    $workingSessionIdsMock.set(['rt-1', 'rt-2', 'rt-3'])

    render(<MissionControlView onClose={onClose} onOpenSession={onOpenSession} />)

    const sideBySideBtn = screen.getByRole('button', { name: 'Open side by side' })

    expect(sideBySideBtn).toHaveProperty('disabled', false)

    fireEvent.click(sideBySideBtn)

    // Only stored-3 is an untiled other working session
    expect(openSessionTile).toHaveBeenCalledWith('stored-3', 'right')
    expect(openSessionTile).not.toHaveBeenCalledWith('stored-1', expect.anything())
    expect(openSessionTile).not.toHaveBeenCalledWith('stored-2', expect.anything())
    expect(onClose).toHaveBeenCalled()
  })
})
