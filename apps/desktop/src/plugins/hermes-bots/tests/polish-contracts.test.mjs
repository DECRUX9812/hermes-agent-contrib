import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

test('presence words are never color-only on roster rows', () => {
  const workingAt = source.indexOf("children: 'Working'")
  assert.ok(workingAt >= 0, "visible 'Working' word exists")
  const unreadAt = source.indexOf("'aria-label': 'unread'")
  assert.equal(unreadAt, -1, 'bare aria-label unread dot is gone')
  assert.match(source, /role: 'status',[\s\S]{0,300}unread/)
})

test('every interactive strip button exposes a visible focus ring', () => {
  const focus = 'focus-visible:outline-2'
  let count = 0
  for (const marker of [
    "const row = jsxs('button'",
    "'flex w-full min-w-0 items-center gap-2 rounded-md bg-(--ui-bg-quaternary)",
    "'flex w-full min-w-0 flex-col gap-0.5 rounded-md bg-(--ui-bg-quaternary)",
    "'flex items-center gap-1.5 rounded-md bg-(--ui-bg-quaternary) px-1.5 py-1",
    "'flex items-center gap-1.5 rounded-md bg-(--chrome-action-hover) px-1.5 py-1 text-left transition-colors'"
  ]) {
    const i = source.indexOf(marker)
    assert.ok(i >= 0, `marker present: ${marker.slice(0, 40)}`)
    const window = source.slice(i, i + 700)
    assert.ok(window.includes(focus), `focus-visible within ${marker.slice(0, 40)}`)
    count += 1
  }
  assert.ok(count >= 5)
})

test('all animations respect prefers-reduced-motion', () => {
  const reduced = source.indexOf('@media (prefers-reduced-motion: reduce)')
  assert.ok(reduced >= 0, 'reduced-motion block exists')
  const pulseAt = source.indexOf('hermes-bots-pulse')
  const bobAt = source.indexOf('hermes-bots-bob')
  // both animation declarations appear before (or inside reach of) a guard
  assert.ok(pulseAt >= 0 && bobAt >= 0)
  const guardBlock = source.slice(reduced, reduced + 300)
  assert.match(guardBlock, /hermes-bots-pulse/)
  assert.match(guardBlock, /hermes-bots-bob/)
})

test('TeamSummaryLine derives only from real state and stays silent when quiet', () => {
  const start = source.indexOf('function TeamSummaryLine(')
  const end = source.indexOf('/** "Missions" strip')
  assert.ok(start >= 0 && end > start)
  const body = source.slice(start, end)
  // no time-window heuristics, no socket/focus/unread inputs
  assert.doesNotMatch(body, /last_active|gatewayState|\$botUnread|Date\.now\(\) -/)
  // silent when nothing to say
  assert.match(body, /if \(!parts\.length\)[\s\S]{0,60}return null/)
})
