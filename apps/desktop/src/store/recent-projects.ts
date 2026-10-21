import { computed } from 'nanostores'

import { persistentAtom } from '@/lib/persisted'
import { touchRecent } from '@/lib/recent-projects'

import { $activeGatewayProfile, normalizeProfileKey } from './profile'

// Project ids belong to one profile's projects.db, so recency is kept per
// profile: switching profile shows that profile's recent work, not a list of
// ids its backend has never heard of.
const $recentByProfile = persistentAtom<Record<string, string[]>>('hermes.desktop.recentProjects', {})

export const $recentProjectIds = computed(
  [$recentByProfile, $activeGatewayProfile],
  (byProfile, profile) => byProfile[normalizeProfileKey(profile)] ?? []
)

/** Record that the user entered `id` (sidebar, palette, ⌘O, home). */
export function noteProjectOpened(id: string): void {
  const profile = normalizeProfileKey($activeGatewayProfile.get())
  const byProfile = $recentByProfile.get()

  if (byProfile[profile]?.[0] === id) {
    return
  }

  $recentByProfile.set({ ...byProfile, [profile]: touchRecent(byProfile[profile] ?? [], id) })
}
