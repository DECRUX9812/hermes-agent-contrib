/** Whether a hostname may trigger a network favicon lookup.
 *
 *  The lookup asks the site itself, so it must never fire for names that can
 *  only resolve on the viewer's own machine or LAN.
 */

const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa']

export function isPublicHost(host: string): boolean {
  let name = host.trim().toLowerCase()

  if (name.endsWith('.')) {
    name = name.slice(0, -1)
  }

  if (!name || name === 'localhost') {
    return false
  }

  if (name.startsWith('[') && name.endsWith(']')) {
    name = name.slice(1, -1)
  }

  if (!name || name === 'localhost') {
    return false
  }

  // IPv6 literals, bracketed or bare.
  if (name.includes(':')) {
    return false
  }

  // Single-label names never leave the local resolver.
  if (!name.includes('.')) {
    return false
  }

  // IPv4 literals.
  if (/^[0-9.]+$/.test(name)) {
    return false
  }

  return !PRIVATE_SUFFIXES.some(suffix => name.endsWith(suffix))
}
