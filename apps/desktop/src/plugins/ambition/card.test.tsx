/**
 * The inline Ambition card's contract, with the real api layer bound to a
 * scripted `ctx.rest`:
 *
 *  - a proposed card renders the five labelled fields, editable inline, and
 *    an edit PATCHes the card;
 *  - [Accept] / [Smaller] POST to the card's accept/decline routes;
 *  - once decided the card folds to one line carrying the (edited) target;
 *  - a widening card wears the needs-approval (amber) vocabulary;
 *  - a missing card says so — never a fake card.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Test harness supplies the host's locale registration, as plugin loading does.
// eslint-disable-next-line no-restricted-imports
import { registerPluginLocales } from '@/i18n/plugin-i18n'
// eslint-disable-next-line no-restricted-imports
import { $selectedStoredSessionId } from '@/store/session'

import { type AmbitionRest, bindAmbitionApi } from './api'
import { AmbitionCardPart } from './card'
import { AMBITION_LOCALES } from './i18n'

const SESSION = '20260101_090000_abc123'
const CARD_ID = 'card-e2e-ambition-1'

const baseFields = () => ({
  altitude: 'Ship the release notes automation.',
  depth: 'Start from the changelog entries.',
  judge: 'A scripted checklist tool.',
  range: 'Write and wire the generator.',
  target: '12 release notes generated'
})

const card = (over: Record<string, unknown> = {}) => ({
  created_at: '2026-01-01T09:00:00Z',
  decided_at: null,
  edited_fields: null,
  fields: baseFields(),
  id: CARD_ID,
  judge: null,
  session_id: SESSION,
  status: 'proposed',
  updated_at: '2026-01-01T09:00:00Z',
  widens_scope: false,
  ...over
})

let rest: ReturnType<typeof vi.fn>
let disposeLocales: () => void = () => undefined
let queryClient: QueryClient

beforeEach(() => {
  rest = vi.fn()
  bindAmbitionApi(rest as unknown as AmbitionRest)
  disposeLocales = registerPluginLocales('ambition', AMBITION_LOCALES)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  $selectedStoredSessionId.set(SESSION)
})

afterEach(() => {
  cleanup()
  disposeLocales()
  $selectedStoredSessionId.set(null)
  queryClient.clear()
})

const mountWith = (result: unknown, mock: (path: string, opts?: { body?: unknown; method?: string }) => unknown) => {
  rest.mockImplementation(mock as never)

  return render(
    <QueryClientProvider client={queryClient}>
      <AmbitionCardPart {...partProps(result)} />
    </QueryClientProvider>
  )
}

const mountWithCard = (cardState: Record<string, unknown> = {}) =>
  mountWith(proposedResult, path =>
    path === `/sessions/${SESSION}` ? Promise.resolve({ cards: [card(cardState)], enabled: true }) : Promise.resolve({})
  )

const proposedResult = { card_id: CARD_ID, ok: true, status: 'proposed', widens_scope: false }

const partProps = (result: unknown) => ({
  args: {},
  isError: false,
  result,
  toolCallId: 'tc-1',
  toolName: 'ambition_card'
})

const slot = (container: HTMLElement, name: string): HTMLElement | null => container.querySelector(`[data-slot="${name}"]`)

const targetField = (container: HTMLElement) =>
  container.querySelector('[data-ambition-field="target"] textarea') as HTMLTextAreaElement

describe('AmbitionCardPart', () => {
  it('renders the five labelled fields from the backend card', async () => {
    const { container } = mountWithCard()

    for (const label of ['Altitude', 'Depth', 'Range', 'Target', 'Judge']) {
      expect(await screen.findByText(label)).toBeTruthy()
    }

    expect(targetField(container).value).toBe('12 release notes generated')
    // The optional sixth field is absent when the agent set none.
    expect(container.querySelector('[data-ambition-field="access"]')).toBeNull()
    expect(slot(container, 'ambition-card')?.getAttribute('data-ambition-status')).toBe('proposed')
  })

  it('PATCHes an inline edit and repaints the saved value', async () => {
    let edited = false

    const { container } = mountWith(proposedResult, (path, opts) => {
      if (path === `/sessions/${SESSION}`) {
        return Promise.resolve({
          cards: [
            edited
              ? card({
                  edited_fields: { target: '15 release notes generated' },
                  fields: { ...baseFields(), target: '15 release notes generated' },
                  status: 'edited',
                  updated_at: '2026-01-01T09:01:00Z'
                })
              : card()
          ],
          enabled: true
        })
      }

      if (path === `/cards/${CARD_ID}` && opts?.method === 'PATCH') {
        edited = true

        return Promise.resolve(card({ status: 'edited' }))
      }

      return Promise.resolve({})
    })

    await waitFor(() => expect(targetField(container).value).toBe('12 release notes generated'))

    fireEvent.change(targetField(container), { target: { value: '15 release notes generated' } })
    fireEvent.blur(targetField(container))

    await waitFor(() =>
      expect(rest.mock.calls.some(call => call[0] === `/cards/${CARD_ID}` && call[1]?.method === 'PATCH')).toBe(true)
    )
    expect(rest.mock.calls.find(call => call[0] === `/cards/${CARD_ID}`)?.[1]?.body).toMatchObject({
      target: '15 release notes generated'
    })

    // The refetched summary repaints the saved value (edited status).
    await waitFor(() => expect(slot(container, 'ambition-card')?.getAttribute('data-ambition-status')).toBe('edited'))
    await waitFor(() => expect(targetField(container).value).toBe('15 release notes generated'))
  })

  it('accept POSTs and folds to one line carrying the edited target', async () => {
    const { container } = mountWith(proposedResult, (path, opts) => {
      if (path === `/sessions/${SESSION}`) {
        const accepted = rest.mock.calls.some(call => call[0] === `/cards/${CARD_ID}/accept`)

        return Promise.resolve({
          cards: [
            accepted
              ? card({
                  decided_at: '2026-01-01T09:05:00Z',
                  fields: { ...baseFields(), target: '15 release notes generated' },
                  status: 'accepted'
                })
              : card({ fields: { ...baseFields(), target: '15 release notes generated' }, status: 'edited' })
          ],
          enabled: true
        })
      }

      if (path === `/cards/${CARD_ID}/accept` && opts?.method === 'POST') {
        return Promise.resolve(card({ status: 'accepted' }))
      }

      return Promise.resolve({})
    })

    await waitFor(() => expect(slot(container, 'ambition-accept')).toBeTruthy())
    fireEvent.click(slot(container, 'ambition-accept') as HTMLElement)

    await waitFor(() => expect(slot(container, 'ambition-card-folded')).toBeTruthy())
    expect(screen.queryByLabelText('Altitude')).toBeNull()

    const folded = slot(container, 'ambition-card-folded') as HTMLElement

    expect(folded.getAttribute('data-ambition-status')).toBe('accepted')
    expect(folded.textContent).toContain('accepted')
    expect(folded.textContent).toContain('15 release notes generated')
    expect(rest.mock.calls.some(call => call[0] === `/cards/${CARD_ID}/accept` && call[1]?.method === 'POST')).toBe(true)
  })

  it('decline (Smaller) POSTs and folds as declined', async () => {
    const { container } = mountWith(proposedResult, (path, opts) => {
      if (path === `/sessions/${SESSION}`) {
        const declined = rest.mock.calls.some(call => call[0] === `/cards/${CARD_ID}/decline`)

        return Promise.resolve({
          cards: [declined ? card({ decided_at: '2026-01-01T09:05:00Z', status: 'declined' }) : card()],
          enabled: true
        })
      }

      if (path === `/cards/${CARD_ID}/decline` && opts?.method === 'POST') {
        return Promise.resolve(card({ status: 'declined' }))
      }

      return Promise.resolve({})
    })

    await waitFor(() => expect(slot(container, 'ambition-decline')).toBeTruthy())
    fireEvent.click(slot(container, 'ambition-decline') as HTMLElement)

    await waitFor(() => {
      expect(slot(container, 'ambition-card-folded')?.getAttribute('data-ambition-status')).toBe('declined')
    })
    expect(rest.mock.calls.some(call => call[0] === `/cards/${CARD_ID}/decline` && call[1]?.method === 'POST')).toBe(
      true
    )
  })

  it('wears the needs-approval vocabulary when the card widens scope', async () => {
    const { container } = mountWithCard({ widens_scope: true })

    await waitFor(() => expect(slot(container, 'ambition-widens-scope')).toBeTruthy())
    // The card row itself reads needs-approval, in the amber family.
    expect(container.querySelector('[data-ambition-field="target"]')).toBeTruthy()
  })

  it('says so when the tool result has no card behind it', async () => {
    rest.mockImplementation((path: string) =>
      path === `/sessions/${SESSION}` ? Promise.resolve({ cards: [], enabled: true }) : Promise.resolve({})
    )

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <AmbitionCardPart
          {...partProps({ error: 'card storage unavailable', ok: false, reason: 'not_found' })}
        />
      </QueryClientProvider>
    )

    await waitFor(() => expect(slot(container, 'ambition-card-missing')).toBeTruthy())
    expect(container.querySelector('[data-ambition-field="target"]')).toBeNull()
  })
})
