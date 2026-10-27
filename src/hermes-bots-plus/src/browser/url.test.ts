import { describe, expect, it } from 'vitest'

import { addressLabel, isAuthUrl, isLoopbackUrl, normalizeAddress, SEARCH_URL } from './url'

describe('Hermes Browser addresses', () => {
  it('keeps full URLs and adds the right scheme to bare hosts', () => {
    expect(normalizeAddress('https://example.com/a')).toBe('https://example.com/a')
    expect(normalizeAddress('example.com')).toBe('https://example.com')
    expect(normalizeAddress('localhost:5173')).toBe('http://localhost:5173')
    expect(normalizeAddress('127.0.0.1:8000/x')).toBe('http://127.0.0.1:8000/x')
    expect(normalizeAddress('app.test/home')).toBe('http://app.test/home')
  })

  it('turns everything else into a search', () => {
    expect(normalizeAddress('how to center a div')).toBe(`${SEARCH_URL}how%20to%20center%20a%20div`)
    expect(normalizeAddress('   ')).toBe('')
  })

  it('knows loopback and sign-in pages', () => {
    expect(isLoopbackUrl('http://localhost:5173/')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:3000/')).toBe(true)
    expect(isLoopbackUrl('https://example.com')).toBe(false)
    expect(isAuthUrl('https://github.com/login/oauth/authorize?x=1')).toBe(true)
    expect(isAuthUrl('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true)
    expect(isAuthUrl('https://example.com/blog/login-tips')).toBe(false)
  })

  it('labels addresses compactly', () => {
    expect(addressLabel('https://www.example.com/')).toBe('example.com')
    expect(addressLabel('http://localhost:5173/docs/')).toBe('localhost:5173/docs')
  })
})
