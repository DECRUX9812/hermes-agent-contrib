/**
 * Side Pages strings (bot-mode c1), registered beside Bot Mode's bundles
 * under the same plugin id. English is the floor every locale falls back to.
 */

import { type PluginLocaleBundles, usePluginI18n } from '@hermes/plugin-sdk'

import { i18nId } from './shared'
import { bindTree } from './team-i18n'

export const SIDE_PAGES_EN = {
  chip: (n: number) => (n === 1 ? 'Page · 1' : `Pages · ${n}`),
  chipHint: 'Show pages from this chat',
  panelLabel: 'Pages from this chat',
  listLabel: 'Pages',
  open: 'Open',
  copy: 'Copy',
  copied: 'Copied',
  download: 'Download',
  close: 'Close',
  missing: 'This page is not in the chat anymore',
  kind: {
    html: 'Web page',
    markdown: 'Report',
    svg: 'Graphic'
  }
}

export const SIDE_PAGES_LOCALES: PluginLocaleBundles = { en: { sidePages: SIDE_PAGES_EN } }

export type SidePagesText = typeof SIDE_PAGES_EN

export function useSidePagesText(): SidePagesText {
  const t = usePluginI18n(i18nId())

  return bindTree(t, SIDE_PAGES_EN, 'sidePages') as SidePagesText
}
