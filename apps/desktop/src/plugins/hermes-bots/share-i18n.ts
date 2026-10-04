/**
 * Share-card strings, registered on top of Bot Mode's bundles under the same
 * plugin id (the hire gallery's pattern): English is the floor every locale
 * falls back to.
 */

import { type PluginLocaleBundles, usePluginI18n } from '@hermes/plugin-sdk'

import { ID } from './shared'
import { bindTree } from './team-i18n'

export const SHARE_EN = {
  title: (name: string) => `Share ${name}`,
  subtitle: 'A card anyone can open: who this bot is, what it does, and how to reach it.',
  copyImage: 'Copy image',
  copiedImage: 'Card copied — paste it anywhere',
  saveImage: 'Save image',
  copyInvite: 'Copy invite',
  copiedInvite: 'Invite copied',
  exportFile: 'Export bot file…',
  exportHint: 'The bot file lets someone run their own copy — no secrets or chat history inside.',
  askMe: 'Ask me',
  scanToChat: 'Scan to chat',
  footer: 'Made with Hermes Agent',
  failed: 'Could not make the card'
}

export const SHARE_LOCALES: PluginLocaleBundles = { en: { share: SHARE_EN } }

export type ShareText = typeof SHARE_EN

export function useShareText(): ShareText {
  const t = usePluginI18n(ID)

  return bindTree(t, SHARE_EN, 'share') as ShareText
}
