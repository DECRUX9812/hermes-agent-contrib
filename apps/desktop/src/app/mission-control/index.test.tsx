import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NEW_CHAT_ROUTE } from '@/app/routes'
import type { ClientSessionState } from '@/app/types'
import type { ChatMessage } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $selectedStoredSessionId, $sessions, $unreadFinishedSessionIds } from '@/store/session'
import { clearAllSessionStates, publishSessionState } from '@/store/session-states'
import { $sessionTiles, openSessionTile, type SessionTile } from '@/store/session-states'
import type * as SessionStatesTiles from '@/store/session-states-tiles'
import { ackAllSessionsRead, markSessionUnreadFinished } from '@/store/session-unread'
import type { SessionInfo } from '@/types/hermes'

import { MissionControlView } from './index'

vi.mock('@/store/session-states-tiles', async importOriginal => {
  const actual = await importOriginal<typeof SessionStatesTiles>()

  return {
    ...actual,
    openSessionTile: vi.fn()
  }
})

vi.mock('@/i18n', () => ({
  translateNow: (key: string, ...args: unknown[]) => [key, ...args.map(String)].join(' '),
  useI18n: () => ({
    t: {
      common: {
        approve: 'Approve',
        open: 'Open'
      },
      composer: {
        stop: 'Stop'
      },
      sessionOverview: {
        empty: 'No live sessions',
        newSession: 'New session',
        title: 'Session overview'
      },
      sidebar: {
        peek: {
          lastTool: 'Last tool',
          more: (count: number) => `+${count} more`,
          planFraction: (done: number, total: number) => `${done} of ${total}`,
          stopFailed: 'Could not stop the session'
        },
        row: {
          openInSplit: 'Open in split'
        },
        statusDivider: {
          done: 'Done',
          needsYou: 'Needs you',
          working: 'Working'
        }
      }
    }
  })
}))

afterEach(() => {
  cleanup()
  // Ack while rows are still loaded: unloaded markers survive a blind ack.
  ackAllSessionsRead()
  clearAllSessionStates()
  $unreadFinishedSessionIds.set([])
  $sessions.set([])
  $selectedStoredSessionId.set(null)
  $sessionTiles.set([])
  vi.clearAllMocks()
})

