import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FindOnMap } from './find-on-map'

const base = {
  index: 0,
  matchCount: 0,
  onChange: () => {},
  onClear: () => {},
  onStep: () => {},
  query: ''
}

describe('FindOnMap', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows no counter while the box is empty', () => {
    render(<FindOnMap {...base} />)

    expect(screen.getByRole('searchbox').getAttribute('aria-label')).toBe('Find on the map')
    expect(screen.queryByText('0/0')).toBeNull()
  })

  it('reports every keystroke so the map can match as you type', () => {
    const onChange = vi.fn()

    render(<FindOnMap {...base} onChange={onChange} query="gate" />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gatew' } })

    expect(onChange).toHaveBeenCalledWith('gatew')
  })

  it('shows the hit count while matching', () => {
    render(<FindOnMap {...base} index={2} matchCount={7} query="gateway" />)

    expect(screen.getByText('3/7')).toBeTruthy()
    expect(screen.queryByText('No matches')).toBeNull()
  })

  it('says "No matches" and disables stepping when nothing is found', () => {
    render(<FindOnMap {...base} matchCount={0} query="kubernetes" />)

    expect(screen.getByText('No matches')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Previous match' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Next match' }).hasAttribute('disabled')).toBe(true)
  })

  it('steps forward on Enter and back on Shift+Enter', () => {
    const onStep = vi.fn()

    render(<FindOnMap {...base} matchCount={3} onStep={onStep} query="gateway" />)

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter', shiftKey: true })

    expect(onStep.mock.calls).toEqual([[1], [-1]])
  })

  it('clears on Escape without closing the map', () => {
    const onClear = vi.fn()

    render(<FindOnMap {...base} matchCount={2} onClear={onClear} query="gateway" />)
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })

    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('steps from the buttons too', () => {
    const onStep = vi.fn()

    render(<FindOnMap {...base} matchCount={2} onStep={onStep} query="gateway" />)
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))

    expect(onStep.mock.calls).toEqual([[1], [-1]])
  })
})
