/**
 * Roster section collapse persistence (G4) — a folded section stays folded
 * next launch.
 *
 * Invariants:
 *  - Toggling a section header persists under `bot-sections-collapsed-v1` in
 *    device-local plugin storage.
 *  - `loadBotSections` hydrates the collapsed set back, alongside the
 *    sections themselves — and garbage in storage degrades to "nothing
 *    collapsed", never a crash.
 *  - The fold covers every roster section kind (user sections, gateway
 *    buckets, group-chats, mailbox) because they share the same key set.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { storage } = vi.hoisted(() => ({ storage: new Map<string, unknown>() }))

vi.mock('./data', () => ({ $botMeta: { get: () => ({}), set: vi.fn() }, saveBotMeta: vi.fn() }))
vi.mock('./group-chat', () => ({ $groupChats: { get: () => ({}), set: vi.fn() }, updateGroupChat: vi.fn() }))
vi.mock('./routing', () => ({
  botRosterMeta: (bot: { name: string }, meta: Record<string, unknown>) => meta[bot.name]
}))
vi.mock('./shared', () => ({
  getPluginCtx: () => ({
    storage: {
      get: (key: string, fallback: unknown) => (storage.has(key) ? storage.get(key) : fallback),
      set: (key: string, value: unknown) => storage.set(key, value)
    }
  })
}))

import {
  $collapsedBotSections,
  BOT_SECTIONS_COLLAPSED_KEY,
  isBotSectionCollapsed,
  loadBotSections,
  toggleBotSectionCollapsed
} from './user-sections'

beforeEach(() => {
  storage.clear()
  $collapsedBotSections.set(new Set())
})

describe('collapsed section persistence', () => {
  it('a toggle persists the folded key and a second toggle removes it', () => {
    toggleBotSectionCollapsed('user-section:sec-1')
    toggleBotSectionCollapsed('mailbox')

    expect(isBotSectionCollapsed('user-section:sec-1')).toBe(true)
    expect(storage.get(BOT_SECTIONS_COLLAPSED_KEY)).toEqual(['user-section:sec-1', 'mailbox'])

    toggleBotSectionCollapsed('mailbox')
    expect(isBotSectionCollapsed('mailbox')).toBe(false)
    expect(storage.get(BOT_SECTIONS_COLLAPSED_KEY)).toEqual(['user-section:sec-1'])
  })

  it('loadBotSections restores the folded set across a relaunch', () => {
    storage.set(BOT_SECTIONS_COLLAPSED_KEY, ['gateway:conn-9', 'group-chats'])

    loadBotSections()

    expect(isBotSectionCollapsed('gateway:conn-9')).toBe(true)
    expect(isBotSectionCollapsed('group-chats')).toBe(true)
    expect(isBotSectionCollapsed('user-section:sec-1')).toBe(false)
  })

  it('garbage in storage degrades to nothing collapsed', () => {
    storage.set(BOT_SECTIONS_COLLAPSED_KEY, { bogus: true })

    loadBotSections()

    expect($collapsedBotSections.get().size).toBe(0)
  })
})
