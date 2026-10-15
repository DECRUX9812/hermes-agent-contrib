import type { RpcEvent } from '@hermes/plugin-sdk'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { $memberToolParts, recordGroupToolEvent, startGroupToolTap, useMemberToolCards } from './group-room-tool-cards'

const { onEventMock } = vi.hoisted(() => ({ onEventMock: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async () => {
  const nanostores = await import('nanostores')
  const { useStore } = await import('@nanostores/react')
  const { toolCardsFromParts } = await import('@/components/assistant-ui/tool-cards')
  const { upsertToolPart } = await import('@/lib/chat-messages')

  return {
    atom: nanostores.atom,
    host: { onEvent: onEventMock },
    toolCardsFromParts,
    upsertToolPart,
    useValue: useStore
  }
})

const event = (type: string, session_id: string | undefined, payload: Record<string, unknown> = {}) =>
  ({ payload, session_id, type }) as unknown as RpcEvent

const start = (session: string, toolId: string, name = 'web_search') =>
  recordGroupToolEvent(event('tool.start', session, { args: { query: toolId }, name, tool_id: toolId }))

const complete = (session: string, toolId: string, result = 'ok') =>
  recordGroupToolEvent(event('tool.complete', session, { name: 'web_search', result, tool_id: toolId }))

const partsOf = (session: string) => $memberToolParts.get()[session] ?? []

beforeEach(() => {
  $memberToolParts.set({})
  onEventMock.mockReset()
})

describe('group room tool parts', () => {
  it('records a started call as a running tool part', () => {
    start('s1', 'call-1')

    const [part] = partsOf('s1')

    expect(partsOf('s1')).toHaveLength(1)
    expect(part).toMatchObject({ toolCallId: 'call-1', toolName: 'web_search', type: 'tool-call' })
    expect(part.completedAt).toBeUndefined()
  })

  it('settles the same tool id in place when it completes', () => {
    start('s1', 'call-1')
    complete('s1', 'call-1', 'found it')

    expect(partsOf('s1')).toHaveLength(1)
    expect(partsOf('s1')[0]).toMatchObject({ result: 'found it', toolCallId: 'call-1' })
    expect(partsOf('s1')[0].completedAt).toBeDefined()
  })

  it('clears one session on message.start and leaves the others', () => {
    start('s1', 'call-1')
    start('s2', 'call-2')

    recordGroupToolEvent(event('message.start', 's1'))

    expect($memberToolParts.get().s1).toBeUndefined()
    expect(partsOf('s2')).toHaveLength(1)
  })

  it('keeps only the newest 24 tool calls per session', () => {
    for (let index = 1; index <= 30; index += 1) {
      start('s1', `call-${index}`)
    }

    const ids = partsOf('s1').map(part => part.toolCallId)

    expect(ids).toHaveLength(24)
    expect(ids[0]).toBe('call-7')
    expect(ids.at(-1)).toBe('call-30')
  })

  it('keeps at most 32 sessions and drops the least recently updated', () => {
    for (let index = 1; index <= 33; index += 1) {
      start(`s${index}`, `call-${index}`)
    }

    const sessions = Object.keys($memberToolParts.get())

    expect(sessions).toHaveLength(32)
    expect(sessions).not.toContain('s1')
    expect(sessions).toContain('s33')
  })

  it('refreshes a session on update so it outlives older ones', () => {
    for (let index = 1; index <= 32; index += 1) {
      start(`s${index}`, `call-${index}`)
    }

    start('s1', 'call-again')
    start('s33', 'call-33')

    const sessions = Object.keys($memberToolParts.get())

    expect(sessions).toContain('s1')
    expect(sessions).not.toContain('s2')
  })

  it('ignores an event without a session id', () => {
    const before = $memberToolParts.get()

    recordGroupToolEvent(event('tool.start', undefined, { name: 'web_search', tool_id: 'call-1' }))

    expect($memberToolParts.get()).toBe(before)
  })

  it('returns the same store object when a clear finds nothing to clear', () => {
    const before = $memberToolParts.get()

    recordGroupToolEvent(event('message.start', 'unknown'))

    expect($memberToolParts.get()).toBe(before)
  })
})

describe('startGroupToolTap', () => {
  it('subscribes to the three tool and turn events and disposes them together', () => {
    const disposers = [vi.fn(), vi.fn(), vi.fn()]

    onEventMock.mockReturnValueOnce(disposers[0]).mockReturnValueOnce(disposers[1]).mockReturnValueOnce(disposers[2])

    const stop = startGroupToolTap()

    expect(onEventMock.mock.calls.map(([type]) => type)).toEqual(['tool.start', 'tool.complete', 'message.start'])

    stop()

    for (const dispose of disposers) {
      expect(dispose).toHaveBeenCalledTimes(1)
    }
  })
})

describe('useMemberToolCards', () => {
  it('builds the member groups from its own session only', () => {
    start('s1', 'call-1')

    const { result } = renderHook(() => useMemberToolCards('s1', false))

    expect(result.current).toHaveLength(1)
    expect(result.current[0].cards).toHaveLength(1)
  })

  it('keeps the same groups when another session records an event', () => {
    start('s1', 'call-1')

    const { rerender, result } = renderHook(() => useMemberToolCards('s1', false))
    const before = result.current

    start('s2', 'call-2')
    rerender()

    expect(result.current).toBe(before)
  })

  it('points the approval at the running terminal call while approval is pending', () => {
    recordGroupToolEvent(event('tool.start', 's1', { name: 'terminal', tool_id: 'shell-1' }))
    recordGroupToolEvent(event('tool.start', 's1', { name: 'web_search', tool_id: 'search-1' }))

    const { result } = renderHook(() => useMemberToolCards('s1', true))

    expect(result.current.map(group => group.state)).toEqual(['approval', 'running'])
  })

  it('points the approval at a running file write as well', () => {
    recordGroupToolEvent(event('tool.start', 's1', { args: { path: '/workspace/out.txt' }, name: 'write_file', tool_id: 'write-1' }))

    const { result } = renderHook(() => useMemberToolCards('s1', true))

    expect(result.current.map(group => group.state)).toEqual(['approval'])
  })
})
