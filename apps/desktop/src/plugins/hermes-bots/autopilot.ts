/**
 * Autopilot — one-click routines that keep a bot working on your behalf
 * between conversations (the "always-on agent" idea): a morning brief, a
 * weekly review, a quiet watch. Each preset only PREFILLS the routine dialog;
 * the person reviews the words and the time before anything is scheduled.
 */

import { type AutopilotText } from './autopilot-i18n'

export interface RoutinePreset {
  /** Where runs land: the bot's own chat (it reads and replies) or history only. */
  deliverToChat: boolean
  instruction: string
  schedule: {
    freq: 'daily' | 'interval' | 'weekdays' | 'weekly'
    intervalN?: string
    intervalUnit?: string
    time?: string
    weekday?: string
  }
  title: string
}

export type AutopilotId = 'brief' | 'review' | 'watch'

export const AUTOPILOT_ICONS: Record<AutopilotId, string> = { brief: 'coffee', review: 'checklist', watch: 'eye' }

export function autopilotPresets(a: AutopilotText): Array<{ id: AutopilotId; label: string; preset: RoutinePreset }> {
  return [
    {
      id: 'brief',
      label: a.brief.label,
      preset: {
        deliverToChat: true,
        instruction: a.brief.instruction,
        schedule: { freq: 'weekdays', time: '8:0' },
        title: a.brief.label
      }
    },
    {
      id: 'review',
      label: a.review.label,
      preset: {
        deliverToChat: true,
        instruction: a.review.instruction,
        schedule: { freq: 'weekly', time: '16:0', weekday: '5' },
        title: a.review.label
      }
    },
    {
      id: 'watch',
      label: a.watch.label,
      preset: {
        deliverToChat: false,
        instruction: a.watch.instruction,
        schedule: { freq: 'interval', intervalN: '2', intervalUnit: 'h' },
        title: a.watch.label
      }
    }
  ]
}
