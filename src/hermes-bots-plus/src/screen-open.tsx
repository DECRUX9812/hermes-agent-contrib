/**
 * Open a bot's Screen. Screens live in the Hermes Browser now (one tab per
 * bot beside the user's pages, in the workspace tab or the floating window);
 * a second open refocuses the existing tab.
 */

import { host } from '@hermes/plugin-sdk'

import { BROWSER_PANE, browserAvailable, openBotInBrowser } from './browser/open'
import { botsText } from './i18n'
import type { BotMeta, RosterRow } from './types'

export function screenPaneId(_bot: RosterRow): string {
  return BROWSER_PANE
}

export function openBotScreen(bot: RosterRow, meta?: BotMeta | null): void {
  if (!browserAvailable()) {
    host.notify({ kind: 'info', message: botsText().screen.openNeedsUpdate })

    return
  }

  openBotInBrowser(bot, meta ?? null)
}
