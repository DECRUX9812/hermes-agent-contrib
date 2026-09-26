import { beforeEach, describe, expect, it } from 'vitest'

import { $selectedStoredSessionId } from '@/store/session'

import {
  resetTranscriptFindForTest,
  searchTranscriptRows,
  TRANSCRIPT_FIND_MATCH_LIMIT,
  type TranscriptFindRow,
  transcriptFindTarget
} from './transcript-find'

const row = (rowId: number, text: string): TranscriptFindRow => ({ rowId, text })

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
