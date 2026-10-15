import { describe, expect, it } from 'vitest'

import { browserStepSnapshotKey, browserStepThumbnailKey, browserThumbnailSource } from './browser-step-resource'

describe('browser step resources', () => {
  it('keeps browser queries scoped to the profile, session, and tool call', () => {
    const step = {
      owner: { connectionId: 'remote-1', profile: 'default', targetProfile: 'research' },
      sessionId: 'session-1',
      toolCallId: 'call-1'
    }

    expect(browserStepThumbnailKey(step)).not.toEqual(
      browserStepThumbnailKey({ ...step, owner: { ...step.owner, connectionId: 'remote-2' } })
    )
    expect(browserStepSnapshotKey(step)).not.toEqual(browserStepSnapshotKey({ ...step, sessionId: 'session-2' }))
    expect(browserStepThumbnailKey(step)).not.toEqual(browserStepThumbnailKey({ ...step, toolCallId: 'call-2' }))
  })

  it('uses a persisted image when found and falls back when missing or too large', () => {
    const fallback = 'data:image/webp;base64,local-capture'

    expect(
      browserThumbnailSource({ found: true, data_base64: 'persisted', mime: 'image/png' })
    ).toBe('data:image/png;base64,persisted')
    expect(browserThumbnailSource({ found: true, data_base64: 'persisted' })).toBe(
      'data:image/png;base64,persisted'
    )
    expect(browserThumbnailSource({ found: false, reason: 'too_large' }, fallback)).toBe(fallback)
    expect(browserThumbnailSource({ found: false, reason: 'not_found' })).toBeUndefined()
  })
})
