import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { handleRosterArrowKey, nextRowIndex } from './roster-keyboard'

// The roster invites Up/Down — it is a list of rows — but the rows are plain
// buttons, so the keys did nothing and reaching the 12th bot meant 12 tabs.
// `nextRowIndex` owns the ends-of-list rule; the handler owns the focus move.

describe('nextRowIndex', () => {
  it('steps one row in each direction', () => {
    expect(nextRowIndex(1, 4, 'ArrowDown')).toBe(2)
    expect(nextRowIndex(2, 4, 'ArrowUp')).toBe(1)
  })

  it('clamps at both ends instead of wrapping', () => {
    expect(nextRowIndex(3, 4, 'ArrowDown')).toBe(3)
    expect(nextRowIndex(0, 4, 'ArrowUp')).toBe(0)
  })

  it('jumps to the ends with Home and End', () => {
    expect(nextRowIndex(2, 9, 'Home')).toBe(0)
    expect(nextRowIndex(2, 9, 'End')).toBe(8)
  })

  it('ignores keys it does not own, an empty list, and "nothing focused"', () => {
    expect(nextRowIndex(1, 4, 'Enter')).toBeNull()
    expect(nextRowIndex(1, 0, 'ArrowDown')).toBeNull()
    expect(nextRowIndex(-1, 4, 'ArrowDown')).toBeNull()
  })
})

afterEach(cleanup)

function Roster({ rows }: { rows: string[] }) {
  return (
    <div data-slot="bots-roster" onKeyDown={handleRosterArrowKey}>
      {rows.map(name => (
        <button data-roster-row key={name} type="button">
          {name}
        </button>
      ))}
    </div>
  )
}

describe('handleRosterArrowKey', () => {
  it('moves focus to the next and previous row', () => {
    render(<Roster rows={['alpha', 'beta', 'gamma']} />)

    screen.getByText('alpha').focus()
    fireEvent.keyDown(screen.getByText('alpha'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByText('beta'))

    fireEvent.keyDown(screen.getByText('beta'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByText('alpha'))
  })

  it('stops at the last row and jumps home with Home', () => {
    render(<Roster rows={['alpha', 'beta']} />)

    screen.getByText('beta').focus()
    fireEvent.keyDown(screen.getByText('beta'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByText('beta'))

    fireEvent.keyDown(screen.getByText('beta'), { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByText('alpha'))
  })

  it('leaves keys alone when the focused control is not a row', () => {
    render(
      <div data-slot="bots-roster" onKeyDown={handleRosterArrowKey}>
        <input aria-label="search" />
        <button data-roster-row type="button">
          alpha
        </button>
      </div>
    )

    const input = screen.getByLabelText('search')

    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    // Typing in the search field must not be hijacked into row navigation.
    expect(document.activeElement).toBe(input)
  })
})
