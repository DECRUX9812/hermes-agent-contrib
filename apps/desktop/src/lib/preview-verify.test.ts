import { describe, expect, it } from 'vitest'

import type { ConsoleEntry } from '@/app/chat/right-rail/preview-console-state'

import { verifyResultFromLogs } from './preview-verify'

const entry = (level: number, message = 'msg'): ConsoleEntry => ({ id: 0, level, message })

describe('verifyResultFromLogs', () => {
  it('passes on an empty log and on warnings only', () => {
    expect(verifyResultFromLogs('t1', 'http://localhost:5174', 'App', []).ok).toBe(true)
    const warnings = verifyResultFromLogs('t1', 'http://localhost:5174', 'App', [entry(2), entry(1)])

    expect(warnings.ok).toBe(true)
    expect(warnings.warningCount).toBe(1)
    expect(warnings.errorCount).toBe(0)
  })

  it('fails on any level-3 entry and reports the errors it found', () => {
    const logs = [entry(1), entry(3, 'boom'), entry(2), entry(4, 'fatal')]
    const result = verifyResultFromLogs('t1', 'http://localhost:5174', 'App', logs)

    expect(result.ok).toBe(false)
    expect(result.errorCount).toBe(2)
    expect(result.errors.map(error => error.message)).toEqual(['boom', 'fatal'])
    expect(result.warningCount).toBe(1)
    expect(result.tabId).toBe('t1')
    expect(result.url).toBe('http://localhost:5174')
  })

  it('caps the error list but keeps the true count', () => {
    const logs = Array.from({ length: 25 }, (_, i) => entry(3, `e${i}`))
    const result = verifyResultFromLogs('t1', 'u', 't', logs)

    expect(result.errorCount).toBe(25)
    expect(result.errors.length).toBe(20)
  })
})
