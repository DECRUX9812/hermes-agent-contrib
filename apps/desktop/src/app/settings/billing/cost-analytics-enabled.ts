/**
 * Spend analytics — opt-in.
 *
 * Off by default: spend rows add cost figures to Billing, and not
 * everyone wants money on screen (shared machines, screen shares). The data
 * itself is already local — it aggregates the same session.list
 * payloads the sidebar already paints; nothing is
 * sent anywhere (root AGENTS.md: no telemetry without opt-in, and there is
 * no telemetry here at all). Presentation-scoped, so the renderer owns it.
 */

import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

const KEY = 'hermes.desktop.cost-analytics.v1'

export const $costAnalyticsEnabled = atom<boolean>(typeof window === 'undefined' ? false : storedString(KEY) === 'on')

export function setCostAnalyticsEnabled(enabled: boolean): void {
  $costAnalyticsEnabled.set(enabled)
}

if (typeof window !== 'undefined') {
  $costAnalyticsEnabled.listen(enabled => persistString(KEY, enabled ? 'on' : 'off'))
}
