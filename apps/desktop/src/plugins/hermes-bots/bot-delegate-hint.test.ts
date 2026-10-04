/**
 * `delegateHintBot` — should the "open as a bot topic" chip show on this chat?
 *
 * Every path out is "don't hint": the session must be a plain working chat
 * proven to run on a rostered bot profile. The pinned rules:
 *
 *  1. A session already scoped 'bots' (a topic, or the canonical Bot Chat
 *     re-opened through the workspace) never hints — it is already there.
 *  2. The canonical Bot Chat never hints — resolved by TITLE identity off the
 *     roster's `canonical_session`, the same rule as every other canonical
 *     check; never a stored-id pointer of our own.
 *  3. An unproven or unrostered owner never hints — a profile name that
 *     matches no row (or a session with no owner) isn't a bot session we can
 *     name.
 *  4. A bot with no teammates never hints — there is no one to delegate to.
 */

import { describe, expect, it } from 'vitest'

import { delegateHintBot } from './bot-delegate-hint'
import type { RosterRow } from './types'

const BOT: RosterRow = {
  canonical_session: { id: 'canon-1', last_active: 10, resolved_id: 'canon-tip', title: 'Bot Chat' },
  connectionId: 'local',
  name: 'porter'
}

const MATE: RosterRow = { connectionId: 'local', name: 'scout' }

const owner = { connectionId: 'local', profile: 'porter' }

describe('delegateHintBot', () => {
  it('names the bot for a plain session proven to run on its profile', () => {
    const bot = delegateHintBot([BOT, MATE], owner, 'side-1', { 'side-1': { workspaceMode: 'sessions' } })

    expect(bot).toBe(BOT)
  })

  it('is silent for a lone bot — a first chat with no teammates has no one to delegate to', () => {
    expect(delegateHintBot([BOT], owner, 'side-1', { 'side-1': { workspaceMode: 'sessions' } })).toBeNull()
  })

  it('is silent for a session already scoped into the bots workspace', () => {
    const scopes = { 'topic-1': { workspaceMode: 'bots' as const, workspaceOwnerKey: 'bot:porter' } }

    expect(delegateHintBot([BOT], owner, 'topic-1', scopes)).toBeNull()
  })

  it('is silent for the canonical Bot Chat — title identity, not a stored pin', () => {
    // The registry row resolves by (profile, title 'Bot Chat'); a compacted
    // chat is on screen under its lineage tip, and both count.
    expect(delegateHintBot([BOT], owner, 'canon-1', {})).toBeNull()
    expect(delegateHintBot([BOT], owner, 'canon-tip', null)).toBeNull()
  })

  it('is silent for a session with no proven owner or no rostered profile', () => {
    expect(delegateHintBot([BOT], null, 'side-1', {})).toBeNull()
    expect(delegateHintBot([BOT], { connectionId: '', profile: '' }, 'side-1', {})).toBeNull()
    expect(delegateHintBot([BOT], { connectionId: 'local', profile: 'stranger' }, 'side-1', {})).toBeNull()
    expect(delegateHintBot([], owner, 'side-1', {})).toBeNull()
  })

  it("follows the owner's connection, so a same-named profile on another gateway is not the bot", () => {
    const foreign: RosterRow = { connectionId: 'ssh-box', name: 'porter' }

    expect(delegateHintBot([foreign], owner, 'side-1', {})).toBeNull()
    // An owner with no connection qualifier still matches a local-shaped row.
    expect(delegateHintBot([BOT, MATE], { connectionId: '', profile: 'porter' }, 'side-1', {})).toBe(BOT)
  })
})
