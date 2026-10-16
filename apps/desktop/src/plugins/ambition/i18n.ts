/**
 * Plugin-scoped i18n for Ambition — bundles shipped under the plugin id via
 * ctx.i18n.register, never touching core en.ts. English first; more locales
 * can drop into AMBITION_LOCALES without touching the components.
 */

import { type PluginLocaleBundles, type PluginTranslate, usePluginI18n } from '@hermes/plugin-sdk'

export const PLUGIN_ID = 'ambition'

// A type alias, not an interface: the bundle is assigned to PluginMessages,
// which needs the implicit index signature only a type literal carries.
type AmbitionMessages = {
  accept: string
  altitude: string
  cardUnavailable: string
  commandDesc: string
  commandOff: string
  commandOn: string
  depth: string
  evidence: string
  evidenceHide: string
  judge: string
  measured: string
  modeOff: string
  modeOffFailed: string
  modeOn: string
  modeOnFailed: string
  needsChat: string
  needsFromYou: string
  offCommand: string
  onCommand: string
  range: string
  saveFailed: string
  smaller: string
  statusAccepted: string
  statusDeclined: string
  statusEdited: string
  statusProposed: string
  target: string
  targetEditedAfterJudging: string
  unavailableTitle: string
  verdictFail: string
  verdictInconclusive: string
  verdictPass: string
  widensScope: string
}

export const en: AmbitionMessages = {
  accept: 'Accept',
  altitude: 'Altitude',
  cardUnavailable: 'The Ambition card is not available.',
  commandDesc: 'Turn Ambition mode on or off for this chat',
  commandOff: 'Ambition off for this chat.',
  commandOn: 'Ambition on for this chat.',
  depth: 'Depth',
  evidence: 'Evidence',
  evidenceHide: 'Hide evidence',
  judge: 'Judge',
  measured: 'Measured',
  modeOff: 'Ambition off for this chat: your next message runs without the card.',
  modeOffFailed: 'Could not turn Ambition off.',
  modeOn: 'Ambition on for this chat: your next substantial ask gets an editable card before the work starts.',
  modeOnFailed: 'Could not turn Ambition on.',
  needsChat: 'Ambition needs a chat to scope to — send a message first.',
  needsFromYou: 'Needs from you',
  offCommand: 'Ambition: Turn off for this chat',
  onCommand: 'Ambition: Turn on for this chat',
  range: 'Range',
  saveFailed: 'The edit did not save.',
  smaller: 'Smaller',
  statusAccepted: 'accepted',
  statusDeclined: 'declined',
  statusEdited: 'edited',
  statusProposed: 'proposed',
  target: 'Target',
  targetEditedAfterJudging: 'target edited after judging',
  unavailableTitle: 'Ambition needs the ambition plugin',
  verdictFail: 'Fail',
  verdictInconclusive: 'Inconclusive',
  verdictPass: 'Pass',
  widensScope: 'Widens scope'
}

export const AMBITION_LOCALES: PluginLocaleBundles = { en }

/** Reactive translator bound to this plugin's bundles. */
export function useAmbitionI18n(): PluginTranslate {
  return usePluginI18n(PLUGIN_ID)
}

export type { AmbitionMessages }
