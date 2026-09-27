/**
 * Model quick-swap submenu (bot-mode revamp C3): the roster row's "Model ▸"
 * entry — the model picker's catalog in menu form, so a swap takes one
 * right-click instead of an Edit Profile trip.
 *
 * Providers are nested submenus (a flat provider×model list would swamp the
 * menu); the current pin carries the checkbox check. The items component
 * mounts only while the submenu is open — Radix unmounts closed subcontent —
 * so the catalog and the current pin fetch lazily per open, never per roster
 * paint.
 */

import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  host,
  useQuery
} from '@hermes/plugin-sdk'

import { useBots } from './i18n'
import { providerModelIds, useModelOptions } from './model-picker'
import { applyBotModelPick, clearBotModelPick } from './model-swap'
import { requestForBot, resolveBotConnectionRoute } from './routing'
import { ID } from './shared'
import type { RosterRow } from './types'

/** The profile's current pin, as `profiles.describe` reports it. */
interface BotModelCurrentResult {
  model?: { default?: string; provider?: string }
}

export function BotModelMenu({ bot }: { bot: RosterRow }) {
  const b = useBots()

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{b.bot.modelMenu}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <BotModelMenuItems bot={bot} />
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

function BotModelMenuItems({ bot }: { bot: RosterRow }) {
  const b = useBots()
  const orphaned = resolveBotConnectionRoute(bot)?.status === 'owner_removed'
  const { data, isLoading, error } = useModelOptions(bot)

  const { data: current } = useQuery<BotModelCurrentResult>({
    enabled: !orphaned,
    queryFn: () => requestForBot(bot, 'profiles.describe', { name: bot.name }) as Promise<BotModelCurrentResult>,
    queryKey: [ID, 'bot-model-current', bot.name, bot.connectionId || 'local'],
    // The pin changes rarely and Edit Profile invalidates the roster; a 30s
    // staleness window keeps a re-opened menu from re-fetching.
    retry: false,
    staleTime: 30000
  })

  const providers = (data?.providers || []).filter(p => p && p.slug)
  const curProvider = current?.model?.provider || ''
  const curModel = current?.model?.default || ''

  const pick = (provider: string, model: string) => {
    void applyBotModelPick(bot, { model, provider })
      .then(applied => {
        if (applied) {
          host.notify({ kind: 'success', message: b.bot.modelSetTo(model) })
        }
      })
      .catch(err => host.notifyError?.(err, b.editor.modelSwitchFailed))
  }

  const inherit = () => {
    void clearBotModelPick(bot)
      .then(() => host.notify({ kind: 'success', message: b.bot.modelInheritSet }))
      .catch(err => host.notifyError?.(err, b.editor.modelSwitchFailed))
  }

  if (orphaned || error || (!isLoading && !providers.length)) {
    return <ContextMenuItem disabled>{b.bot.modelUnavailable}</ContextMenuItem>
  }

  return (
    <>
      <ContextMenuCheckboxItem checked={!curModel} onSelect={inherit}>
        {b.editor.inheritLaunch}
      </ContextMenuCheckboxItem>
      {providers.length ? <ContextMenuSeparator /> : null}
      {providers.map(provider => {
        const models = providerModelIds(provider)

        return (
          <ContextMenuSub key={provider.slug}>
            <ContextMenuSubTrigger>
              {provider.name ? `${provider.name} (${provider.slug})` : provider.slug}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {models.map(model => (
                <ContextMenuCheckboxItem
                  checked={curProvider === provider.slug && curModel === model}
                  key={model}
                  onSelect={() => pick(provider.slug, model)}
                >
                  {model}
                </ContextMenuCheckboxItem>
              ))}
              {!models.length ? <ContextMenuItem disabled>{b.bot.modelUnavailable}</ContextMenuItem> : null}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )
      })}
      {isLoading ? <ContextMenuItem disabled>{b.bot.modelLoading}</ContextMenuItem> : null}
    </>
  )
}
