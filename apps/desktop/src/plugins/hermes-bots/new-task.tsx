/**
 * "New task" — the pane-level affordance for parallel work per bot. It delegates
 * to `newBotChat`, which spawns a side-chat for this profile in a second session
 * tile (the pooled backend multiplexes sessions per profile). It never creates,
 * opens, or renames the canonical "Bot Chat" — that identity stays title-resolved.
 */

import { Button, Codicon, Tip } from '@hermes/plugin-sdk'

import { newBotChat } from './data'
import { useBots } from './i18n'
import type { RosterRow } from './types'

export function NewTaskButton({ bot }: { bot: RosterRow }) {
  const b = useBots()

  return (
    <Tip label={b.bot.newTask}>
      <Button aria-label={b.bot.newTask} onClick={() => newBotChat(bot)} size="icon-xs" variant="ghost">
        <Codicon name="comment-add" />
      </Button>
    </Tip>
  )
}
