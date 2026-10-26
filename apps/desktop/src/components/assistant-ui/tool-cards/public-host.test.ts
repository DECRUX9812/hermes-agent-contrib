import { describe, expect, it } from 'vitest'

import { isPublicHost } from './public-host'

describe('isPublicHost', () => {
  it('rejects empty and local names', () => {
    expect(isPublicHost('')).toBe(false)
    expect(isPublicHost('   ')).toBe(false)
    expect(isPublicHost('localhost')).toBe(false)
    expect(isPublicHost('LOCALHOST')).toBe(false)
    expect(isPublicHost('app.localhost')).toBe(false)
    expect(isPublicHost('printer.local')).toBe(false)
    expect(isPublicHost('db.internal')).toBe(false)
    expect(isPublicHost('nas.lan')).toBe(false)
    expect(isPublicHost('router.home.arpa')).toBe(false)
  })

  it('rejects single-label names and IP literals', () => {
    expect(isPublicHost('intranet')).toBe(false)
    expect(isPublicHost('127.0.0.1')).toBe(false)
    expect(isPublicHost('192.168.1.10')).toBe(false)
    expect(isPublicHost('::1')).toBe(false)
    expect(isPublicHost('[::1]')).toBe(false)
    expect(isPublicHost('[2001:db8::1]')).toBe(false)
    expect(isPublicHost('fe80::1')).toBe(false)
  })

  it('accepts ordinary public hosts', () => {
    expect(isPublicHost('example.com')).toBe(true)
    expect(isPublicHost('Example.COM.')).toBe(true)
    expect(isPublicHost('  docs.example.com  ')).toBe(true)
    expect(isPublicHost('notlocal')).toBe(false)
    expect(isPublicHost('localhosted.com')).toBe(true)
  })
})
