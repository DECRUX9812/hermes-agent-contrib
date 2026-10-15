import { afterEach, describe, expect, it, vi } from 'vitest'

import { findSessionApprovalStack, scrollToSessionApproval } from './approval-anchor'

describe('approval-anchor', () => {
  afterEach(() => {
    for (const el of document.querySelectorAll('[data-approval-stack]')) {
      el.remove()
    }
  })

  it('finds session approval stack by session id', () => {
    expect(findSessionApprovalStack(null)).toBeNull()
    expect(findSessionApprovalStack(undefined)).toBeNull()
    expect(findSessionApprovalStack('sess-1')).toBeNull()

    const el = document.createElement('div')
    el.setAttribute('data-approval-stack', '')
    el.setAttribute('data-session-id', 'sess-1')
    document.body.appendChild(el)

    expect(findSessionApprovalStack('sess-1')).toBe(el)
    expect(findSessionApprovalStack('sess-2')).toBeNull()
  })

  it('safely escapes special characters in session id', () => {
    const el = document.createElement('div')
    el.setAttribute('data-approval-stack', '')
    el.setAttribute('data-session-id', 'sess:abc.123@xyz')
    document.body.appendChild(el)

    expect(findSessionApprovalStack('sess:abc.123@xyz')).toBe(el)
  })

  it('scrollToSessionApproval scrolls the stack with block: nearest when found', () => {
    const el = document.createElement('div')
    el.setAttribute('data-approval-stack', '')
    el.setAttribute('data-session-id', 'sess-1')
    const scrollIntoView = vi.fn()
    el.scrollIntoView = scrollIntoView
    document.body.appendChild(el)

    const scrolled = scrollToSessionApproval('sess-1')

    expect(scrolled).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('scrollToSessionApproval returns false when no stack exists', () => {
    const scrolled = scrollToSessionApproval('sess-missing')

    expect(scrolled).toBe(false)
  })

  it('scrollToSessionApproval returns false for null/undefined session id', () => {
    expect(scrollToSessionApproval(null)).toBe(false)
    expect(scrollToSessionApproval(undefined)).toBe(false)
  })
})
