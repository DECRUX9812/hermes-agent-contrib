import { atom, computed } from 'nanostores'

import { $chatZoneCount } from '@/app/chat/split-session'

export const $broadcastOn = atom(false)

export const $broadcastAvailable = computed($chatZoneCount, count => count >= 2)

export function setBroadcastOn(on: boolean): void {
  $broadcastOn.set(on)
}

/** Broadcast only means something across two or more panes; with fewer it turns itself off. */
export function reconcileBroadcastWithZones(zoneCount: number): void {
  if (zoneCount < 2) {
    $broadcastOn.set(false)
  }
}

// The store owns the reset: any zone-count change below two panes switches
// broadcast off, no matter which component (if any) is mounted.
$chatZoneCount.listen(reconcileBroadcastWithZones)
