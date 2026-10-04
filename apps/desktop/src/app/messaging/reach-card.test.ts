/**
 * A bot's reach card offers a QR only for addresses a phone can actually
 * open: an enabled platform whose adapter published a link. Anything else
 * falls through to setup rather than a code that goes nowhere.
 */

import { describe, expect, it } from 'vitest'

import type { MessagingPlatformInfo } from '@/hermes'

import { reachTargets } from './reach-card'

const platform = (id: string, extra: Partial<MessagingPlatformInfo> = {}) =>
  ({ enabled: true, id, name: id.toUpperCase(), ...extra }) as MessagingPlatformInfo

describe('reachTargets', () => {
  it('keeps only enabled platforms that published a link, preferring a scannable https link', () => {
    const targets = reachTargets([
      platform('telegram', { identity: { deep_link: 'https://t.me/atlas_bot' } as never }),
      platform('slack', { identity: { deep_link: 'slack://app?id=1', web_link: 'https://acme.slack.com/app' } as never }),
      platform('discord', { enabled: false, identity: { deep_link: 'https://discord.com/x' } as never }),
      platform('telegram-pending', { id: 'telegram' })
    ])

    expect(targets).toEqual([
      { id: 'telegram', name: 'TELEGRAM', openLink: 'https://t.me/atlas_bot', qrLink: 'https://t.me/atlas_bot' },
      { id: 'slack', name: 'SLACK', openLink: 'slack://app?id=1', qrLink: 'https://acme.slack.com/app' }
    ])
  })
})
