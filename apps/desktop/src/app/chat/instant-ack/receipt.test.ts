import { describe, expect, it } from 'vitest'

import { RECEIPT_MAX_WORDS, receiptFromPrompt } from './receipt'

describe('receiptFromPrompt', () => {
  it('restates the ask in the user’s own words', () => {
    expect(receiptFromPrompt('rework the pricing page copy')).toEqual({ kind: 'prompt', text: 'rework the pricing page copy' })
  })

  it('caps the restatement at a glanceable number of words', () => {
    const receipt = receiptFromPrompt(
      'rewrite the whole onboarding flow and the empty state and every tooltip that mentions pricing while you are in there'
    )

    expect(receipt?.text.split(' ')).toHaveLength(RECEIPT_MAX_WORDS)
  })

  it('drops fenced code, which is never the point of the ask', () => {
    const receipt = receiptFromPrompt('fix this\n```ts\nconst a = 1\n```\nplease')

    expect(receipt?.text).toBe('fix this please')
  })

  it('keeps a markdown link’s label but not its URL', () => {
    expect(receiptFromPrompt('summarise [the RFC](https://example.com/rfc-123)')).toEqual({
      kind: 'prompt',
      text: 'summarise the RFC'
    })
  })

  it('drops bare URLs, paths and @refs', () => {
    expect(receiptFromPrompt('@apps/desktop/ open https://example.com/x and fix ~/Code/app/main.ts')).toEqual({
      kind: 'prompt',
      text: 'open and fix'
    })
  })

  it('strips list markers and heading hashes so the line starts on a word', () => {
    expect(receiptFromPrompt('### - [ ] fix the sidebar')).toEqual({ kind: 'prompt', text: 'fix the sidebar' })
  })

  it('collapses whitespace so a pasted table cannot break the line', () => {
    expect(receiptFromPrompt('  fix\n\n the   sidebar\tnow  ')).toEqual({ kind: 'prompt', text: 'fix the sidebar now' })
  })

  it('trims trailing punctuation before the caller appends its own copy', () => {
    expect(receiptFromPrompt('is the tunnel exposed?')).toEqual({ kind: 'prompt', text: 'is the tunnel exposed' })
  })

  it('names a slash command as the command rather than restating its arguments', () => {
    expect(receiptFromPrompt('/compress now please')).toEqual({ kind: 'command', text: '/compress' })
  })

  it('arms nothing when there is no honest restatement', () => {
    expect(receiptFromPrompt('')).toBeNull()
    expect(receiptFromPrompt('   \n  ')).toBeNull()
    expect(receiptFromPrompt('https://example.com/only-a-url')).toBeNull()
  })

  it('arms nothing for an attachment-only send', () => {
    expect(receiptFromPrompt('@apps/desktop/src/index.ts')).toBeNull()
  })
})
