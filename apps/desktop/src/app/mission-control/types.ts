import type { SessionLiveGroup } from '@/store/session-live'

export interface OverviewCardData {
  storedSessionId: string
  title: string
  group: SessionLiveGroup
}
