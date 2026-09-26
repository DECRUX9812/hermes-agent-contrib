import { Tip } from '@/components/ui/tooltip'
import { profileColorSoft } from '@/lib/profile-color'
import { useSessionSlice } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { $sessionTags, type SessionTag, sessionTagKey } from '@/store/session-tags'

/**
 * A user-assigned session tag as a label chip — the tag's own soft swatch fill
 * with its color on the text, matching the kanban badge / profile glyph color
 * language. Inert on purpose: the row underneath owns the click.
 */
export function SessionTagChip({ className, tag }: { className?: string; tag: SessionTag }) {
  return (
    <Tip label={tag.label}>
      <span
        className={cn(
          'inline-block max-w-24 shrink-0 truncate rounded-full px-1.5 py-px text-[0.5625rem] leading-3 font-medium',
          className
        )}
        style={{ backgroundColor: profileColorSoft(tag.color, 22), color: tag.color }}
      >
        {tag.label}
      </span>
    </Tip>
  )
}

/** A session's tag chips for a sidebar row. Subscribes to just this session's
 *  slice of the tag map so a tag edit repaints only the rows carrying it. */
export function SessionTagChips({ profile, sessionId }: { profile?: null | string; sessionId: string }) {
  const tags = useSessionSlice($sessionTags, sessionTagKey(profile, sessionId))

  if (tags.length === 0) {
    return null
  }

  return (
    <span className="flex min-w-0 shrink-0 items-center gap-0.5">
      {tags.slice(0, 2).map(tag => (
        <SessionTagChip key={tag.label.toLowerCase()} tag={tag} />
      ))}
      {tags.length > 2 && (
        <Tip
          label={tags
            .slice(2)
            .map(tag => tag.label)
            .join(', ')}
        >
          <span className="shrink-0 text-[0.5625rem] leading-none text-(--ui-text-tertiary)">+{tags.length - 2}</span>
        </Tip>
      )}
    </span>
  )
}
