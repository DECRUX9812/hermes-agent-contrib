import type { LiveAction } from '@/lib/live-actions'

export interface MissionControlCard {
  runtimeId: string
  storedSessionId: string
  title: string
  latestAction: LiveAction | null
}
