/**
 * The ★ default-branch marker in the base-branch picker is decorative, but it
 * renders as bare text inside the option, so the option's accessible name is
 * "★ main" instead of "main". The glyph must live in an aria-hidden subtree.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type * as ProjectsStore from '@/store/projects'

import { BaseBranchPicker } from './base-branch-picker'

afterEach(cleanup)

// Radix's PopoverContent measures through ResizeObserver, which jsdom lacks;
// cmdk scrolls the selected item into view, which jsdom doesn't implement.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        projects: {
          baseBranchNone: 'No branches found',
          baseBranchPlaceholder: 'Search branches…',
          branchOff: () => ({ after: '', before: 'branch off ' })
        }
      }
    }
  })
}))

vi.mock('@/store/projects', async importOriginal => {
  const original = await importOriginal<typeof ProjectsStore>()

  return {
    ...original,
    listBaseBranches: vi.fn(async () => [
      { isDefault: true, isRemote: false, name: 'main' },
      { isDefault: false, isRemote: false, name: 'feature' }
    ])
  }
})

describe('BaseBranchPicker decorative glyphs', () => {
  it('keeps the ★ default marker out of the option accessible name', async () => {
    const onValueChange = vi.fn()

    render(<BaseBranchPicker onValueChange={onValueChange} repoPath="/repo" value="" />)

    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith('main'))

    fireEvent.click(screen.getByRole('button', { name: /branch off/ }))

    // The ★ must be inside an aria-hidden subtree so the option's accessible
    // name is the branch name alone.
    const star = await screen.findByText('★')
    expect(star.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(within(await screen.findByRole('option', { name: 'main' })).getByText('★')).toBeTruthy()
  })
})
