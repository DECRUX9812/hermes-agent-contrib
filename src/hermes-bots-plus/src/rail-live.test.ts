import { beforeEach, describe, expect, it } from 'vitest'

import { ownerLiveFiles } from './bot-deliverables'
import { routineNeedsAttention } from './cron'
import {
  $learnedStoredByRuntime,
  $liveFiles,
  $liveTurns,
  deliveredPath,
  feedLiveTurn,
  learnStoredId,
  recordLiveFile,
  reduceLiveTurn,
  sweepLiveTurns
} from './rail-live'

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

describe('delivered files', () => {
  beforeEach(() => $liveFiles.set([]))

  it('takes the path of a successful write_file or patch, nothing else', () => {
    expect(deliveredPath({ args: { path: '/w/a.md' }, is_error: false, tool_name: 'write_file' })).toBe('/w/a.md')
    expect(deliveredPath({ args: { path: '/w/b.ts' }, name: 'patch' })).toBe('/w/b.ts')
    expect(deliveredPath({ args: { path: '/w/a.md' }, is_error: true, tool_name: 'write_file' })).toBeNull()
    expect(deliveredPath({ args: { command: 'ls' }, tool_name: 'terminal' })).toBeNull()
    expect(deliveredPath({ args: { path: '/w/a.md' }, tool_name: 'read_file' })).toBeNull()
    expect(deliveredPath(null)).toBeNull()
  })

  it('keeps one row per path, newest first', () => {
    recordLiveFile({ at: 1, path: '/w/a.md', runtimeId: 'r1' })
    recordLiveFile({ at: 2, path: '/w/b.md', runtimeId: 'r1' })
    recordLiveFile({ at: 3, path: '/w/a.md', runtimeId: 'r1' })
    expect($liveFiles.get().map(f => [f.path, f.at])).toEqual([
      ['/w/a.md', 3],
      ['/w/b.md', 2]
    ])
  })

  it('shows a bot only its own files', () => {
    const files = [
      { at: 1, path: '/a', profile: 'scout', runtimeId: 'r1' },
      { at: 2, path: '/b', profile: 'other', runtimeId: 'r2' },
      { at: 3, path: '/c', runtimeId: 'r3' }
    ]

    expect(ownerLiveFiles(files, { name: 'scout' } as never, {}).map(f => f.path)).toEqual(['/a'])
    expect(ownerLiveFiles(files, null, {})).toEqual([])
  })
})

describe('scheduled tab alert', () => {
  it('flags an enabled routine whose last run failed, never a paused one', () => {
    expect(routineNeedsAttention({ enabled: true, job_id: 'a', last_status: 'error' } as never)).toBe(true)
    expect(routineNeedsAttention({ enabled: true, job_id: 'a', last_status: 'ok' } as never)).toBe(false)
    expect(routineNeedsAttention({ enabled: false, job_id: 'a', last_status: 'error' } as never)).toBe(false)
    expect(routineNeedsAttention({ job_id: 'a', last_delivery_error: 'x', state: 'paused' } as never)).toBe(false)
  })
})
