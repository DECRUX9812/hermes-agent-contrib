import { beforeEach, describe, expect, it } from 'vitest'

import { $selectedStoredSessionId } from '@/store/session'

import {
  $transcriptSearchJumps,
  armTranscriptReplayJump,
  armTranscriptSearchJump,
  locateTranscriptReplayRow,
  locateTranscriptSearchHit,
  resetTranscriptFindForTest,
  searchTranscriptRows,
  takeTranscriptSearchJump,
  TRANSCRIPT_FIND_MATCH_LIMIT,
  type TranscriptFindRow,
  transcriptFindTarget
} from './transcript-find'

const row = (rowId: number, text: string): TranscriptFindRow => ({ rowId, text })

const jumpRows: TranscriptFindRow[] = [
  { rowId: 1, role: 'user', text: 'How do I deploy the staging build?' },
  { rowId: 2, role: 'assistant', text: 'Run the deploy script with --staging.' },
  { rowId: 3, role: 'user', text: 'It failed with a checksum mismatch.' },
  { rowId: 4, role: 'assistant', text: 'The deploy artifact was stale; rebuild it.' }
]

beforeEach(() => {
  document.body.innerHTML = ''
  resetTranscriptFindForTest()
})

describe('searchTranscriptRows', () => {
  it('matches case-insensitively and counts every occurrence per row', () => {
    const rows = [row(1, 'Deploy the HERMES build'), row(2, 'hermes hermes'), row(3, 'unrelated')]

    const { matches, capped } = searchTranscriptRows(rows, 'hermes')

    expect(capped).toBe(false)
    expect(matches).toEqual([
      { rowId: 1, occurrence: 0 },
      { rowId: 2, occurrence: 0 },
      { rowId: 2, occurrence: 1 }
    ])
  })

  it('orders matches chronologically by corpus order, not by hit density', () => {
    const rows = [row(5, 'a needle'), row(9, 'needle needle')]

    expect(searchTranscriptRows(rows, 'needle').matches.map(m => m.rowId)).toEqual([5, 9, 9])
  })

  it('returns nothing for an empty or blank query', () => {
    expect(searchTranscriptRows([row(1, 'needle')], '   ').matches).toEqual([])
  })

  it('caps the match list and reports the cap', () => {
    const rows = [row(1, 'x '.repeat(TRANSCRIPT_FIND_MATCH_LIMIT + 10))]

    const { matches, capped } = searchTranscriptRows(rows, 'x')

    expect(capped).toBe(true)
    expect(matches.length).toBe(TRANSCRIPT_FIND_MATCH_LIMIT)
  })
})

describe('transcriptFindTarget', () => {
  it('resolves the primary surface to the selected stored session', () => {
    $selectedStoredSessionId.set('session-abc')
    const root = document.createElement('div')
    root.setAttribute('data-session-anchor', 'workspace')

    const target = transcriptFindTarget(root)

    expect(target?.storedId).toBe('session-abc')
    expect(target?.scope).toBeTruthy()
  })

  it('resolves a tile surface to its own session id', () => {
    const root = document.createElement('div')
    root.setAttribute('data-session-anchor', 'session-tile:tile-42')

    expect(transcriptFindTarget(root)?.storedId).toBe('tile-42')
  })

  it('returns null without an anchor or without a stored session', () => {
    expect(transcriptFindTarget(document.createElement('div'))).toBeNull()

    $selectedStoredSessionId.set(null)
    const root = document.createElement('div')
    root.setAttribute('data-session-anchor', 'workspace')

    expect(transcriptFindTarget(root)).toBeNull()
  })
})

describe('transcript search jumps', () => {
  it('arms a jump stamped with issuedAt and takes it once', () => {
    armTranscriptSearchJump('sess-1', { query: 'deploy', snippet: 'Run the >>>deploy<<< script' })

    const armed = $transcriptSearchJumps.get()['sess-1']
    expect(armed?.query).toBe('deploy')
    expect(armed?.issuedAt).toBeGreaterThan(0)

    const taken = takeTranscriptSearchJump('sess-1')
    expect(taken?.snippet).toBe('Run the >>>deploy<<< script')
    expect($transcriptSearchJumps.get()).toEqual({})
    expect(takeTranscriptSearchJump('sess-1')).toBeNull()
  })

  it('scopes jumps by stored id — one session consuming does not take another', () => {
    armTranscriptSearchJump('sess-1', { query: 'a', snippet: '>>>a<<<' })
    armTranscriptSearchJump('sess-2', { query: 'b', snippet: '>>>b<<<' })

    takeTranscriptSearchJump('sess-1')

    expect($transcriptSearchJumps.get()['sess-1']).toBeUndefined()
    expect($transcriptSearchJumps.get()['sess-2']?.query).toBe('b')
  })

  it('re-arms the same session on a later click', () => {
    armTranscriptSearchJump('sess-1', { query: 'first', snippet: '>>>first<<<' })
    armTranscriptSearchJump('sess-1', { query: 'second', snippet: '>>>second<<<' })

    expect(takeTranscriptSearchJump('sess-1')?.query).toBe('second')
  })
})

