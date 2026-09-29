import { useStore } from '@nanostores/react'

import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $projectScope, ALL_PROJECTS, exitProjectScope } from '@/store/project-scope'
import { $projectTree, goToProject, openProjectCreate } from '@/store/projects'

/**
 * The project you are in, one click away (the Codex / Antigravity pattern:
 * workspace first, then its conversations). Projects already existed behind
 * the sidebar's grouping toggle and filter menu; this surfaces the same
 * actions — enter a project (`goToProject`, a pure scope switch that never
 * opens a session), leave it (`exitProjectScope`), or start one — as a
 * switcher at the top of the rail.
 */
export function ProjectSwitcher({ className }: { className?: string }) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const scope = useStore($projectScope)
  const tree = useStore($projectTree)
  const projects = tree.filter(project => !project.archived)
  const current = scope === ALL_PROJECTS ? null : (projects.find(project => project.id === scope) ?? null)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'group/project-switcher flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.8125rem] transition-colors',
            'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground data-[state=open]:bg-(--chrome-action-hover)'
          )}
          data-slot="project-switcher"
          type="button"
        >
          <span
            aria-hidden
            className="grid size-5 shrink-0 place-items-center rounded-(--control-icon-radius) bg-(--ui-bg-tertiary) text-(--ui-text-tertiary)"
            style={current?.color ? { backgroundColor: current.color, color: 'white' } : undefined}
          >
            <Codicon name={current ? 'folder-opened' : 'folder-library'} size="0.75rem" />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{current ? current.label : p.sectionLabel}</span>
          <Codicon
            className={cn('shrink-0 text-(--ui-text-quaternary)', className)}
            name="chevron-down"
            size="0.75rem"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
        <DropdownMenuItem onSelect={() => exitProjectScope()}>
          <Codicon name="folder-library" size="0.8rem" />
          <span className="min-w-0 flex-1 truncate">{p.showAllSessions}</span>
          {current ? null : <Codicon name="check" size="0.8rem" />}
        </DropdownMenuItem>
        {projects.length ? <DropdownMenuSeparator /> : null}
        {projects.map(project => (
          <DropdownMenuItem key={project.id} onSelect={() => goToProject(project.id)}>
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-(--ui-text-quaternary)"
              style={project.color ? { backgroundColor: project.color } : undefined}
            />
            <span className="min-w-0 flex-1 truncate">{project.label}</span>
            {current?.id === project.id ? <Codicon name="check" size="0.8rem" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openProjectCreate()}>
          <Codicon name="new-folder" size="0.8rem" />
          {p.newButton}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
