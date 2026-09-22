import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { rescopeConnectionScopedStores } from '@/lib/connection-scoped'
import { $activeGatewayProfile } from '@/store/profile'

import { $agentReactions, $localReactions, clearLiveReactions, recordAgentReaction, setLocalReaction } from './reactions-local'

const AGENT_REACTION = { at: 1, author: 'agent' as const, emoji: '👍' }

function seedOverlays() {
  recordAgentReaction(42, [AGENT_REACTION])
  setLocalReaction('1700000000-0-assistant', '❤️')
}

beforeEach(() => {
  clearLiveReactions()
})

afterEach(() => {
  clearLiveReactions()
  $activeGatewayProfile.set('default')
  rescopeConnectionScopedStores(null)
})

describe('live reaction overlays (#118748)', () => {
  it('paints recorded entries until the row-id space changes', () => {
    seedOverlays()

    expect($agentReactions.get()[42]).toEqual([AGENT_REACTION])
    expect($localReactions.get()['1700000000-0-assistant']?.[0]?.emoji).toBe('❤️')
  })

  it('a live profile swap wipes both overlays — the next profile is a different state.db', () => {
    seedOverlays()

    $activeGatewayProfile.set('other-profile')

    expect($agentReactions.get()).toEqual({})
    expect($localReactions.get()).toEqual({})
  })

  it('a connection-scope republish wipes both overlays even when the bare profile is unchanged', () => {
    seedOverlays()

    rescopeConnectionScopedStores({ baseUrl: 'https://remote.example', mode: 'remote', profile: 'default' })

    expect($agentReactions.get()).toEqual({})
    expect($localReactions.get()).toEqual({})
  })
})
