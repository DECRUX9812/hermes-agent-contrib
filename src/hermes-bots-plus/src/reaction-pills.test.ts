import { describe, expect, it } from 'vitest'

import { BOT_CHAT_MARK, chatPaneOf, reactionPillStyleSheet } from './reaction-pills'

describe('reaction pills', () => {
  it('scopes every rule to the Bot Chat marker', () => {
    const css = reactionPillStyleSheet()
    const selectors = css.split('}').filter(Boolean).map(rule => rule.split('{')[0])

    expect(selectors.length).toBeGreaterThan(3)

    for (const sel of selectors) {
      for (const part of sel.split(',')) {
        expect(part.trim().startsWith(`[${BOT_CHAT_MARK}]`)).toBe(true)
      }
    }
  })

  it('uses theme tokens, no raw colours', () => {
    expect(reactionPillStyleSheet()).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  })

  it('finds the pane that holds the transcript viewport', () => {
    document.body.innerHTML =
      '<div id="pane"><div data-slot="aui_thread-viewport"></div><div><div><span id="a"></span></div></div></div>'

    expect(chatPaneOf(document.getElementById('a'))?.id).toBe('pane')
    document.body.innerHTML = '<div><span id="b"></span></div>'
    expect(chatPaneOf(document.getElementById('b'))).toBeNull()
  })
})
