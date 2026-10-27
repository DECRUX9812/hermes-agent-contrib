import { beforeEach, describe, expect, it } from 'vitest'

import { $learnedStoredByRuntime, $liveTurns, feedLiveTurn, learnStoredId, reduceLiveTurn, sweepLiveTurns } from './rail-live'

const busy = { s1: true }

describe('rail live turns', () => {
  beforeEach(() => {
    $liveTurns.set({})
    $learnedStoredByRuntime.set({})
  })

  it('follows a turn through a tool and an approval gate, then drops it', () => {
    feedLiveTurn({ session_id: 's1', type: 'message.start' }, busy, 1)
    expect($liveTurns.get().s1).toMatchObject({ phase: 'thinking' })

    feedLiveTurn({ payload: { name: 'write_file' }, session_id: 's1', type: 'tool.start' }, busy, 2)
    expect($liveTurns.get().s1).toMatchObject({ phase: 'tool', tool: 'write_file' })

    feedLiveTurn(
      { payload: { command: '<write to AGENTS.md>', prompt_id: 'p1' }, session_id: 's1', type: 'approval.request' },
      busy,
      3
    )
    expect($liveTurns.get().s1).toMatchObject({ command: '<write to AGENTS.md>', phase: 'approval', promptId: 'p1' })

    // A tool frame while the gate is open does not hide the gate.
    feedLiveTurn({ session_id: 's1', type: 'tool.complete' }, busy, 4)
    expect($liveTurns.get().s1?.phase).toBe('approval')

    feedLiveTurn({ session_id: 's1', type: 'approval.settled' }, busy, 5)
    expect($liveTurns.get().s1).toMatchObject({ phase: 'tool', tool: 'write_file' })

    feedLiveTurn({ session_id: 's1', type: 'message.complete' }, busy, 6)
    expect($liveTurns.get().s1).toBeUndefined()
  })

  it('never revives a finished turn from a late frame', () => {
    feedLiveTurn({ payload: { name: 'terminal' }, session_id: 's2', type: 'tool.start' }, busy, 1)
    expect($liveTurns.get().s2).toBeUndefined()
  })

  it('drops a turn the busy map shows idle (interrupt, lost terminal frame)', () => {
    feedLiveTurn({ session_id: 's1', type: 'message.start' }, busy, 1)
    sweepLiveTurns({ s1: true })
    expect($liveTurns.get().s1).toBeDefined()
    sweepLiveTurns({ s1: false })
    expect($liveTurns.get().s1).toBeUndefined()
  })

  it('an error ends the turn', () => {
    expect(reduceLiveTurn({ phase: 'thinking', since: 1 }, { type: 'error' }, 2)).toBeNull()
  })

  it('learns runtime to stored ids from focus', () => {
    learnStoredId('rt', 'stored')
    learnStoredId(null, 'x')
    expect($learnedStoredByRuntime.get()).toEqual({ rt: 'stored' })
  })
})