function toolMessage(id: string, toolName: string, command: string): ChatMessage {
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

function publishStored(
  runtimeId: string,
  storedId: string,
  state: Partial<ClientSessionState> & { messages?: ChatMessage[] }
) {
  publishSessionState(runtimeId, {
    ...createClientSessionState(storedId, state.messages ?? []),
    ...state
  } as ClientSessionState)
}

function renderView(props: { onClose?: () => void; onOpenSession?: () => void; onStop?: (runtimeId: string) => Promise<void> } = {}) {
  const onClose = props.onClose ?? vi.fn()
  const onOpenSession = props.onOpenSession ?? vi.fn()

  render(
    <MemoryRouter initialEntries={['/mission-control']}>
      <MissionControlView onClose={onClose} onOpenSession={onOpenSession} onStop={props.onStop} />
    </MemoryRouter>
  )

  return { onClose, onOpenSession }
}

function LocationProbe({ onPath }: { onPath: (path: string) => void }) {
  const location = useLocation()

  onPath(location.pathname)

  return null
}

describe('MissionControlView', () => {
  it('renders the empty state with a New session action when nothing is live', () => {
    const seenPaths: string[] = []
    const onClose = vi.fn()

    render(
      <MemoryRouter initialEntries={['/mission-control']}>
        <LocationProbe onPath={path => seenPaths.push(path)} />
        <MissionControlView onClose={onClose} onOpenSession={vi.fn()} />
      </MemoryRouter>
    )

    expect(screen.getByText('Session overview')).toBeDefined()
    expect(screen.getByText('No live sessions')).toBeDefined()
    expect(screen.queryByText('Needs you')).toBeNull()
    expect(screen.queryByText('Working')).toBeNull()
    expect(screen.queryByText('Done')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'New session' }))

    expect(onClose).toHaveBeenCalled()
    expect(seenPaths.at(-1)).toBe(NEW_CHAT_ROUTE)
  })

  it('renders cards grouped needs-you first with titles and live lines', () => {
    $sessions.set([
      { id: 'stored-1', last_active: 200, title: 'Worker build' } as SessionInfo,
      { id: 'stored-2', last_active: 300, title: 'Question waiting' } as SessionInfo
    ])
    publishStored('rt-1', 'stored-1', { busy: true, messages: [toolMessage('m1', 'terminal', 'cargo test')] })
    publishStored('rt-2', 'stored-2', { busy: true, needsInput: true })
    renderView()

    expect(screen.getByText('Session overview')).toBeDefined()
    expect(screen.getByText('Needs you')).toBeDefined()
    expect(screen.getByText('Working')).toBeDefined()
    expect(screen.queryByText('Done')).toBeNull()
    expect(screen.getByText('Worker build')).toBeDefined()
    expect(screen.getByText('Question waiting')).toBeDefined()
    expect(screen.getByText('terminal · cargo test')).toBeDefined()

    const openButton = screen.getAllByRole('button', { name: 'Open' })[0]

    fireEvent.click(openButton!)

    expect(openButton).toBeDefined()
  })

  it('opens the focused card with Enter', () => {
    const onClose = vi.fn()
    const onOpenSession = vi.fn()

    $sessions.set([{ id: 'stored-1', last_active: 100, title: 'Worker build' } as SessionInfo])
    publishStored('rt-1', 'stored-1', { busy: true, messages: [toolMessage('m1', 'terminal', 'make')] })
    renderView({ onClose, onOpenSession })

    expect(window.document.activeElement?.getAttribute('data-overview-card')).toBe('stored-1')

    fireEvent.keyDown(window.document.activeElement!, { key: 'Enter' })

    expect(onOpenSession).toHaveBeenCalledWith('stored-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('moves focus between cards with the arrow keys', () => {
    $sessions.set([
      { id: 'stored-1', last_active: 100, title: 'First' } as SessionInfo,
      { id: 'stored-2', last_active: 200, title: 'Second' } as SessionInfo
    ])
    publishStored('rt-1', 'stored-1', { busy: true })
    publishStored('rt-2', 'stored-2', { busy: true })
    renderView()

    expect(window.document.activeElement?.getAttribute('data-overview-card')).toBe('stored-2')

    fireEvent.keyDown(window.document.activeElement!, { key: 'ArrowDown' })

    expect(window.document.activeElement?.getAttribute('data-overview-card')).toBe('stored-1')
  })

  it('calls Open in split on the card and Stop through the interrupt callback', async () => {
    const onStop = vi.fn().mockImplementation(() => new Promise<void>(() => {}))

    $sessions.set([{ id: 'stored-1', last_active: 100, title: 'Long job' } as SessionInfo])
    publishStored('rt-1', 'stored-1', { busy: true, messages: [toolMessage('m1', 'terminal', 'sleep 100')] })
    renderView({ onStop })

    fireEvent.click(screen.getByRole('button', { name: 'Open in split' }))

    expect(openSessionTile).toHaveBeenCalledWith('stored-1', 'right')

    const stopButton = screen.getByRole('button', { name: 'Stop' })

    fireEvent.click(stopButton)

    await waitFor(() => {
      expect(onStop).toHaveBeenCalledWith('rt-1')
    })
    expect(stopButton).toHaveProperty('disabled', true)
  })

  it('shows an inline error and re-enables Stop when the interrupt fails', async () => {
    const onStop = vi.fn().mockRejectedValue(new Error('Gateway timeout'))

    $sessions.set([{ id: 'stored-1', last_active: 100, title: 'Failing job' } as SessionInfo])
    publishStored('rt-1', 'stored-1', { busy: true })
    renderView({ onStop })

    const stopButton = screen.getByRole('button', { name: 'Stop' })

    fireEvent.click(stopButton)

    await waitFor(() => {
      expect(screen.getByText('Gateway timeout')).toBeDefined()
    })
    expect(stopButton).toHaveProperty('disabled', false)
  })

  it('includes sessions finished this run and sessions open in a pane under Done', () => {
    $sessions.set([
      { id: 'stored-f', last_active: 400, title: 'Just finished' } as SessionInfo,
      { id: 'stored-t', last_active: 100, title: 'Open in pane' } as SessionInfo
    ])
    markSessionUnreadFinished('stored-f', null)
    $sessionTiles.set([{ storedSessionId: 'stored-t' } as SessionTile])
    renderView()

    expect(screen.getByText('Done')).toBeDefined()
    expect(screen.getByText('Just finished')).toBeDefined()
    expect(screen.getByText('Open in pane')).toBeDefined()
    expect(screen.queryByText('Working')).toBeNull()
  })

  it('opens a card through its Open button', () => {
    const onClose = vi.fn()
    const onOpenSession = vi.fn()

    $sessions.set([{ id: 'stored-1', last_active: 100, title: 'Worker build' } as SessionInfo])
    publishStored('rt-1', 'stored-1', { busy: true })
    renderView({ onClose, onOpenSession })

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(onOpenSession).toHaveBeenCalledWith('stored-1')
    expect(onClose).toHaveBeenCalled()

    void act(async () => {})
  })
})
