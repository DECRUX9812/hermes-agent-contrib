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
    <div
      className={cn(
        'mb-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[0.6875rem]',
        replyTitle ? 'bg-(--ui-accent)/10 text-(--ui-accent)' : 'text-(--ui-text-tertiary)'
      )}
      data-testid="group-composer-context"
    >
      <Codicon className="shrink-0" name={replyTitle ? 'reply' : 'add'} />
      <span className="min-w-0 flex-1 truncate">
        {replyTitle
          ? b.group.composerReplyingIn(replyTitle)
          : leadName
            ? b.group.composerNewThreadTo(leadName)
            : b.group.composerNewThreadEveryone}
      </span>
      {replyTitle ? (
        <Tip label={b.group.composerStartNew}>
          <Button
            aria-label={b.group.composerStartNew}
            className="h-5 shrink-0 px-1.5 text-[0.625rem]"
            onClick={onClear}
            size="sm"
            variant="ghost"
          >
            <Codicon name="close" />
            {b.group.composerStartNew}
          </Button>
        </Tip>
      ) : null}
    </div>
  )
}
