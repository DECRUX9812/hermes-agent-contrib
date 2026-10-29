import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dialog, DialogContent, DialogFooter, DialogTitle } from './dialog'

afterEach(cleanup)

// Dialog actions must stay reachable while the body scrolls: the footer lives
// inside the scroll box but pins to its bottom edge, so tall content can never
// carry the buttons out of view (#128170).
describe('DialogFooter', () => {
  it('pins to the bottom of the scrolling body', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Tall dialog</DialogTitle>
          <DialogFooter>
            <button>Done</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )

    const footer = screen.getByText('Done').closest('[data-slot="dialog-footer"]') as HTMLElement
    expect(footer.className).toContain('sticky')

    const scrollBody = footer.parentElement as HTMLElement
    expect(scrollBody.className).toContain('overflow-y-auto')
  })
})

describe('DialogContent close button', () => {
  it('closes the dialog when clicked', () => {
    const onOpenChange = vi.fn()
    render(
      <Dialog onOpenChange={onOpenChange} open>
        <DialogContent>
          <DialogTitle>Test dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
