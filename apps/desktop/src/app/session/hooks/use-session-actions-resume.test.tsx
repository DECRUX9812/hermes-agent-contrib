// Resume-shaped session actions: the turn-timer contract and the route-token
// re-home race. Split out of use-session-actions.test.tsx, which is at its file
// cap — keep new resume cases here.
import { useStore } from '@nanostores/react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getAllSessionMessages, getLatestSessionMessages } from '@/hermes'
import { createClientSessionState } from '@/lib/chat-runtime'
import {
  $activeSessionId,
  $turnStartedAt,
  setActiveSessionId,
  setAwaitingResponse,
  setBusy,
  setMessages,
  setSessions,
  setTurnStartedAt
} from '@/store/session'
import { $removedSessionIds, $sessionMutationsInFlight } from '@/store/session-removal'
import { makeSessionInfo } from '@/test/session-info'

import sessionResumeActiveTurn from '../../../../../../tests/fixtures/session-resume-active-turn.json'
import type { ClientSessionState } from '../../types'

import { useSessionActions } from './use-session-actions'
import { useSessionStateCache } from './use-session-state-cache'

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteSession: vi.fn(),
  getSession: vi.fn(),
  getAllSessionMessages: vi.fn(),
  getLatestSessionMessages: vi.fn(),
  listAllProfileSessions: vi.fn(),
  setApiRequestProfile: vi.fn(),
  setSessionArchived: vi.fn()
}))

vi.mock('@/store/profile', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureGatewayAgent: vi.fn().mockResolvedValue(undefined),
  ensureGatewayProfile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/store/gateway', async importOriginal => {
  const original = await importOriginal<Record<string, unknown>>()

  return {
    ...original,
    // Default-preserving spy: tests that route by the active source override it.
    activeGatewayConnectionId: vi.fn(original.activeGatewayConnectionId as () => null | string),
    requestGatewayForAgent: vi.fn(),
    requestGatewayForProfile: vi.fn(),
    retainGatewayForAgent: vi.fn(async () => () => undefined)
  }
})

function ResumeTimerHarness({
  onReady,
  requestGateway
}: {
  onReady: (resume: (storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) => void
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}) {
  const activeSessionId = useStore($activeSessionId)
  const busyRef = useRef(false)

  const cache = useSessionStateCache({
    activeSessionId,
    busyRef,
    selectedStoredSessionId: null,
    setAwaitingResponse,
    setBusy,
    setMessages
  })

  const actions = useSessionActions({
    activeSessionId,
    activeSessionIdRef: cache.activeSessionIdRef,
    busyRef,
    creatingSessionRef: useRef(false),
    ensureSessionState: cache.ensureSessionState,
    getRouteToken: () => 'timer-contract',
    navigate: vi.fn() as never,
    requestGateway,
    resetViewSync: cache.resetViewSync,
    runtimeIdByStoredSessionIdRef: cache.runtimeIdByStoredSessionIdRef,
    selectedStoredSessionId: null,
    selectedStoredSessionIdRef: cache.selectedStoredSessionIdRef,
    sessionStateByRuntimeIdRef: cache.sessionStateByRuntimeIdRef,
    holdSessionTranscriptView: cache.holdSessionTranscriptView,
    syncSessionStateToView: cache.syncSessionStateToView,
    getRoutedStoredSessionId: () => null,
    routedSessionId: null,
    updateSessionState: cache.updateSessionState
  })

  useEffect(() => {
    onReady(actions.resumeSession)
  }, [actions.resumeSession, onReady])

  return null
}

describe('session.resume turn timer contract', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)

      return null as unknown as number
    })
    setActiveSessionId(null)
    setAwaitingResponse(false)
    setBusy(false)
    setMessages([])
    setSessions([])
    setTurnStartedAt(null)
  })

  afterEach(() => {
    cleanup()
    setActiveSessionId(null)
    setAwaitingResponse(false)
    setBusy(false)
    setMessages([])
    setSessions([])
    setTurnStartedAt(null)
    vi.restoreAllMocks()
  })

  async function resumeFrom(response: unknown): Promise<void> {
    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        // Model the JSON-RPC serialization/deserialization boundary. The shared
        // fixture is asserted against the real gateway response in Python.
        return JSON.parse(JSON.stringify(response)) as never
      }

      return {} as never
    })

    vi.mocked(getAllSessionMessages).mockResolvedValue({ messages: [], session_id: 'stored-running' } as never)

    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(<ResumeTimerHarness onReady={ready => (resume = ready)} requestGateway={requestGateway} />)
    await waitFor(() => expect(resume).not.toBeNull())
    await act(async () => {
      await resume!('stored-running', true)
    })
  }

  it('restores the canonical gateway turn timestamp in milliseconds', async () => {
    await resumeFrom(sessionResumeActiveTurn)

    expect($turnStartedAt.get()).toBe(sessionResumeActiveTurn.turn_started_at * 1000)
  })

  it('clears a stale timer when the gateway response is not running', async () => {
    setTurnStartedAt(1_600_000_000_000)

    await resumeFrom({ ...sessionResumeActiveTurn, running: false })

    expect($turnStartedAt.get()).toBeNull()
  })

  it('clears a stale timer when the running gateway response omits its timestamp', async () => {
    const missingTimestamp: Record<string, unknown> = JSON.parse(JSON.stringify(sessionResumeActiveTurn))
    delete missingTimestamp.turn_started_at
    setTurnStartedAt(1_600_000_000_000)

    await resumeFrom(missingTimestamp)

    expect($turnStartedAt.get()).toBeNull()
  })
})

