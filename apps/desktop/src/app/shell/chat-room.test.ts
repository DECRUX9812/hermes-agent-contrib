/**
 * The sidebar gives way before the chat does: it folds when the chat drops
 * under the comfort width, and only an auto-folded sidebar returns — and only
 * once the chat would still be comfortable with it back.
 */

import { describe, expect, it } from 'vitest'

import { CHAT_COMFORT_PX, chatRoomAction } from './chat-room'

describe('chat room', () => {
  it('folds an open sidebar when the chat is too narrow, never otherwise', () => {
    expect(chatRoomAction(CHAT_COMFORT_PX - 1, { foldedWidth: null, sidebarOpen: true })).toBe('fold')
    expect(chatRoomAction(CHAT_COMFORT_PX, { foldedWidth: null, sidebarOpen: true })).toBeNull()
  })

  it('brings back only a sidebar it folded, once the chat keeps its room', () => {
    const folded = { foldedWidth: 240, sidebarOpen: false }

    // Just enough for the sidebar would put the chat right back at the edge.
    expect(chatRoomAction(CHAT_COMFORT_PX + 240, folded)).toBeNull()
    expect(chatRoomAction(CHAT_COMFORT_PX * 3, folded)).toBe('unfold')
    // A sidebar the user closed stays closed however wide the window gets.
    expect(chatRoomAction(CHAT_COMFORT_PX * 3, { foldedWidth: null, sidebarOpen: false })).toBeNull()
  })
})
