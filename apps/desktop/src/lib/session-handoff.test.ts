import { describe, expect, it } from 'vitest'

import type { MessagingPlatformInfo } from '@/hermes'

import { handoffTargets } from './session-handoff'

function platform(over: Partial<MessagingPlatformInfo>): MessagingPlatformInfo {
  return {
    configured: true,
    description: '',
    docs_url: '',
    enabled: true,
    env_vars: [],
    gateway_running: true,
    id: 'telegram',
    name: 'Telegram',
    ...over
  }
}

describe('handoffTargets', () => {
  it('keeps only enabled platforms with a home channel', () => {
    const targets = handoffTargets([
      platform({ id: 'telegram', name: 'Telegram' }),
      platform({ home_channel: { chat_id: '1', name: 'home', platform: 'slack' }, id: 'slack', name: 'Slack' }),
      platform({ enabled: false, home_channel: { chat_id: '1', name: 'home', platform: 'discord' }, id: 'discord', name: 'Discord' }),
      platform({ home_channel: { chat_id: '', name: '', platform: 'signal' }, id: 'signal', name: 'Signal' })
    ])

    expect(targets.map(p => p.id)).toEqual(['slack'])
  })

  it('leads with identity-published platforms, then sorts by name', () => {
    const home = { chat_id: '1', name: 'home', platform: 'test' }

    const targets = handoffTargets([
      platform({ home_channel: home, id: 'signal', name: 'Signal' }),
      platform({ home_channel: home, id: 'discord', name: 'Discord' }),
      platform({ home_channel: home, id: 'telegram', identity: { deep_link: 'https://t.me/bot' }, name: 'Telegram' }),
      platform({ home_channel: home, id: 'slack', identity: { deep_link: 'slack://user' }, name: 'Slack' })
    ])

    expect(targets.map(p => p.id)).toEqual(['slack', 'telegram', 'discord', 'signal'])
  })
})
