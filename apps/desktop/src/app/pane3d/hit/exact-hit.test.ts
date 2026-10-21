/**
 * Contract tests for the forward click-through decision (architecture §6,
 * VAL-HIT-005's toggle clause).
 *
 * On darwin/win32 the pane takes the mouse ONLY while an exact target is under
 * the pointer: a `[data-pane-hit]`/`[data-pane-chart]` element (or an optional
 * mesh raycast). Membership in a padded, merged Linux shape rectangle is NOT
 * an exact target and must never capture a click beside an avatar. The pure
 * `stepForwardHit` also pins the two lifecycle rules the publisher relies on:
 * the DOM target is re-tested under a stationary pointer every tick, and an
 * empty region list (where main forces click-through) resyncs the cursor so the
 * next real target is still announced. Linux never takes the mouse at all.
 */

import { describe, expect, it } from 'vitest'

import { decideIgnoreMouse, type ForwardHitCursor, stepForwardHit } from './exact-hit'

/** Sits where an avatar's padded region would be, with no element under it. */
const OVER_REGION = { x: 150, y: 250 }
/** Empty desktop, outside every region. */
const OFF_TARGET = { x: 10, y: 10 }

const base = {
  composerOpen: false,
  current: true,
  dragging: false,
  elementHit: false,
  platform: 'darwin' as NodeJS.Platform,
  pointer: OVER_REGION
}

describe('decideIgnoreMouse', () => {
  it('never takes the mouse on linux — setShape owns interactivity there', () => {
    expect(decideIgnoreMouse({ ...base, current: true, platform: 'linux' })).toBe(true)
    expect(
      decideIgnoreMouse({ ...base, current: false, elementHit: true, platform: 'linux', pointer: OFF_TARGET })
    ).toBe(false)
  })

  it('ignores the mouse over a padded region unless an exact element is there', () => {
    // The pointer sits where the old region membership test called it a hit;
    // without a DOM target it is NOT interactive (this replaces that wrong
    // pinned behaviour, which swallowed clicks beside an avatar).
    expect(decideIgnoreMouse({ ...base, pointer: OVER_REGION })).toBe(true)
    expect(decideIgnoreMouse({ ...base, elementHit: true, pointer: OVER_REGION })).toBe(false)
  })

  it('takes the mouse for a DOM target anywhere, even outside every region', () => {
    expect(decideIgnoreMouse({ ...base, elementHit: true, pointer: OFF_TARGET })).toBe(false)
  })

  it('accepts an optional mesh raycast target as an exact hit', () => {
    expect(decideIgnoreMouse({ ...base, meshHit: true, pointer: OFF_TARGET })).toBe(false)
  })

  it('keeps the mouse while the composer is open, wherever the pointer is', () => {
    expect(decideIgnoreMouse({ ...base, composerOpen: true, pointer: OFF_TARGET })).toBe(false)
  })

  it('does not flip state mid-drag', () => {
    expect(decideIgnoreMouse({ ...base, current: false, dragging: true, pointer: OFF_TARGET })).toBe(false)
    expect(decideIgnoreMouse({ ...base, current: true, dragging: true, elementHit: true, pointer: OVER_REGION })).toBe(
      true
    )
  })

  it('stays click-through until the first forwarded move', () => {
    expect(decideIgnoreMouse({ ...base, elementHit: true, pointer: null })).toBe(true)
  })

  it('behaves the same on win32 as on darwin', () => {
    expect(decideIgnoreMouse({ ...base, elementHit: true, platform: 'win32', pointer: OVER_REGION })).toBe(false)
    expect(decideIgnoreMouse({ ...base, platform: 'win32', pointer: OVER_REGION })).toBe(true)
  })
})

describe('stepForwardHit', () => {
  const tick = {
    composerOpen: false,
    dragging: false,
    elementHit: false,
    platform: 'darwin' as NodeJS.Platform,
    pointer: OVER_REGION,
    regionsEmpty: false
  }

  /** Drives the cursor through a tick sequence, collecting every sent message. */
  function run(values: Array<Partial<typeof tick>>, start: boolean) {
    let cursor: ForwardHitCursor = { ignore: start }
    const sent: Array<{ ignore: boolean; type: string }> = []

    values.forEach(value => {
      const step = stepForwardHit(cursor, { ...tick, ...value })
      cursor = { ignore: step.ignore }

      if (step.message) {
        sent.push(step.message)
      }
    })

    return { cursor, sent }
  }

  it('re-tests the DOM target under a stationary pointer; removing it sends exactly one ignore:true', () => {
    // The pointer never moves. Only the element under it changes, and Chromium
    // reports no pointermove for that — so the target must be re-tested every
    // tick or the pane would keep taking clicks after the element disappeared.
    const { cursor, sent } = run(
      [{ elementHit: true }, { elementHit: true }, { elementHit: false }, { elementHit: false }],
      true
    )

    expect(sent).toEqual([
      { ignore: false, type: 'ignore-mouse' },
      { ignore: true, type: 'ignore-mouse' }
    ])
    expect(cursor.ignore).toBe(true)
  })

  it('resyncs to click-through on empty regions, so the next target still sends ignore:false', () => {
    // main's forward plan already forces setIgnoreMouseEvents(true) for an
    // empty list, so the cursor follows WITHOUT a duplicate message — but it
    // must follow, or the later ignore:false reads as "no change" and is lost.
    const { cursor, sent } = run([{ elementHit: false, regionsEmpty: true }, { elementHit: true }], false)

    expect(sent).toEqual([{ ignore: false, type: 'ignore-mouse' }])
    expect(cursor.ignore).toBe(false)
  })

  it('never sends an ignore-mouse message on linux', () => {
    const { sent } = run(
      [
        { elementHit: true, platform: 'linux' },
        { elementHit: false, platform: 'linux' }
      ],
      false
    )

    expect(sent).toEqual([])
  })
})
