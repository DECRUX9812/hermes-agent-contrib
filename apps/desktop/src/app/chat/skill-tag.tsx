import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { menuLabelClass } from '@/components/ui/menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { $skillsByStoredId } from '@/store/session-states'

const NO_SKILLS: Record<string, string[]> = {}

/** Chip reporting the session's active skill count on its zone strip; the
 *  popover lists the names grouped by category. Indicator only — it never
 *  opens anything uninvited, and renders nothing at all while the session
 *  reports no skills (a draft, or an agent that hasn't answered
 *  `session.info` yet). */
export function SkillTag({ className, storedSessionId }: { className?: string; storedSessionId: null | string }) {
  const { t } = useI18n()

  const skills = useStoreSelector($skillsByStoredId, byId =>
    storedSessionId ? (byId[storedSessionId] ?? NO_SKILLS) : NO_SKILLS
  )

  const groups = Object.entries(skills)
  const count = groups.reduce((total, [, names]) => total + names.length, 0)

  if (count === 0) {
    return null
  }

  const label = t.profiles.skills(count)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={label}
          className={cn('pointer-events-auto shrink-0 [-webkit-app-region:no-drag]', className)}
          size="xs"
          type="button"
          variant="chip"
        >
          <Codicon name="sparkle" size="0.6875rem" />
          <span className="tabular-nums">{count}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-(--z-modal-popover) w-56" side="bottom" variant="menu">
        <div className={menuLabelClass}>{t.skills.tabSkills}</div>
        <div className="max-h-64 overflow-y-auto">
          {groups.map(([category, names]) => (
            <div key={category || 'default'}>
              {category && category !== 'general' && <div className={cn(menuLabelClass, 'pt-1.5')}>{category}</div>}
              {names.map(name => (
                <div className="truncate px-2 py-0.5 text-xs leading-5 text-(--ui-text-primary)" key={name}>
                  {name}
                </div>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
