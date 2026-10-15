/**
 * Focus pieces for the room's one-composer flow.
 *
 * GroupComposerContext — the strip above the single bottom composer saying who
 *   hears the next message in a new thread.
 */

import { useBots } from './i18n'

export interface GroupComposerContextProps {
  /** Who hears a plain message in a new thread: the lead's name, or '' for everyone. */
  leadName: string
}

export function GroupComposerContext({ leadName }: GroupComposerContextProps) {
  const b = useBots()

  return (
    <div className="truncate px-1 pb-1.5 text-ui-2xs text-fg-subtle" data-testid="group-composer-context">
      <span>{leadName ? b.group.composerNewThreadTo(leadName) : b.group.composerNewThreadEveryone}</span>
    </div>
  )
}
