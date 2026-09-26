import { describe, expect, it } from 'vitest'

import type { HermesBranchPullRequest } from '@/global'
import { TRANSLATIONS } from '@/i18n/catalog'

import { prTipLabel } from './pr-tag'

const PR: HermesBranchPullRequest = {
  branch: 'feature/x',
  draft: false,
  number: 42,
  state: 'open',
  title: 'Do the thing',
  url: 'https://github.com/o/r/pull/42'
}

describe('prTipLabel', () => {
  it('shows number and title when the head commit has no check rollup', () => {
    expect(prTipLabel(PR, TRANSLATIONS.en)).toBe('#42 Do the thing')
  })

  it.each([
    ['success', TRANSLATIONS.en.sidebar.row.prCiPassing],
    ['failure', TRANSLATIONS.en.sidebar.row.prCiFailing],
    ['pending', TRANSLATIONS.en.sidebar.row.prCiPending]
  ] as const)('appends the localized rollup for %s', (checks, label) => {
    expect(prTipLabel({ ...PR, checks }, TRANSLATIONS.en)).toBe(`#42 Do the thing · ${label}`)
  })
})
