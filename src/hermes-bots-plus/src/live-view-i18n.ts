/**
 * Strings for the inline browser live view on Bot Chat tool cards. English is
 * the floor; other locales fall back to it until translated.
 */

import { type PluginLocaleBundles, usePluginI18n } from '@hermes/plugin-sdk'

import { i18nId } from './shared'
import { bindTree } from './team-i18n'

export const LIVE_VIEW_EN = {
  expand: 'Open screenshot in the preview',
  live: 'Live',
  waiting: 'Waiting for the first screenshot…',
  shotLabel: (host: string, step: number) => (host ? `${host} · step ${step}` : `Screenshot · step ${step}`)
}

export const LIVE_VIEW_LOCALES: PluginLocaleBundles = { en: { liveView: LIVE_VIEW_EN } }

export type LiveViewText = typeof LIVE_VIEW_EN

export function useLiveViewText(): LiveViewText {
  const t = usePluginI18n(i18nId())

  return bindTree(t, LIVE_VIEW_EN, 'liveView') as LiveViewText
}
