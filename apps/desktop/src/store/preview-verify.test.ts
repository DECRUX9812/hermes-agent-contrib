import { beforeEach, describe, expect, it } from 'vitest'

import {
  $previewVerifyBySession,
  dismissPreviewVerify,
  recordPreviewVerifyResult,
  recordPreviewVerifyRunning
} from './preview-verify'

describe('preview-verify store', () => {
  beforeEach(() => {
    $previewVerifyBySession.set({})
  })

  it('records a running row, then the verdict under the same session', () => {
    recordPreviewVerifyRunning('s1')
    expect($previewVerifyBySession.get().s1?.running).toBe(true)

    recordPreviewVerifyResult('s1', {
      errorCount: 2,
      firstError: 'boom',
      ok: false,
      tabId: 't1',
      url: 'http://localhost:5174'
    })
    const record = $previewVerifyBySession.get().s1

    expect(record?.running).toBe(false)
    expect(record?.ok).toBe(false)
    expect(record?.errorCount).toBe(2)
    expect(record?.firstError).toBe('boom')
  })

  it('scopes rows per session and dismisses only its own', () => {
    recordPreviewVerifyResult('s1', { errorCount: 0, ok: true })
    recordPreviewVerifyResult('s2', { errorCount: 1, ok: false })

    dismissPreviewVerify('s1')
    const map = $previewVerifyBySession.get()

    expect(map.s1).toBeUndefined()
    expect(map.s2?.ok).toBe(false)
  })

  it('ignores empty session ids', () => {
    recordPreviewVerifyRunning('')
    recordPreviewVerifyResult('', { errorCount: 0, ok: true })
    expect($previewVerifyBySession.get()).toEqual({})
  })
})
