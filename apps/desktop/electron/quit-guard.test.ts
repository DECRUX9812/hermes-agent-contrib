import assert from 'node:assert/strict'

import { test } from 'vitest'

import { mergeActiveWork, normalizeActiveWork, quitHoldFor, quitPromptFor } from './quit-guard'

test('normalizeActiveWork drops junk and keeps the count at least the title count', () => {
  assert.deepEqual(normalizeActiveWork(null), { count: 0, titles: [] })
  assert.deepEqual(normalizeActiveWork({ count: 'many', titles: 'nope' }), { count: 0, titles: [] })
  assert.deepEqual(normalizeActiveWork({ count: -3, titles: ['  Fix login  ', '', 7] }), {
    count: 1,
    titles: ['Fix login']
  })
})

test('normalizeActiveWork keeps untitled sessions in the count', () => {
  assert.deepEqual(normalizeActiveWork({ count: 3, titles: ['Fix login'] }), { count: 3, titles: ['Fix login'] })
})

test('mergeActiveWork de-dupes a session two windows both report', () => {
  const merged = mergeActiveWork([
    { count: 2, titles: ['Fix login', 'Ship docs'] },
    { count: 1, titles: ['Fix login'] }
  ])

  assert.deepEqual(merged, { count: 2, titles: ['Fix login', 'Ship docs'] })
})

test('quitPromptFor stays out of the way when nothing is running', () => {
  assert.equal(quitPromptFor({ count: 0, titles: [] }, false), null)
})

test('quitPromptFor stays out of the way during an update handoff', () => {
  assert.equal(quitPromptFor({ count: 2, titles: ['Fix login'] }, true), null)
})

test('quitPromptFor names the running chats', () => {
  const prompt = quitPromptFor({ count: 2, titles: ['Fix login', 'Ship docs'] }, false)

  assert.ok(prompt)
  assert.equal(prompt.message, 'Hermes is still working on 2 chats.')
  assert.ok(prompt.detail.includes('• Fix login'))
  assert.ok(prompt.detail.includes('• Ship docs'))
})

test('quitPromptFor summarizes past the list cap and counts untitled work', () => {
  const prompt = quitPromptFor({ count: 9, titles: ['a', 'b', 'c', 'd', 'e', 'f'] }, false)

  assert.ok(prompt)
  assert.equal(prompt.message, 'Hermes is still working on 9 chats.')
  assert.ok(prompt.detail.includes('• d'))
  assert.ok(!prompt.detail.includes('• e'))
  assert.ok(prompt.detail.includes('• 5 more'))
})

test('quitPromptFor speaks singular for one chat', () => {
  const prompt = quitPromptFor({ count: 1, titles: [] }, false)

  assert.ok(prompt)
  assert.equal(prompt.message, 'Hermes is still working on 1 chat.')
  assert.ok(prompt.detail.includes('mid-turn'))
})

const stubWindow = ({ destroyed = false, visible = true } = {}) => ({
  isDestroyed: () => destroyed,
  isVisible: () => visible
})

test('quitHoldFor holds the quit with no window to parent the prompt', () => {
  // #96139: closing the last window runs window-all-closed -> app.quit() ->
  // before-quit with every BrowserWindow already destroyed. The confirmation
  // must still hold the quit and show unparented, or closing the window
  // silently kills a turn in flight.
  const hold = quitHoldFor({ count: 1, titles: ['Fix login'] }, false, null, [])

  assert.ok(hold)
  assert.equal(hold.parent, null)
  assert.equal(hold.prompt.message, 'Hermes is still working on 1 chat.')
})

test('quitHoldFor still holds when the only candidate parent is destroyed or hidden', () => {
  const destroyed = stubWindow({ destroyed: true })
  const hidden = stubWindow({ visible: false })

  const hold = quitHoldFor({ count: 2, titles: [] }, false, destroyed, [destroyed, hidden])

  assert.ok(hold)
  assert.equal(hold.parent, null)
})

test('quitHoldFor parents to the focused window and steps aside when no work runs', () => {
  const focused = stubWindow()
  const hold = quitHoldFor({ count: 1, titles: [] }, false, focused, [focused])

  assert.ok(hold)
  assert.equal(hold.parent, focused)

  assert.equal(quitHoldFor({ count: 0, titles: [] }, false, focused, [focused]), null)
  assert.equal(quitHoldFor({ count: 1, titles: [] }, true, focused, [focused]), null)
})
