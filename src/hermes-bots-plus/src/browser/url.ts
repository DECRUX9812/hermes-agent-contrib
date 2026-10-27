/** Address handling for the Hermes Browser: what the user typed → a URL, and
 *  the few facts about a URL the browser decides on. Pure, no DOM. */

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|::1)$/i
const LOCAL_SUFFIX = /\.(localhost|local|internal|lan|test)$/i
const HOSTISH = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/|$)|^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i

/** Sign-in and consent pages must run in a real top-level browser tab: they
 *  refuse frames, and their cookies and redirects belong to the user's browser. */
const AUTH_PATH = /\/(oauth2?|authorize|login|signin|sign-in|sso|device|consent)(\/|\?|$)/i
const AUTH_HOST = /^(accounts\.google\.com|login\.microsoftonline\.com|appleid\.apple\.com|auth\.|login\.|sso\.)/i

export const SEARCH_URL = 'https://duckduckgo.com/?q='

/** Turn address-bar input into a URL: a full URL as is, a host gets a scheme
 *  (http for local hosts, https otherwise), anything else becomes a search. */
export function normalizeAddress(input: string): string {
  const text = input.trim()

  if (!text) {
    return ''
  }

  if (/^https?:\/\//i.test(text)) {
    return text
  }

  if (!/\s/.test(text) && HOSTISH.test(text)) {
    const host = text.split(/[/:?#]/)[0]

    return `${LOOPBACK.test(host) || LOCAL_SUFFIX.test(host) || /^\d/.test(host) ? 'http' : 'https'}://${text}`
  }

  return SEARCH_URL + encodeURIComponent(text)
}

export function parseUrl(url: string): null | URL {
  try {
    const parsed = new URL(url)

    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

export function isWebUrl(url: string): boolean {
  return parseUrl(url) !== null
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.test(host)
}

export function isLoopbackUrl(url: string): boolean {
  const parsed = parseUrl(url)

  return Boolean(parsed && isLoopbackHost(parsed.hostname))
}

export function isAuthUrl(url: string): boolean {
  const parsed = parseUrl(url)

  return Boolean(parsed && (AUTH_HOST.test(parsed.hostname) || AUTH_PATH.test(parsed.pathname)))
}

/** "github.com/owner/repo" style label for tabs and cards. */
export function addressLabel(url: string): string {
  const parsed = parseUrl(url)

  if (!parsed) {
    return url
  }

  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')

  return `${parsed.host.replace(/^www\./, '')}${path}`
}

export function hostOf(url: string): string {
  return parseUrl(url)?.host.replace(/^www\./, '') ?? ''
}
