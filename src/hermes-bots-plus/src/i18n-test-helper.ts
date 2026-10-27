/**
 * Resolve a Bot Mode message key against the plugin's own `en` bundle.
 *
 * Tests that render Bot Mode components stub `usePluginI18n` with this instead
 * of registering the bundle for real: registration normally happens in
 * `ctx.register`, and the registry lives behind an app-internal module a plugin
 * (or its tests) may not import.
 */

import { AUTOPILOT_LOCALES } from './autopilot-i18n'
import { CONTEXT_PANEL_LOCALES } from './context-panel-i18n'
import { BOTS_LOCALES } from './i18n'
import { LIVE_VIEW_LOCALES } from './live-view-i18n'
import { SHARE_LOCALES } from './share-i18n'
import { TOOL_CARDS_LOCALES } from './tool-cards-i18n'

/** Add-on bundles registered beside Bot Mode's own under the same plugin id;
 *  English is their only locale, so every locale falls back to it here too. */
const ADDON_EN = {
  ...AUTOPILOT_LOCALES.en,
  ...CONTEXT_PANEL_LOCALES.en,
  ...LIVE_VIEW_LOCALES.en,
  ...SHARE_LOCALES.en,
  ...TOOL_CARDS_LOCALES.en
}

/** The same resolver against another shipped locale, for a test that has to
 *  tell a catalog string from an English literal that happens to match `en`. */
export function translateBotsIn(locale: keyof typeof BOTS_LOCALES) {
  return (key: string, ...args: unknown[]): string => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
        { ...ADDON_EN, ...BOTS_LOCALES[locale] }
      )

    if (typeof value === 'function') {
      return String((value as (...params: unknown[]) => string)(...args))
    }

    return typeof value === 'string' ? value : key
  }
}

export const translateBots = translateBotsIn('en')
