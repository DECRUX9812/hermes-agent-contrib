/**
 * Autopilot strings, registered on top of Bot Mode's bundles under the same
 * plugin id (the hire gallery's pattern). English is the floor.
 */

import { type PluginLocaleBundles, usePluginI18n } from '@hermes/plugin-sdk'

import { ID } from './shared'
import { bindTree } from './team-i18n'

export const AUTOPILOT_EN = {
  heading: (name: string) => `Put ${name} on autopilot`,
  hint: 'Pick one to review the words and the time before it is scheduled.',
  custom: 'Write your own…',
  brief: {
    label: 'Morning brief',
    instruction:
      'Brief me for the day: what changed since yesterday in my projects and messages, what is due today, and the one thing you would do first. Keep it under 10 lines.'
  },
  review: {
    label: 'Weekly review',
    instruction:
      'Review this week: what got done, what slipped and why, and propose my top 3 priorities for next week.'
  },
  watch: {
    label: 'Keep watch',
    instruction:
      'Check for anything that needs my attention: failed jobs, blocked tasks, messages waiting on me. List only what needs action; if nothing does, reply "All clear".'
  }
}

export const AUTOPILOT_LOCALES: PluginLocaleBundles = { en: { autopilot: AUTOPILOT_EN } }

export type AutopilotText = typeof AUTOPILOT_EN

export function useAutopilotText(): AutopilotText {
  const t = usePluginI18n(ID)

  return bindTree(t, AUTOPILOT_EN, 'autopilot') as AutopilotText
}
