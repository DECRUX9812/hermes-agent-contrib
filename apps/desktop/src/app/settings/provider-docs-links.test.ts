import { describe, expect, it } from 'vitest'

import { PROVIDER_GROUPS } from './constants'

describe('provider docs links', () => {
  it('points LM Studio at its current local-server docs page', () => {
    const lmStudio = PROVIDER_GROUPS.find(group => group.name === 'LM Studio')

    // https://lmstudio.ai/docs/local-server now returns 404.
    expect(lmStudio?.docsUrl).toBe('https://lmstudio.ai/docs/developer/core/server')
  })
})
