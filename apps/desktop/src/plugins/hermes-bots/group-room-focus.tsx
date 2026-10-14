/**
 * Focus pieces for the room's one-composer flow.
 *
 * GroupComposerContext — the strip above the single bottom composer saying
 *   where the next message goes: a new thread (and who hears it), or a reply
 *   in a named thread with a one-click way out. Replaces the reply boxes that
 *   used to open in the middle of the log.
 */

import { Button, cn, Codicon, Tip } from '@hermes/plugin-sdk'

import { useBots } from './i18n'

export interface GroupComposerContextProps {
  /** Who hears a plain message in a new thread: the lead's name, or '' for everyone. */
  leadName: string
  onClear: () => void
  /** The thread a reply continues; null composes a new thread. */
  replyTitle: null | string
}

export function GroupComposerContext({ leadName, onClear, replyTitle }: GroupComposerContextProps) {
  const b = useBots()

  return (
    <div className="truncate px-1 pb-1.5 text-ui-2xs text-fg-subtle" data-testid="group-composer-context">
      <span>
        {replyTitle
          ? b.group.composerReplyingIn(replyTitle)
          : leadName
            ? b.group.composerNewThreadTo(leadName)
            : b.group.composerNewThreadEveryone}
      </span>
      {replyTitle ? (
        <>
          {' '}
          <Button aria-label={b.group.composerStartNew} onClick={onClear} size="inline" variant="link">
            {b.group.composerStartNew}
          </Button>
        </>
      ) : null}
    </div>
  )
}
