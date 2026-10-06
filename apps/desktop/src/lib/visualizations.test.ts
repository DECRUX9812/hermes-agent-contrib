import { describe, expect, it } from 'vitest'

import { visualizationFromResult } from './visualizations'

describe('visualizationFromResult', () => {
  it('extracts title and html from a JSON string result', () => {
    const result = JSON.stringify({
      success: true,
      visualization: { title: 'Test Chart', html: '<html><body>chart</body></html>' }
    })

    expect(visualizationFromResult(result)).toEqual({
      title: 'Test Chart',
      html: '<html><body>chart</body></html>'
    })
  })

  it('extracts from an already-parsed object result', () => {
    const result = { success: true, visualization: { title: 'T', html: '<div/>' } }
    expect(visualizationFromResult(result)).toEqual({ title: 'T', html: '<div/>' })
  })

  it('defaults the title when missing', () => {
    const result = JSON.stringify({ visualization: { html: '<div/>' } })
    expect(visualizationFromResult(result)?.title).toBe('Visualization')
  })

  it('returns null for non-visualization results', () => {
    expect(visualizationFromResult(null)).toBeNull()
    expect(visualizationFromResult('not json')).toBeNull()
    expect(visualizationFromResult(JSON.stringify({ success: false }))).toBeNull()
    expect(visualizationFromResult(JSON.stringify({ visualization: { title: 'T' } }))).toBeNull()
    expect(visualizationFromResult(JSON.stringify({ visualization: { html: '   ' } }))).toBeNull()
  })
})
