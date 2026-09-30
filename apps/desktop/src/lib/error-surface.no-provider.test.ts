import { describe, expect, it } from 'vitest'

import { TRANSLATIONS } from '@/i18n/catalog'
import { en } from '@/i18n/en'

import { ERROR_CODE_KEYS, errorRecoveryPlan } from './error-surface'
import { errorCardText } from './error-surface-copy'

const surface = { code: 'no_provider_configured', layer: 'auth', retryable: false } as const

describe('no_provider_configured', () => {
  it('has copy in every locale (falling back to English where a locale defers)', () => {
    expect(ERROR_CODE_KEYS).toContain('no_provider_configured')

    for (const [locale, t] of Object.entries(TRANSLATIONS)) {
      const card = errorCardText(t.assistant.thread, surface)
      expect(card?.title, locale).toBeTruthy()
      expect(card?.body, locale).toBeTruthy()
    }

    expect(errorCardText(en.assistant.thread, surface)?.title).not.toMatch(/hermes setup|terminal/i)
  })

  it('offers exactly one fix — choose a model — and never a retry or a second provider button', () => {
    const plan = errorRecoveryPlan(surface)
    expect(plan).toMatchObject({ chooseModel: true, retry: false, switchProvider: false })
  })
})
