import { describe, expect, it } from 'vitest'

import { $selfReview, parseSelfReviewResponse, selfReviewForFile } from './self-review'

describe('parseSelfReviewResponse', () => {
  it('parses a plain JSON array of comments', () => {
    const text = JSON.stringify([
      { body: 'null deref here', line: 12, path: 'src/a.ts' },
      { body: 'off by one', line: 3, path: 'src/b.ts' }
    ])

    expect(parseSelfReviewResponse(text)).toEqual([
      { body: 'null deref here', line: 12, path: 'src/a.ts' },
      { body: 'off by one', line: 3, path: 'src/b.ts' }
    ])
  })

  it('skips fences/prologue and keeps only well-shaped rows', () => {
    const text = '```json\n[{"path":"a.ts","line":5,"body":"ok"},{"path":"b.ts"},{"line":9,"body":"no path"},null]\n```'

    expect(parseSelfReviewResponse(text)).toEqual([{ body: 'ok', line: 5, path: 'a.ts' }])
  })

  it('collapses whitespace and clamps a bogus line number to 1', () => {
    const [comment] = parseSelfReviewResponse('[{"path":"a.ts","line":-4,"body":"multi\\n line  text"}]')

    expect(comment.body).toBe('multi line text')
    expect(comment.line).toBe(1)
  })

  it('returns [] for non-array or unparseable output', () => {
    expect(parseSelfReviewResponse('')).toEqual([])
    expect(parseSelfReviewResponse('no issues found')).toEqual([])
    expect(parseSelfReviewResponse('{"not":"an array"}')).toEqual([])
    expect(parseSelfReviewResponse('[{broken json')).toEqual([])
  })
})

describe('selfReviewForFile', () => {
  it('serves comments only while the shown diff is the reviewed one', () => {
    const comments = [{ body: 'x', line: 1, path: 'a.ts' }]

    $selfReview.set({ error: null, files: { 'a.ts': { comments, diff: 'DIFF-A' } }, status: 'done' })

    expect(selfReviewForFile('a.ts', 'DIFF-A')).toEqual(comments)
    // A refresh that changed the file hides stale anchors instead of
    // misplacing them on a different diff.
    expect(selfReviewForFile('a.ts', 'DIFF-A2')).toEqual([])
    expect(selfReviewForFile('a.ts', null)).toEqual([])
    expect(selfReviewForFile('missing.ts', 'DIFF-A')).toEqual([])
  })
})
