/**
 * The delegation hint card (bot-pane UX): one dismissible chip over the
 * composer on a session that runs ON A BOT PROFILE outside the bot's
 * workspace — a plain working chat, where Bot Mode's delegation can't
 * reach it. The action re-opens the SAME session scoped under the bot
 * (`workspaceMode: 'bots'` + its owner key), which is what makes a chat a
 * bot topic; nothing is minted and nothing is titled, so the session keeps
 * its history and stays listed.
 *
 * Mounted in the uniform `composer.top` slot so it covers the main chat and
 * every tile, reading its own surface's stored id off useSessionView — the
 * same subscription BotInboundCards makes. Detection lives in
 * bot-delegate-hint.ts; dismissal rides the G9 tips store under tip id
 * 'topic-delegate', so the card asks once per bot per device.
 */

import { Codicon, host, useSessionView, useValue } from '@hermes/plugin-sdk'

import { DELEGATE_HINT_TIP_ID, delegateHintBot } from './bot-delegate-hint'
import { $dismissedBotTips, dismissBotTip } from './bot-tips'
import { $lastRoster, botSelectionKey } from './data'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botConnectionRoute, botWorkspaceOwnerKey } from './routing'

export function BotDelegateHint() {
  const b = useBots()
  const view = useSessionView()
  const storedId = String(useValue(view.$storedId) || '')
  const roster = useValue($lastRoster)
  const scopes = useValue(host.state.sessionWorkspaceScopes)
  const dismissed = useValue($dismissedBotTips)
  const bot = delegateHintBot(roster, host.sessionOwner(storedId), storedId, scopes)

  if (!bot) {
    return null
  }

  const key = botSelectionKey(bot)

  if (key && (dismissed[key] || []).includes(DELEGATE_HINT_TIP_ID)) {
    return null
  }

  const dismiss = () => {
    if (key) {
      dismissBotTip(key, DELEGATE_HINT_TIP_ID)
    }
  }

  const openAsTopic = () => {
    let route = null

    try {
      route = botConnectionRoute(bot)
    } catch {
      // An orphaned row degrades to a plain re-scope: the chat still joins
      // the bot's workspace under its name key, it just can't route to a
      // specific connection.
    }

    void host.openSession(storedId, {
      ...(route ? { route } : {}),
      profile: bot.name,
      workspaceMode: 'bots',
      workspaceOwnerKey: botWorkspaceOwnerKey(bot)
    })
    dismiss()
  }

  return (
    <div className="flex w-full flex-col gap-1 px-1" data-slot="bot_delegate_hint">
      <div className="flex items-center gap-2.5 rounded-lg border border-(--dt-composer-ring)/25 bg-accent/12 px-3 py-2 text-left">
        <Codicon className="shrink-0 text-[0.8rem] text-(--ui-text-tertiary)" name="mention" />
        <p className="m-0 min-w-0 flex-1 text-[0.72rem] leading-snug text-muted-foreground/90">
          {b.hint.delegate(displayName(bot))}
        </p>
        <button
          className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[0.7rem] font-medium text-(--ui-accent-primary, var(--primary)) transition-colors hover:bg-accent/40"
          onClick={openAsTopic}
          type="button"
        >
          {b.hint.openTopic}
        </button>
        <button
          aria-label={b.tips.dismiss}
          className="flex shrink-0 cursor-pointer items-center text-[0.7rem] text-(--ui-text-quaternary) transition-colors hover:text-(--ui-text-secondary)"
          onClick={dismiss}
          type="button"
        >
          <Codicon name="close" />
        </button>
      </div>
    </div>
  )
}
