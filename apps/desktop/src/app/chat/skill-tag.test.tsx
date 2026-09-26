import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createClientSessionState, normalizeSessionSkills, sameSessionSkills } from '@/lib/chat-runtime'
import { $sessionStates } from '@/store/session-states'

import { SkillTag } from './skill-tag'

const STORED = 'stored-skill-session'

/** Publish a session slice carrying `skills`, keyed under `STORED`. */
function setSkills(skills: Record<string, string[]>) {
  $sessionStates.set({
    runtime: { ...createClientSessionState(STORED), skills }
  })
}

afterEach(cleanup)

beforeEach(() => {
  $sessionStates.set({})
})

describe('SkillTag', () => {
  it('renders nothing when the session reports no skills', () => {
    render(<SkillTag storedSessionId={STORED} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing for an empty reported set', () => {
    setSkills({})
    render(<SkillTag storedSessionId={STORED} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the active skill count and lists names on click', async () => {
    setSkills({ general: ['code-review', 'git-flow'], mlops: ['axolotl'] })
    render(<SkillTag storedSessionId={STORED} />)

    const chip = screen.getByRole('button', { name: '3 skills' })
    fireEvent.click(chip)

    expect(await screen.findByText('code-review')).toBeTruthy()
    expect(screen.getByText('git-flow')).toBeTruthy()
    expect(screen.getByText('axolotl')).toBeTruthy()
    // Category headers only paint for non-general groups.
    expect(screen.getByText('mlops')).toBeTruthy()
    expect(screen.queryByText('general')).toBeNull()
  })

  it('reads this session’s skills, not another session’s', () => {
    setSkills({ general: ['code-review'] })
    render(<SkillTag storedSessionId="other-session" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('never opens the popover on its own', () => {
    setSkills({ general: ['code-review'] })
    render(<SkillTag storedSessionId={STORED} />)
    expect(screen.queryByText('code-review')).toBeNull()
  })
})

describe('normalizeSessionSkills', () => {
  it('passes category maps through and filters non-strings', () => {
    expect(
      normalizeSessionSkills({ mlops: ['axolotl', 7, null], general: ['git-flow'] })
    ).toEqual({ mlops: ['axolotl'], general: ['git-flow'] })
  })

  it('groups a legacy flat list under the unnamed category', () => {
    expect(normalizeSessionSkills(['a', 'b'])).toEqual({ '': ['a', 'b'] })
  })

  it('normalizes anything else to empty', () => {
    for (const value of [undefined, null, 'x', 4, {}, { a: 'no' }, { a: [] }]) {
      expect(normalizeSessionSkills(value)).toEqual({})
    }
  })
})

describe('sameSessionSkills', () => {
  it('matches structurally equal maps across references', () => {
    expect(sameSessionSkills({ a: ['x', 'y'] }, { a: ['x', 'y'] })).toBe(true)
    expect(sameSessionSkills({ a: ['x'] }, { a: ['x', 'y'] })).toBe(false)
    expect(sameSessionSkills({ a: ['x'] }, { b: ['x'] })).toBe(false)
    expect(sameSessionSkills({ a: ['x'] }, { a: ['y'] })).toBe(false)
    expect(sameSessionSkills({}, {})).toBe(true)
  })
})
