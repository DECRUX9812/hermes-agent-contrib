import { beforeEach, describe, expect, it } from 'vitest'

import {
  $transcriptSearchJumps,
  armTranscriptSearchJump,
  locateTranscriptSearchHit,
  resetTranscriptFindForTest,
  searchTranscriptRows,
  takeTranscriptSearchJump,
  type TranscriptFindRow
} from './transcript-find'

const rows: TranscriptFindRow[] = [
  { rowId: 1, role: 'user', text: 'How do I deploy the staging build?' },
  { rowId: 2, role: 'assistant', text: 'Run the deploy script with --staging.' },
  { rowId: 3, role: 'user', text: 'It failed with a checksum mismatch.' },
  { rowId: 4, role: 'assistant', text: 'The deploy artifact was stale; rebuild it.' }
]

beforeEach(() => {
  resetTranscriptFindForTest()
})

describe('searchTranscriptRows', () => {
  it('finds case-insensitive matches with occurrence indexes', () => {
    const { capped, matches } = searchTranscriptRows(rows, 'deploy')

    expect(capped).toBe(false)
    expect(matches).toEqual([
      { rowId: 1, occurrence: 0 },
      { rowId: 2, occurrence: 0 },
      { rowId: 4, occurrence: 0 }
    ])
  })

  it('returns no matches for a blank query', () => {
    expect(searchTranscriptRows(rows, '  ').matches).toEqual([])
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
    const hit = locateTranscriptSearchHit(rows, {
      query: 'checksum',
      snippet: 'It failed with a >>>checksum<<< mismatch.'
    })

    expect(hit?.rowId).toBe(3)
    expect(hit?.role).toBe('user')
  })

  it('picks the row holding the most marked terms', () => {
    const hit = locateTranscriptSearchHit(rows, {
      query: 'deploy stale',
      snippet: '...the >>>deploy<<< artifact was >>>stale<<<...'
    })

    expect(hit?.rowId).toBe(4)
  })

  it('falls back to a query substring when the snippet has no markers', () => {
    const hit = locateTranscriptSearchHit(rows, { query: 'checksum', snippet: 'no markers here' })

    expect(hit?.rowId).toBe(3)
  })

  it('returns null when nothing matches', () => {
    expect(locateTranscriptSearchHit(rows, { query: 'nope', snippet: '>>>nope<<<' })).toBeNull()
  })
})
