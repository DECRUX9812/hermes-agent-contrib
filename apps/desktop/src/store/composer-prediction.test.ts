import { afterEach, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => ({ answers: [] as ((value: { text: string }) => void)[] }))

vi.mock('./gateway', async () => ({ $gateway: (await import('nanostores')).atom({}) }))
vi.mock('./session-gone-latch', () => ({ ambientRequestFor: () => () => undefined }))
vi.mock('./session-states', () => ({
  requestForOwnedSession: () => new Promise(resolve => rpc.answers.push(resolve))
}))

const { $composerPredictions, clearComposerPrediction, requestComposerPrediction } =
  await import('./composer-prediction')

afterEach(() => {
  rpc.answers = []
  $composerPredictions.set({})
})

it('shows the prediction for the session that asked', async () => {
  const pending = requestComposerPrediction('s1')
  rpc.answers[0]?.({ text: '  ok ship it ' })
  await pending

  expect($composerPredictions.get()).toEqual({ s1: 'ok ship it' })
})

it('drops an answer that lands after the next turn already started', async () => {
  const pending = requestComposerPrediction('s1')
  // The user sent something before the prediction came back.
  clearComposerPrediction('s1')
  rpc.answers[0]?.({ text: 'stale suggestion' })
  await pending

  expect($composerPredictions.get()).toEqual({})
})

it('treats an empty answer (predictions off) as nothing to show', async () => {
  const pending = requestComposerPrediction('s1')
  rpc.answers[0]?.({ text: '' })
  await pending

  expect($composerPredictions.get()).toEqual({})
})
