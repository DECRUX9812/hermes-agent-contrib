import { describe, expect, it } from 'vitest'

import type { MessagingPlatformInfo } from '@/types/hermes'

import { hasPhoneParity, parityLinks } from './phone-parity'

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

describe('parityLinks', () => {
  it('uses the deep link for both Open and QR when it is an https link', () => {
    const p = platform({
      identity: { deep_link: 'https://t.me/hermes_bot', label: '@hermes_bot' }
    })

    expect(parityLinks(p)).toEqual({
      openLink: 'https://t.me/hermes_bot',
      qrLink: 'https://t.me/hermes_bot'
    })
  })

  it('QRs the https web link while Open takes the slack:// deep link', () => {
    const p = platform({
      id: 'slack',
      identity: {
        bot_user_id: 'U123',
        deep_link: 'slack://user?team=T1&id=U123',
        web_link: 'https://acme.slack.com/'
      },
      name: 'Slack'
    })

    expect(parityLinks(p)).toEqual({
      openLink: 'slack://user?team=T1&id=U123',
      qrLink: 'https://acme.slack.com/'
    })
  })

  it('falls back to the web link for Open when no deep link exists', () => {
    const p = platform({ identity: { web_link: 'https://acme.slack.com/' } })

    expect(parityLinks(p).openLink).toBe('https://acme.slack.com/')
  })

  it('returns empty links when the adapter has not published an identity', () => {
    expect(parityLinks(platform({}))).toEqual({ openLink: '', qrLink: '' })
  })
})

describe('hasPhoneParity', () => {
  it('is false for a disabled platform even when it carries an identity', () => {
    expect(hasPhoneParity(platform({ enabled: false, identity: { deep_link: 'https://t.me/x' } }))).toBe(false)
  })

  it('is true for telegram and slack even before identity arrives', () => {
    expect(hasPhoneParity(platform({}))).toBe(true)
    expect(hasPhoneParity(platform({ id: 'slack', name: 'Slack' }))).toBe(true)
  })

  it('is true for any enabled platform once it publishes an identity', () => {
    expect(hasPhoneParity(platform({ id: 'discord', identity: { label: 'bot' }, name: 'Discord' }))).toBe(true)
  })

  it('is false for other enabled platforms without an identity', () => {
    expect(hasPhoneParity(platform({ id: 'discord', name: 'Discord' }))).toBe(false)
  })
})
