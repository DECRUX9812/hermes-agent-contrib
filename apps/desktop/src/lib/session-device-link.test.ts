import { describe, expect, it } from 'vitest'

import type { DesktopRegistryConnection } from '@/global'

import {
  buildSessionOpenLink,
  normalizeLinkAddress,
  resolveSessionOpenLinkConnection
} from './session-device-link'

const remote = (overrides: Partial<DesktopRegistryConnection> = {}): DesktopRegistryConnection => ({
  id: 'conn-remote',
  kind: 'remote',
  label: 'Homelab',
  url: 'https://gateway.example.com',
  tokenSet: true,
  tokenPreview: null,
  installId: 'install-abc',
  ...overrides
})

const ssh = (overrides: Partial<DesktopRegistryConnection> = {}): DesktopRegistryConnection => ({
  id: 'conn-ssh',
  kind: 'ssh',
  label: 'Rack',
  host: 'box.internal',
  user: 'me',
  port: 2222,
  tokenSet: false,
  tokenPreview: null,
  ...overrides
})

const local = (overrides: Partial<DesktopRegistryConnection> = {}): DesktopRegistryConnection => ({
  id: 'conn-local',
  kind: 'local',
  label: 'This Mac',
  tokenSet: false,
  tokenPreview: null,
  ...overrides
})

const registry = (...connections: DesktopRegistryConnection[]) => ({
  version: 1,
  primary: connections[0]?.id ?? '',
  secureTokenStorage: true,
  connections
})

describe('buildSessionOpenLink', () => {
  it('carries id, profile, title, install id, kind, and endpoint', () => {
    const link = buildSessionOpenLink({ id: 's1', profile: 'work', title: 'Fix the flaky test' }, remote())
    const url = new URL(link)

    expect(url.protocol).toBe('hermes:')
    expect(url.hostname).toBe('session')
    expect(url.pathname).toBe('/open')
    expect(url.searchParams.get('id')).toBe('s1')
    expect(url.searchParams.get('profile')).toBe('work')
    expect(url.searchParams.get('title')).toBe('Fix the flaky test')
    expect(url.searchParams.get('install')).toBe('install-abc')
    expect(url.searchParams.get('kind')).toBe('remote')
    expect(url.searchParams.get('addr')).toBe('https://gateway.example.com')
  })

  it('encodes the ssh authority as the address and omits empty fields', () => {
    const link = buildSessionOpenLink({ id: 's1' }, ssh())
    const url = new URL(link)

    expect(url.searchParams.get('addr')).toBe('me@box.internal:2222')
    expect(url.searchParams.get('profile')).toBeNull()
    expect(url.searchParams.get('install')).toBeNull()
  })

  it('never carries credentials — tokens/headers are absent by construction', () => {
    const link = buildSessionOpenLink({ id: 's1' }, remote({ headerNames: ['cf-access'] }))

    expect(link).not.toContain('cf-access')
    expect(link).not.toContain('token')
  })

  it('still links a local session (no endpoint)', () => {
    const link = buildSessionOpenLink({ id: 's1', profile: 'default' }, local())

    expect(link).toContain('kind=local')
    expect(link).not.toContain('addr=')
  })
})

describe('resolveSessionOpenLinkConnection', () => {
  it('prefers the install_id fingerprint across different addresses', () => {
    // Same physical backend registered twice under different addresses.
    const viaLan = remote({ id: 'lan', url: 'http://192.168.1.10:8642' })
    const viaTunnel = remote({ id: 'tunnel', url: 'https://tunnel.example.com' })

    expect(resolveSessionOpenLinkConnection(registry(viaLan, viaTunnel), { id: 's1', install: 'install-abc' })?.id).toBe(
      'lan'
    )
  })

  it('falls back to a same-kind endpoint match', () => {
    const match = resolveSessionOpenLinkConnection(registry(remote({ installId: undefined })), {
      id: 's1',
      kind: 'remote',
      addr: 'https://gateway.example.com/'
    })

    expect(match?.id).toBe('conn-remote')
  })

  it('matches ssh connections by user@host:port', () => {
    const match = resolveSessionOpenLinkConnection(registry(ssh()), {
      id: 's1',
      kind: 'ssh',
      addr: 'ME@box.internal:2222'
    })

    expect(match?.id).toBe('conn-ssh')
  })

  it('maps a local link onto the local connection', () => {
    expect(resolveSessionOpenLinkConnection(registry(remote(), local()), { id: 's1', kind: 'local' })?.id).toBe(
      'conn-local'
    )
  })

  it('returns undefined when nothing reaches the home backend', () => {
    expect(
      resolveSessionOpenLinkConnection(registry(remote({ url: 'https://other.example.com' })), {
        id: 's1',
        kind: 'remote',
        addr: 'https://gateway.example.com'
      })
    ).toBeUndefined()

    expect(resolveSessionOpenLinkConnection(undefined, { id: 's1' })).toBeUndefined()
    expect(resolveSessionOpenLinkConnection(registry(), { id: 's1' })).toBeUndefined()
  })

  it('does not let a different kind claim the address', () => {
    // An ssh authority string must not match a remote url field.
    expect(
      resolveSessionOpenLinkConnection(registry(remote({ url: 'me@box.internal:2222' })), {
        id: 's1',
        kind: 'ssh',
        addr: 'me@box.internal:2222'
      })
    ).toBeUndefined()
  })
})

describe('normalizeLinkAddress', () => {
  it('lowercases and strips a trailing URL slash', () => {
    expect(normalizeLinkAddress(' HTTPS://Example.COM/ ')).toBe('https://example.com')
    expect(normalizeLinkAddress('me@box:22')).toBe('me@box:22')
  })
})
