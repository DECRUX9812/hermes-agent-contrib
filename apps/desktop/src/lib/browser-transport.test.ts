import { describe, expect, it } from 'vitest'

import { type BrowserBootstrap, loginPageUrl } from './browser-transport'

const bootstrap = { basePath: '' } as BrowserBootstrap

const responseAt = (url: string) => {
  const response = new Response('', { status: 200 })
  Object.defineProperty(response, 'url', { value: url })

  return response
}

// A gated deployment answers an unauthenticated /api call with 303 → /login and
// fetch follows it, so the transport sees 200 + HTML. Treating that as "the API
// is broken" is what produced the "Hermes couldn't start" repair dialog for an
// expired session.
describe('loginPageUrl', () => {
  it('reads the login page out of the redirect the fetch landed on', () => {
    expect(loginPageUrl(bootstrap, responseAt('http://localhost:5174/login'), '<!doctype html>')).toBe(
      'http://localhost:5174/login'
    )
  })

  it('builds a next= link when only the password form gives it away', () => {
    const url = loginPageUrl(bootstrap, responseAt(''), '<form><input type="password"></form>')

    expect(url).toContain('/login?next=')
  })

  it('does not mistake a proxy error page for a login page', () => {
    expect(loginPageUrl(bootstrap, responseAt(''), '<html><body>502 Bad Gateway</body></html>')).toBeNull()
  })

  it('ignores a page with a form but no password field', () => {
    expect(loginPageUrl(bootstrap, responseAt(''), '<form><input type="text"></form>')).toBeNull()
  })
})
