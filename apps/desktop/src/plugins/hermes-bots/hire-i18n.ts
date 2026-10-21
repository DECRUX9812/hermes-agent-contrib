/**
 * Hire gallery strings, registered on top of Bot Mode's bundles under the same plugin id
 * (the Team page's pattern, `team-i18n.ts`): English is the floor every locale falls back
 * to, so the gallery ships complete in `en` without growing the core Bot Mode message shape.
 */

import { type PluginLocaleBundles, usePluginI18n } from '@hermes/plugin-sdk'

import { ID } from './shared'
import { bindTree } from './team-i18n'

export const HIRE_EN = {
  title: 'Hire a teammate',
  subtitle: 'Pick a starter, describe one, or hire a whole team.',
  search: 'Search teammates',
  featured: 'Featured',
  category: {
    research: 'Research',
    coding: 'Coding',
    writing: 'Writing',
    creative: 'Creative',
    ops: 'Operations',
    review: 'Review'
  },
  packsNav: 'Team packs',
  yours: 'Yours',
  importBot: 'Import a bot…',
  describeLabel: 'Describe the teammate you want',
  describePlaceholder: 'e.g. “a skeptical code reviewer who catches edge cases”',
  describeAction: 'Draft it',
  packsHeading: 'Team packs — hire several at once',
  teammatesHeading: 'Teammates',
  noMatch: (query: string) => `No teammate matches “${query}”.`,
  seatCount: (n: number) => (n === 1 ? '1 seat' : `${n} seats`),
  drafted: 'Drafted from your description',
  startsWith: 'Starts with',
  firstThings: 'Things to ask first',
  brain: 'Brain',
  brainDefault: 'Your default model',
  brainHint: 'Change it any time from the bot’s header.',
  name: 'Name',
  hire: (name: string) => `Hire ${name}`,
  customize: 'Customize instructions, skills and tools…',
  hirePack: (name: string) => `Hire ${name}`,
  packHint: 'Creates the team with open seats. Fill each seat with a bot on the Team page.',
  packCreated: (name: string) => `${name} is ready — fill its seats`,
  packFailed: 'Could not create the team',
  blankTitle: 'Start from scratch',
  blankBody: 'A blank bot with your default model and skills.',
  pickOne: 'Pick a teammate to see what it does.',
  back: 'Back'
}

export const HIRE_LOCALES: PluginLocaleBundles = { en: { hire: HIRE_EN } }

export type HireText = typeof HIRE_EN

export function useHireText(): HireText {
  const t = usePluginI18n(ID)

  return bindTree(t, HIRE_EN, 'hire') as HireText
}
