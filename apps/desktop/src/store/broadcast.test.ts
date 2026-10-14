import { afterEach, describe, expect, it } from 'vitest'

import { group, split } from '@/components/pane-shell/tree/model'
import { $layoutTree } from '@/components/pane-shell/tree/store'

import { $broadcastAvailable, $broadcastOn, reconcileBroadcastWithZones, setBroadcastOn } from './broadcast'

afterEach(() => {
  $layoutTree.set(null)
  setBroadcastOn(false)
})

describe('broadcast availability', () => {
  it('needs at least two visible chat zones', () => {
    $layoutTree.set(group(['workspace']))
    expect($broadcastAvailable.get()).toBe(false)

    $layoutTree.set(split('row', [group(['workspace']), group(['session-tile:a'])]))
    expect($broadcastAvailable.get()).toBe(true)
  })
})

describe('reconcileBroadcastWithZones', () => {
  it('turns broadcast off once fewer than two zones remain', () => {
    setBroadcastOn(true)

    reconcileBroadcastWithZones(2)
    expect($broadcastOn.get()).toBe(true)

    reconcileBroadcastWithZones(1)
    expect($broadcastOn.get()).toBe(false)
  })
})
