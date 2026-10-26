/**
 * Model quick-swap (bot-mode revamp C3): the roster row's "Model" submenu.
 * It reuses the editor's write path — `profiles.configure` for a pin,
 * `cli.exec … config unset model` for inherit — and routes the gateway's
 * expensive-model `confirm_required` through the shared
 * `surfaceModelSwitchConfirm` applier instead of forking the handshake.
 */

import { queryClient, surfaceModelSwitchConfirm } from '@hermes/plugin-sdk'

import { ROSTER_KEY } from './data'
import { botsText } from './i18n'
import { requestForBot } from './routing'
import type { RosterRow } from './types'

/** A concrete provider+model pick, or `inherit` to clear the pin. */
export interface BotModelPick {
  model: string
  provider: string
}

interface ModelConfigureResult {
  applied?: Record<string, boolean>
  confirm_message?: string
  confirm_required?: boolean
}

/** Pin the bot's model without opening Edit Profile. Resolves `true` once the
 *  write lands; `false` when the expensive-model confirm was declined, went
 *  stale, or failed (the dialog surfaces its own toast in that case). */
export async function applyBotModelPick(bot: RosterRow, pick: BotModelPick): Promise<boolean> {
  const result = (await requestForBot(bot, 'profiles.configure', {
    model: pick.model,
    name: bot.name,
    provider: pick.provider
  })) as ModelConfigureResult

  if (result?.confirm_required) {
    return surfaceModelSwitchConfirm({
      confirmMessage: result.confirm_message,
      failureMessage: botsText().editor.modelSwitchFailed,
      finish: () =>
        queryClient.invalidateQueries({
          queryKey: ROSTER_KEY
        }),
      model: pick.model,
      requestConfirmed: () =>
        requestForBot(bot, 'profiles.configure', {
          confirm_expensive_model: true,
          model: pick.model,
          name: bot.name,
          provider: pick.provider
        }) as Promise<ModelConfigureResult>
    })
  }

  queryClient.invalidateQueries({
    queryKey: ROSTER_KEY
  })

  return true
}

/** Back to inheriting the launch profile's model. `config unset` is the same
 *  mechanism the editor's model-unset path uses; a `profiles.configure` with
 *  empty strings would pin '' instead of clearing. */
export async function clearBotModelPick(bot: RosterRow): Promise<void> {
  await requestForBot(bot, 'cli.exec', {
    argv: ['--profile', bot.name, 'config', 'unset', 'model']
  })

  queryClient.invalidateQueries({
    queryKey: ROSTER_KEY
  })
}
