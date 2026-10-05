/** Shared wording for the Activity feed and its detail view. */

import type { ActivityStep, ActivityTask } from '@hermes/plugin-sdk'

import type { BotsText } from './i18n'

export function clockTime(epochSeconds: number): string {
  return epochSeconds
    ? new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : ''
}

export function stepLabel(step: ActivityStep, a: BotsText['activity'], tense: 'doing' | 'verbs' = 'verbs'): string {
  const verb = a[tense][step.verb]

  return step.subject ? `${verb} ${step.subject}` : step.verb === 'used' ? `${verb} ${step.action.tool}` : verb
}

/** What the bot is doing right now, for the hero's live line: the running
 *  step, else "Thinking" while the turn is live with no call in flight. */
export function activityNow(tasks: readonly ActivityTask[], a: BotsText['activity']): null | string {
  const live = tasks.at(-1)

  if (live?.status !== 'running') {
    return null
  }

  const step = live.steps.find(s => s.action.status === 'running')

  return step ? stepLabel(step, a, 'doing') : a.thinking
}
