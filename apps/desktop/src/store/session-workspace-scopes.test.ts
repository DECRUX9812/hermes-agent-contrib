/**
 * `$sessionWorkspaceScopes` — the one map answering "which workspace bucket
 * does this session sit in" for a reader that doesn't know which surface
 * holds the chat.
 *
 * Two producers file the same answer under different keys: a tiled session
 * carries its scope on the tile record (openSessionTile stamps it), a session
 * in MAIN has no tile so its scope is remembered in `$botChatScopes` by
 * setSessionTileWorkspaceScope. The merged atom must cover both, and a tile's
 * own record must win over a stale remembered entry — the surface the
 * session is actually on is the authority.
 */

import { beforeEach, describe, expect, it } from 'vitest'

const { $botChatScopes, $sessionTiles, $sessionWorkspaceScopes, setSessionTileWorkspaceScope } = await import(
  './session-states'
)

const botScope = { workspaceMode: 'bots' as const, workspaceOwnerKey: 'bot:alpha' }

beforeEach(() => {
  $sessionTiles.set([])
  $botChatScopes.set({})
})

describe('the merged workspace-scope map', () => {
  it('serves the remembered scope for a session with no tile', () => {
    setSessionTileWorkspaceScope('stored-main', botScope)

    expect($sessionWorkspaceScopes.get()['stored-main']?.workspaceMode).toBe('bots')
    expect($sessionWorkspaceScopes.get()['stored-main']?.workspaceOwnerKey).toBe('bot:alpha')
  })

  it('serves the tile record for a tiled session', () => {
    $sessionTiles.set([
      {
        runtimeId: 'runtime-1',
        storedSessionId: 'stored-tile',
        workspaceMode: 'bots',
        workspaceOwnerKey: 'bot:beta'
      } as never
    ])

    expect($sessionWorkspaceScopes.get()['stored-tile']?.workspaceMode).toBe('bots')
    expect($sessionWorkspaceScopes.get()['stored-tile']?.workspaceOwnerKey).toBe('bot:beta')
  })

  it('prefers the tile record over a remembered entry for the same session', () => {
    // The session moved surfaces: remembered under one owner, now tiled under
    // another. The tile — where it actually is — is the answer.
    setSessionTileWorkspaceScope('stored-both', botScope)
    $sessionTiles.set([
      {
        runtimeId: 'runtime-2',
        storedSessionId: 'stored-both',
        workspaceMode: 'bots',
        workspaceOwnerKey: 'bot:beta'
      } as never
    ])

    expect($sessionWorkspaceScopes.get()['stored-both']?.workspaceOwnerKey).toBe('bot:beta')
  })

  it('is silent for a session no producer has scoped', () => {
    expect($sessionWorkspaceScopes.get()['never-seen']).toBeUndefined()
  })
})
