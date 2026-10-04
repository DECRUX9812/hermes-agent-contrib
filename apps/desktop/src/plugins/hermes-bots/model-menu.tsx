/**
 * Model quick-swap menu (bot-mode revamp C3/G7): the model picker's catalog in
 * menu form — as the roster row's "Model ▸" submenu, and as the chat header's
 * model chip dropdown. A swap takes one click instead of an Edit Profile trip.
 *
 * Providers are nested submenus (a flat provider×model list would swamp the
 * menu); the current pin carries the checkbox check. The items component
 * mounts only while the submenu is open — Radix unmounts closed subcontent —
 * so the catalog and the current pin fetch lazily per open, never per roster
 * paint.
 *
 * The items are menu-kit-parametrized: the SAME markup renders under the
 * ContextMenu primitives (roster row) and the DropdownMenu primitives (header
 * chip) — the two Radix roots share their item/sub prop surface, so only the
 * wrapper changes.
 */

import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  host,
  useQuery
} from '@hermes/plugin-sdk'
import type { ElementType } from 'react'

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

/** The menu primitives a render of the items runs on — ContextMenu for the
 *  roster row submenu, DropdownMenu for the header chip's dropdown. */
export interface BotModelMenuKit {
  CheckboxItem: ElementType
  Item: ElementType
  Separator: ElementType
  Sub: ElementType
  SubContent: ElementType
  SubTrigger: ElementType
}

const CONTEXT_MENU_KIT: BotModelMenuKit = {
  CheckboxItem: ContextMenuCheckboxItem,
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubContent: ContextMenuSubContent,
  SubTrigger: ContextMenuSubTrigger
}

const DROPDOWN_MENU_KIT: BotModelMenuKit = {
  CheckboxItem: DropdownMenuCheckboxItem,
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubContent: DropdownMenuSubContent,
  SubTrigger: DropdownMenuSubTrigger
}

/** The profile's current model pin — one cached `profiles.describe` per bot,
 *  shared by the row submenu, the header chip, and the roster card (same
 *  query key, 30s staleness). */
export function useBotModelCurrent(bot: RosterRow): {
  model: string
  orphaned: boolean
  provider: string
} {
  const orphaned = resolveBotConnectionRoute(bot)?.status === 'owner_removed'

  const { data: current } = useQuery<BotModelCurrentResult>({
    enabled: !orphaned,
    queryFn: () => requestForBot(bot, 'profiles.describe', { name: bot.name }) as Promise<BotModelCurrentResult>,
    queryKey: [ID, 'bot-model-current', bot.name, bot.connectionId || 'local'],
    // The pin changes rarely and Edit Profile invalidates the roster; a 30s
    // staleness window keeps a re-opened menu from re-fetching.
    retry: false,
    staleTime: 30000
  })

  return {
    model: current?.model?.default || '',
    orphaned,
    provider: current?.model?.provider || ''
  }
}

export function BotModelMenu({ bot }: { bot: RosterRow }) {
  const b = useBots()

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{b.bot.modelMenu}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <BotModelMenuItems bot={bot} kit={CONTEXT_MENU_KIT} />
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

/** G7 — the header chip: the bot's pinned model name as a small button; the
 *  click opens the same quick-swap menu as a dropdown. An unpinned bot reads
 *  'default' — the inherit row in the menu is what clears it back there. */
export function BotModelChip({ bot }: { bot: RosterRow }) {
  const b = useBots()
  const { model } = useBotModelCurrent(bot)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={b.bot.modelMenu}
          className="pointer-events-auto inline-flex max-w-56 items-center gap-1 rounded-md border border-(--ui-stroke-secondary) px-1.5 py-0.5 font-mono text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-(--ui-text-secondary)"
          type="button"
        >
          <span className="min-w-0 truncate">{model || b.bot.modelDefault}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4}>
        <BotModelMenuItems bot={bot} kit={DROPDOWN_MENU_KIT} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function BotModelMenuItems({ bot, kit }: { bot: RosterRow; kit: BotModelMenuKit }) {
  const b = useBots()
  const { Item, CheckboxItem, Separator, Sub, SubTrigger, SubContent } = kit
  const { model: curModel, orphaned, provider: curProvider } = useBotModelCurrent(bot)
  const { data, isLoading, error } = useModelOptions(bot)

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

  if (orphaned || error || (!isLoading && !(data?.providers || []).filter(p => p && p.slug).length)) {
    return <Item disabled>{b.bot.modelUnavailable}</Item>
  }

  const providers = (data?.providers || []).filter(p => p && p.slug)

  return (
    <>
      <CheckboxItem checked={!curModel} onSelect={inherit}>
        {b.editor.inheritLaunch}
      </CheckboxItem>
      {providers.length ? <Separator /> : null}
      {providers.map(provider => {
        const models = providerModelIds(provider)

        return (
          <Sub key={provider.slug}>
            <SubTrigger>{provider.name ? `${provider.name} (${provider.slug})` : provider.slug}</SubTrigger>
            <SubContent>
              {models.map(model => (
                <CheckboxItem
                  checked={curProvider === provider.slug && curModel === model}
                  key={model}
                  onSelect={() => pick(provider.slug, model)}
                >
                  {model}
                </CheckboxItem>
              ))}
              {!models.length ? <Item disabled>{b.bot.modelUnavailable}</Item> : null}
            </SubContent>
          </Sub>
        )
      })}
      {isLoading ? <Item disabled>{b.bot.modelLoading}</Item> : null}
    </>
  )
}
