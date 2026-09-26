import { beforeEach, describe, expect, it } from 'vitest'

import { $selectedStoredSessionId } from '@/store/session'

import {
  $transcriptSearchJumps,
  armTranscriptSearchJump,
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
