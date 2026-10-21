import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { byRecency } from '@/lib/recent-projects'
import { $dismissedAutoProjectIds, filterVisibleProjects } from '@/store/layout'
import { $projectTree, goToProject, openFolderAsProject, projectRootCwd } from '@/store/projects'
import { $recentProjectIds } from '@/store/recent-projects'

const SHOWN = 4

/**
 * The home screen's project row (Codex / VS Code welcome): the projects you
 * were in last, one click from a new chat at their root, plus ⌘O's door.
 */
export function RecentProjects() {
  const { t } = useI18n()
  const tree = useStore($projectTree)
  const dismissed = useStore($dismissedAutoProjectIds)
  const recent = useStore($recentProjectIds)

  const projects = byRecency(
    filterVisibleProjects(tree, dismissed).filter(project => !project.isNoProject && projectRootCwd(project)),
    recent,
    project => project.id
  ).slice(0, SHOWN)

  if (projects.length === 0) {
    return null
  }

  return (
    <div className="mt-5 flex w-full min-w-0 flex-col items-center gap-2" data-slot="recent-projects">
      <span className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">{t.recentProjects.title}</span>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {projects.map(project => (
          <Tip key={project.id} label={projectRootCwd(project)}>
            <Button
              className="max-w-48 rounded-full"
              onClick={() => {
                triggerHaptic('selection')
                goToProject(project.id, { newSession: true })
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <Codicon className="opacity-70" name={project.icon || 'folder-library'} />
              <span className="truncate">{project.label}</span>
            </Button>
          </Tip>
        ))}
        <Button
          className="rounded-full text-(--ui-text-tertiary)"
          onClick={() => void openFolderAsProject()}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Codicon className="opacity-70" name="folder-opened" />
          {t.recentProjects.openFolder}
        </Button>
      </div>
    </div>
  )
}
