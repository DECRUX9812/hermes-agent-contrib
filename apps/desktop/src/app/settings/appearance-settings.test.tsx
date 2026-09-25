// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ThemeProvider } from '@/themes/context'

import { AppearanceSettings } from './appearance-settings'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderThemeSubpage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <AppearanceSettings subpage="theme" />
      </ThemeProvider>
    </QueryClientProvider>
  )
}

// Theme card labels render inside a truncate'd div in each card's button.
const cardLabels = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll<HTMLElement>('.grid button .truncate')).map(el => el.textContent ?? '')

const cardButtonFor = (container: HTMLElement, label: string): HTMLButtonElement => {
  const el = Array.from(container.querySelectorAll<HTMLElement>('.grid button .truncate')).find(
    node => node.textContent === label
  )
  const button = el?.closest('button')

  if (!button) {
    throw new Error(`no theme card for "${label}"`)
  }

  return button
}

describe('AppearanceSettings theme grid', () => {
  it('does not reorder the grid when a different theme is selected', () => {
    const { container } = renderThemeSubpage()
    const before = cardLabels(container)

    expect(before.length).toBeGreaterThan(2)

    // Pick a card that is NOT already first so the active-first sort (if any)
    // would have to move it.
    const picked = before[1]

    act(() => {
      cardButtonFor(container, picked).click()
    })

    expect(cardLabels(container)).toEqual(before)
    // The active affordance lives on the card (ring), not on its position.
    expect(cardButtonFor(container, picked).className).toContain('ring-2')
  })
})
