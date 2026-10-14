import { describe, expect, it } from 'vitest'

import { cn } from './utils'

describe('cn with the design tokens', () => {
  it('keeps a token font size next to a token text colour', () => {
    expect(cn('text-ui-sm', 'text-fg-muted')).toBe('text-ui-sm text-fg-muted')
  })

  it('lets a later size, radius or shadow override a token one', () => {
    expect(cn('text-ui-sm', 'text-xs')).toBe('text-xs')
    expect(cn('rounded-row', 'rounded-card')).toBe('rounded-card')
    expect(cn('shadow-e1', 'shadow-e3')).toBe('shadow-e3')
  })
})
