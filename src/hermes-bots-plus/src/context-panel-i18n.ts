/**
 * Strings for the bot rail's context panel: the context-window gauge and the
 * per-turn step timeline under it. English is the floor; other locales fall
 * back to it until translated.
 */

import { type PluginLocaleBundles, usePluginI18n } from '@hermes/plugin-sdk'

import { i18nId } from './shared'
import { bindTree } from './team-i18n'

export const CONTEXT_PANEL_EN = {
  title: 'Context window',
  reading: (percent: number, used: string, max: string) => `${percent}% · ${used} / ${max}`,
  meterLabel: (percent: number) => `Context window ${percent}% used`,
  waiting: 'No reading yet',
  estimated: 'Estimate',
  estimatedHint: 'Counted from the transcript, not reported by the model provider',
  compacted: (count: number) => (count === 1 ? 'Summarised once' : `Summarised ${count}×`),
  compactedHint: 'Older turns were folded into a summary to free up room',
  nearlyFull: 'Almost full',
  nearlyFullHint: 'Hermes will soon fold older turns into a summary',
  steps: 'Steps',
  showSteps: 'Show what happened in each turn',
  hideSteps: 'Hide the turn timeline',
  loading: 'Reading this chat…',
  failed: 'Could not read the steps for this chat.',
  retry: 'Retry',
  none: 'Nothing has run in this chat yet.',
  overview: (turns: number, steps: number) =>
    `${turns === 1 ? '1 turn' : `${turns} turns`} · ${steps === 1 ? '1 step' : `${steps} steps`}`,
  turn: (index: number) => `Turn ${index}`,
  stepCount: (count: number) => (count === 1 ? '1 step' : `${count} steps`),
  answered: 'Answered',
  working: 'Still working',
  noAnswer: 'No answer saved',
  slowest: (name: string, took: string) => `Longest wait: ${name}, ${took}`,
  tookHint: 'Time since the step before it finished, thinking included'
}

export const CONTEXT_PANEL_LOCALES: PluginLocaleBundles = { en: { contextPanel: CONTEXT_PANEL_EN } }

export type ContextPanelText = typeof CONTEXT_PANEL_EN

export function useContextPanelText(): ContextPanelText {
  const t = usePluginI18n(i18nId())

  return bindTree(t, CONTEXT_PANEL_EN, 'contextPanel') as ContextPanelText
}
