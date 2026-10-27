/**
 * The pieces every Bot Mode module needs and no single module can own: the
 * plugin id, the `PluginContext` `register()` captures, and the open
 * generation the bot-open and group-open click paths race on.
 *
 * The mutable ones live behind accessor pairs because an imported binding
 * cannot be reassigned — `register()` publishes the context once with
 * `setPluginCtx`, and every reader goes through `getPluginCtx()`.
 */

import { atom, type PluginContext } from '@hermes/plugin-sdk'

export const ID = 'hermes-bots'

/** Captured in register() so components can reach plugin storage. */
let pluginCtx: PluginContext | null = null

export function getPluginCtx(): PluginContext | null {
  return pluginCtx
}

export function setPluginCtx(ctx: PluginContext | null) {
  pluginCtx = ctx
}

/**
 * The id locale bundles are registered under — the plugin's OWN `plugin.id`,
 * not the storage id `ID`.
 *
 * The overlay build publishes this plugin as `hermes-bots-plus` so it can sit
 * beside the bundled Bot Mode, while storage keys stay on `hermes-bots` so the
 * user's Bot Chats, avatars and group rooms read back unchanged. `ctx.i18n`
 * registers under `plugin.id`, so a translator built from `ID` resolves nothing
 * and every label falls back to its raw key (`team.title`). Derive the locale
 * id from `ctx.source` (`plugin:<id>`) instead of hardcoding it, so a rename
 * cannot silently break the strings again.
 */
export function i18nId(): string {
  const source = pluginCtx?.source ?? ''

  return source.startsWith('plugin:') ? source.slice('plugin:'.length) : ID
}

/** A contribution's pane id. `register` scopes panes by `plugin.id` too, so
 *  the same `ID`-vs-`plugin.id` split applies: build pane ids from i18nId(). */
export function paneId(local: string): string {
  return `${i18nId()}:${local}`
}

/** Monotonic open generation. A bot open and a group open supersede each
 *  other, so both bump it and both compare against it — and they no longer
 *  live in the same module. */
let botOpenGeneration = 0

/** Cold open still in flight. Published after the fronted-tab miss and before
 *  source prep. Not chat ownership — never route or highlight from this key.
 *  The generation guards the clear: a superseded flight never releases its
 *  successor's mark. A bump (another open, a group, or Sessions) drops it. */
export const $pendingBotOpen = atom<null | { generation: number; key: string }>(null)

export function getBotOpenGeneration() {
  return botOpenGeneration
}

/** Invalidate every in-flight open; returns the generation that now owns it. */
export function bumpBotOpenGeneration() {
  $pendingBotOpen.set(null)

  return ++botOpenGeneration
}