describe('locateTranscriptSearchHit', () => {
  it('resolves the row containing the marked terms', () => {
    const hit = locateTranscriptSearchHit(jumpRows, {
      query: 'checksum',
      snippet: 'It failed with a >>>checksum<<< mismatch.'
    })

    expect(hit?.rowId).toBe(3)
    expect(hit?.role).toBe('user')
  })

  it('picks the row holding the most marked terms', () => {
    const hit = locateTranscriptSearchHit(jumpRows, {
      query: 'deploy stale',
      snippet: '...the >>>deploy<<< artifact was >>>stale<<<...'
    })

    expect(hit?.rowId).toBe(4)
  })

  it('falls back to a query substring when the snippet has no markers', () => {
    const hit = locateTranscriptSearchHit(jumpRows, { query: 'checksum', snippet: 'no markers here' })

    expect(hit?.rowId).toBe(3)
  })

  it('returns null when nothing matches', () => {
    expect(locateTranscriptSearchHit(jumpRows, { query: 'nope', snippet: '>>>nope<<<' })).toBeNull()
  })
})

describe('armTranscriptReplayJump', () => {
  it('arms a replay jump keyed by stored id and consumed once', () => {
    armTranscriptReplayJump('sess-9', 1_700_000_000_000)

    const armed = $transcriptSearchJumps.get()['sess-9']
    expect(armed?.atMs).toBe(1_700_000_000_000)
    expect(armed?.issuedAt).toBeGreaterThan(0)

    const taken = takeTranscriptSearchJump('sess-9')
    expect(taken?.atMs).toBe(1_700_000_000_000)
    expect(takeTranscriptSearchJump('sess-9')).toBeNull()
  })

  it('does not clobber a search jump armed for another session', () => {
    armTranscriptSearchJump('sess-1', { query: 'a', snippet: '>>>a<<<' })
    armTranscriptReplayJump('sess-2', 1_000)

    expect(takeTranscriptSearchJump('sess-1')?.query).toBe('a')
    expect(takeTranscriptSearchJump('sess-2')?.atMs).toBe(1_000)
  })
})

describe('locateTranscriptReplayRow', () => {
  const stamped: TranscriptFindRow[] = [
    { rowId: 10, role: 'user', text: 'first', timestamp: 1_000 },
    { rowId: 11, role: 'assistant', text: 'one', timestamp: 1_500 },
    { rowId: 12, role: 'user', text: 'second', timestamp: 2_000 },
    { rowId: 13, role: 'assistant', text: 'two', timestamp: 2_500 },
    { rowId: 14, role: 'user', text: 'third', timestamp: 3_000 }
  ]

  it('returns the last stamped row at-or-before the target instant', () => {
    expect(locateTranscriptReplayRow(stamped, 2_500)?.rowId).toBe(13)
  })

  it('lands inside a turn when the instant sits between stamps', () => {
    expect(locateTranscriptReplayRow(stamped, 2_200)?.rowId).toBe(12)
  })

  it('returns the first stamped row when the instant predates the corpus', () => {
    expect(locateTranscriptReplayRow(stamped, 500)?.rowId).toBe(10)
  })

  it('returns the last stamped row when the instant postdates the corpus', () => {
    expect(locateTranscriptReplayRow(stamped, 9_999)?.rowId).toBe(14)
  })

  it('skips rows that carry no timestamp', () => {
    const rows: TranscriptFindRow[] = [
      { rowId: 1, role: 'user', text: 'a', timestamp: 100 },
      { rowId: 2, role: 'assistant', text: 'unstamped' },
      { rowId: 3, role: 'user', text: 'b', timestamp: 400 }
    ]

    expect(locateTranscriptReplayRow(rows, 300)?.rowId).toBe(1)
  })

  it('returns null when no row carries a timestamp or the corpus is empty', () => {
    expect(locateTranscriptReplayRow([row(1, 'a'), row(2, 'b')], 100)).toBeNull()
    expect(locateTranscriptReplayRow([], 100)).toBeNull()
  })
})