// ── The router landing ON the resumed session is not a switch away from it ────
// fork.ts (and every routed create) navigates to the child and calls
// resumeSession in the SAME tick, so `getRouteToken()` still reads the
// pre-navigation route at entry while the ref only catches up a render later.
// The token shape is `${pathname}:${search}:${hash}`, i.e. `/id::` for a plain
// chat route.
function RehomeHarness({
  getRouteToken,
  onReady,
  requestGateway,
  selectedStoredSessionId = null
}: {
  getRouteToken: () => string
  onReady: (resume: (storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) => void
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  selectedStoredSessionId?: null | string
}) {
  const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value })

  const actions = useSessionActions({
    activeSessionId: null,
    activeSessionIdRef: ref<string | null>(null),
    busyRef: ref(false),
    creatingSessionRef: ref(false),
    ensureSessionState: () => ({}) as ClientSessionState,
    getRouteToken,
    getRoutedStoredSessionId: () => null,
    navigate: vi.fn() as never,
    requestGateway,
    resetViewSync: vi.fn(),
    routedSessionId: null,
    runtimeIdByStoredSessionIdRef: ref(new Map<string, string>()),
    selectedStoredSessionId,
    selectedStoredSessionIdRef: ref<string | null>(selectedStoredSessionId),
    sessionStateByRuntimeIdRef: ref(new Map<string, ClientSessionState>()),
    syncSessionStateToView: vi.fn(),
    updateSessionState: (_sessionId, updater) => updater(createClientSessionState(null))
  })

  useEffect(() => {
    onReady(actions.resumeSession)
  }, [actions.resumeSession, onReady])

  return null
}

describe('resumeSession re-home race (navigate + resume in one tick)', () => {
  afterEach(() => {
    cleanup()
    setActiveSessionId(null)
    setMessages([])
    setSessions([])
    $removedSessionIds.set(new Set())
    $sessionMutationsInFlight.set(new Set())
    vi.restoreAllMocks()
  })

  async function startResume(
    routeToken: () => string,
    requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  ) {
    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(
      <RehomeHarness
        getRouteToken={routeToken}
        onReady={r => (resume = r)}
        requestGateway={requestGateway}
        selectedStoredSessionId="stored-1"
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())

    return resume!
  }

  it('keeps the resume when the route lands on the session being resumed mid-flight', async () => {
    let routeToken = '/stored-parent::'

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        return {
          info: {},
          message_count: 0,
          messages: [],
          resumed: 'stored-1',
          session_id: 'runtime-1',
          session_key: 'stored-1'
        } as never
      }

      return {} as never
    })

    setSessions([makeSessionInfo({ id: 'stored-1', source: 'desktop' })])
    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [], session_id: 'stored-1' } as never)

    const resume = await startResume(() => routeToken, requestGateway)

    let pending!: Promise<unknown>
    act(() => {
      pending = resume('stored-1')
    })

    // The navigate() that shipped with this resume commits its render now.
    routeToken = '/stored-1::'

    await act(async () => {
      await pending
    })

    // Abandoning here left the branch child on its loader forever with no
    // session.resume ever sent.
    expect(requestGateway).toHaveBeenCalledWith('session.resume', expect.anything())
    expect($activeSessionId.get()).toBe('runtime-1')
  })

  it('still abandons the resume when the route lands on a different chat mid-flight', async () => {
    let routeToken = '/stored-parent::'

    const requestGateway = vi.fn(async () => ({}) as never)

    setSessions([makeSessionInfo({ id: 'stored-1', source: 'desktop' })])
    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [], session_id: 'stored-1' } as never)

    const resume = await startResume(() => routeToken, requestGateway)

    let pending!: Promise<unknown>
    act(() => {
      pending = resume('stored-1')
    })

    // A genuine switch away must still win.
    routeToken = '/stored-elsewhere::'

    await act(async () => {
      await pending
    })

    expect(requestGateway).not.toHaveBeenCalledWith('session.resume', expect.anything())
    // No resume landed: the view is not bound to the abandoned session's runtime.
    expect($activeSessionId.get()).toBeNull()
  })
})
