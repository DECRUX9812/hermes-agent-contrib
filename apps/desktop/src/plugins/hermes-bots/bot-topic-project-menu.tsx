import {
  atom,
  Button,
  Codicon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  host,
  type PluginProject,
  Tip,
  useValue
} from '@hermes/plugin-sdk'

import { newBotChat } from './data'
import { useBots } from './i18n'
import type { RosterRow } from './types'

const EMPTY = atom<PluginProject[]>([])

/** "New topic in a project…": point a bot at a codebase without leaving its
 *  identity — the topic is a fresh bot-powered chat whose folder is the pick.
 *  Local bots only (a project path is this machine's); hidden with no projects
 *  or on a desktop too old to publish them. */
export function BotTopicProjectMenu({ bot }: { bot: RosterRow }) {
  const b = useBots()
  const projects = useValue(host.state?.projects ?? EMPTY) || []

  if (bot.remoteSource || !projects.length) {
    return null
  }

  return (
    <DropdownMenu>
      <Tip label={b.bot.newTopicInProject}>
        <DropdownMenuTrigger asChild>
          <Button aria-label={b.bot.newTopicInProject} size="icon-xs" variant="ghost">
            <Codicon name="folder" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="start">
        {projects.map(project => (
          <DropdownMenuItem key={project.id} onSelect={() => newBotChat(bot, { cwd: project.cwd })}>
            <Codicon name="folder" />
            {project.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
