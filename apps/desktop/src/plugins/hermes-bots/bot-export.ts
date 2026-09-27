/**
 * Bot export/import (C5) — shareable bot bundles.
 *
 * A bot bundle is the core profile archive (`hermes profile export` tar.gz)
 * plus two renderer files at the archive root: the shared `desktop.json`
 * appearance overlay (from `exportProfileBundle`) and `bots.json`, a tiny
 * manifest marking the archive as a bot pack and carrying display meta
 * (title, description). Everything else — ui_meta (avatar, SOUL, enabled
 * skills, toolsets, MCP servers, cron job definitions) — already lives in
 * the profile directory and rides along automatically.
 *
 * Secrets and session data NEVER enter the bundle: the backend export
 * excludes `.env`, auth material, state DBs, and PM runtime dirs, and scrubs
 * staged text files for credential shapes. `bots.json` is descriptive only —
 * no ids beyond the profile name.
 *
 * Import is a plain profile import: the archive unpacks to a new profile,
 * whose ui_meta makes it appear on the bot roster. It must NOT switch the
 * active profile — that behavior belongs to the global Settings import —
 * so this path does not run the full core import flow.
 */

import { host, queryClient } from '@hermes/plugin-sdk'

import { ROSTER_KEY } from './data'
import { botsText } from './i18n'
import { displayName } from './labels'
import { botBackendProfileScope, botConnectionRoute } from './routing'
import type { BotMeta, RosterRow } from './types'

/** Manifest filename inside the archive root. */
export const BOT_BUNDLE_MANIFEST = 'bots.json'

export interface BotBundleManifest {
  description?: string
  exportedAt: string
  /** Marker so other surfaces can recognize a bot pack. */
  kind: 'hermes-bot'
  /** Source profile name — the bundle's identity. */
  name: string
  title?: string
}

const ARCHIVE_FILTERS = [{ extensions: ['tar.gz', 'tgz'], name: 'Hermes bot' }]

export function botBundleManifest(bot: RosterRow, meta: BotMeta | null): BotBundleManifest {
  return {
    kind: 'hermes-bot',
    name: bot.name,
    exportedAt: new Date().toISOString(),
    ...(meta?.title ? { title: meta.title } : {}),
    ...(meta?.description ? { description: meta.description } : {})
  }
}

/** Pick a save location and bundle `bot`'s profile. Returns the archive
 *  path, or null when cancelled/unsupported/failed. Remote bots export
 *  through THEIR connection's backend (the archive lands on that host's
 *  filesystem; the picker path names a location there). */
export async function exportBot(bot: RosterRow, meta: BotMeta | null): Promise<null | string> {
  const b = botsText()
  const pick = host.pickSavePath

  if (typeof pick !== 'function') {
    return null
  }

  const output = await pick({
    title: b.bot.exportBot(displayName(bot, meta)),
    defaultPath: `${bot.name}.tar.gz`,
    filters: ARCHIVE_FILTERS
  })

  if (!output) {
    return null
  }

  try {
    const route = botConnectionRoute(bot)
    const scope = botBackendProfileScope(route, bot.name)
    const profile = typeof scope === 'string' ? scope : scope.profile

    const archive = await host.exportProfileBundle(route, {
      output,
      profile,
      extraFiles: { [BOT_BUNDLE_MANIFEST]: JSON.stringify(botBundleManifest(bot, meta), null, 2) }
    })

    host.notify({ kind: 'success', message: b.bot.exported(archive) })

    return archive
  } catch (error) {
    host.notifyError?.(error, b.bot.exportFailed)

    return null
  }
}

/** Pick an archive and import it as a new bot profile. Returns the new
 *  profile name, or null when cancelled/unsupported/failed. */
export async function importBot(): Promise<null | string> {
  const b = botsText()
  const pick = host.pickOpenPaths

  if (typeof pick !== 'function') {
    return null
  }

  const paths = await pick({ title: b.bot.importBot, multiple: false, filters: ARCHIVE_FILTERS })
  const archive = paths?.[0]

  if (!archive) {
    return null
  }

  try {
    const { name } = await host.importProfileBundle(null, { archive })
    queryClient.invalidateQueries({ queryKey: ROSTER_KEY })
    host.notify({ kind: 'success', message: b.bot.imported(name) })

    return name
  } catch (error) {
    host.notifyError?.(error, b.bot.importFailed)

    return null
  }
}
