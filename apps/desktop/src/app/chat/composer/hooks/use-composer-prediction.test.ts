import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ clear: vi.fn(), request: vi.fn() }))

vi.mock('@/store/composer-prediction', async () => ({
  $composerPredictions: (await import('nanostores')).atom({ s1: 'ok ship it' }),
  clearComposerPrediction: store.clear,
  requestComposerPrediction: store.request
}))

const { takesPrediction, useComposerPrediction } = await import('./use-composer-prediction')

afterEach(() => vi.clearAllMocks())

const tab = { key: 'Tab', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }

it('asks for a prediction when a turn settles and drops it when the next starts', () => {
  const { rerender, result } = renderHook(props => useComposerPrediction(props), {
    initialProps: { busy: true, disabled: false, sessionId: 's1' }
  })

  expect(store.request).not.toHaveBeenCalled()
  rerender({ busy: false, disabled: false, sessionId: 's1' })
  expect(store.request).toHaveBeenCalledWith('s1')
  expect(result.current).toBe('ok ship it')

  rerender({ busy: true, disabled: false, sessionId: 's1' })
  expect(store.clear).toHaveBeenCalledWith('s1')
})

it('shows nothing while the composer is disabled', () => {
  const { result } = renderHook(() => useComposerPrediction({ busy: false, disabled: true, sessionId: 's1' }))

  expect(result.current).toBe('')
})

it('takes the prediction only on a bare Tab into an empty composer', () => {
  const ready = { draft: '', prediction: 'ok ship it', triggerOpen: false }

  expect(takesPrediction(tab, ready)).toBe(true)
  expect(takesPrediction(tab, { ...ready, draft: 'hm' })).toBe(false)
  expect(takesPrediction(tab, { ...ready, triggerOpen: true })).toBe(false)
  expect(takesPrediction(tab, { ...ready, prediction: '' })).toBe(false)
  expect(takesPrediction({ ...tab, shiftKey: true }, ready)).toBe(false)
  expect(takesPrediction({ ...tab, key: 'Enter' }, ready)).toBe(false)
})
