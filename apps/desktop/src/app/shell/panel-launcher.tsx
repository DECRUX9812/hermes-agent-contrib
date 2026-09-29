import { useStore } from '@nanostores/react'
import { atom, type ReadableAtom } from 'nanostores'

import { toggleTerminalPane } from '@/app/right-sidebar/terminal/reveal-focus'
import { toggleLayoutEditMode } from '@/components/pane-shell/edit-mode'
import { findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $layoutTree, $paneVisible, dockPaneBeside, isPaneVisible } from '@/components/pane-shell/tree/store'
import { Codicon } from '@/components/ui/codicon'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import type { Translations } from '@/i18n/types'
import { triggerHaptic } from '@/lib/haptics'
import { useKeybindHint } from '@/lib/keybinds/use-keybind-hint'
import { cn } from '@/lib/utils'
import { ARTIFACTS_PANE_ID, toggleArtifactsRail } from '@/store/artifact-rail'
import { $showsAdvancedChrome } from '@/store/interface-mode'
import { toggleFileBrowserOpen } from '@/store/layout'
import { $liveOpen, LIVE_PANE_ID, toggleLivePane } from '@/store/live-activity'
import { $previewTabs, toggleBrowserTab } from '@/store/preview'
import { PREVIEW_TILE_PREFIX } from '@/store/preview-explicit'
import { openFolderAsProject } from '@/store/projects'
import { REVIEW_PANE_ID, toggleReview } from '@/store/review'
import { $currentCwd } from '@/store/session'

import { $terminalTakeover } from '../right-sidebar/store'

/** Whether the Panels popover is open (the titlebar button toggles it). */
export const $panelLauncherOpen = atom(false)

export function togglePanelLauncher() {
  $panelLauncherOpen.set(!$panelLauncherOpen.get())
}

type PanelId = 'artifacts' | 'browser' | 'changes' | 'files' | 'live' | 'terminal'

interface PanelSpec {
  /** Keybind whose live binding the row shows. */
  actionId?: string
  /** Advanced-only surfaces (the terminal) leave Simple's list. */
  advanced?: boolean
  icon: string
  id: PanelId
  /** Needs a project folder: disabled (with the reason) in a bare chat. */
  needsProject?: boolean
  /** Layout-tree pane id, for side-by-side placement (dynamic panes omit it). */
  pane?: string
  toggle: () => void
}

/**
 * Everything that can sit beside the chat, as one table: the Codex-style
 * "what do you want next to this conversation" menu. Each row flips the SAME
 * toggle its shortcut, palette entry and tab already use, so the panel lands
 * in its own zone and several open side by side.
 */
const PANELS: readonly PanelSpec[] = [
  { actionId: 'view.showFiles', icon: 'files', id: 'files', needsProject: true, pane: 'files', toggle: toggleFileBrowserOpen },
  {
    actionId: 'view.toggleReview',
    icon: 'git-compare',
    id: 'changes',
    needsProject: true,
    pane: REVIEW_PANE_ID,
    toggle: () => toggleReview($currentCwd.get().trim() || null)
  },
  { actionId: 'view.showBrowser', icon: 'globe', id: 'browser', toggle: toggleBrowserTab },
  { actionId: 'view.showTerminal', advanced: true, icon: 'terminal', id: 'terminal', toggle: toggleTerminalPane },
  { icon: 'pulse', id: 'live', pane: LIVE_PANE_ID, toggle: toggleLivePane },
  { icon: 'package', id: 'artifacts', pane: ARTIFACTS_PANE_ID, toggle: toggleArtifactsRail }
]

/**
 * Turn a panel on so it lands BESIDE the panels already showing, never on top
 * of them: the right-rail panes share a zone by default, so the second one
 * would stack as a tab and hide the first. When the pane arrives in a zone
 * where it covers a panel that was on, dock it next to that panel instead
 * (dockPaneBeside respects a pane the user has placed themselves).
 */
function turnOnBeside(spec: PanelSpec) {
  const shown = new Set(PANELS.flatMap(({ pane }) => (pane && isPaneVisible(pane) ? [pane] : [])))

  spec.toggle()

  const pane = spec.pane

  if (!pane) {
    return
  }

  requestAnimationFrame(() => {
    const tree = $layoutTree.get()
    const group = tree ? findGroupOfPane(tree, pane) : null
    const covered = group?.panes.find(id => id !== pane && shown.has(id))

    if (covered && isPaneVisible(pane)) {
      dockPaneBeside(pane, covered)
    }
  })
}

const browserPaneId = (tabs: ReturnType<typeof $previewTabs.get>) => {
  const browser = tabs.find(tab => tab.target.kind === 'url')

  return browser ? `${PREVIEW_TILE_PREFIX}:${browser.id}` : ''
}

const NEVER: ReadableAtom<boolean> = atom(false)

/** Live on/off per panel — the on-screen truth, not a stored preference. */
function usePanelOn(id: PanelId): boolean {
  const browserId = browserPaneId(useStore($previewTabs))
  const files = useStore($paneVisible('files'))
  const review = useStore($paneVisible(REVIEW_PANE_ID))
  const browser = useStore(browserId ? $paneVisible(browserId) : NEVER)
  const terminal = useStore($terminalTakeover)
  const liveOpen = useStore($liveOpen)
  const liveShown = useStore($paneVisible(LIVE_PANE_ID))
  const live = liveOpen && liveShown
  const artifacts = useStore($paneVisible(ARTIFACTS_PANE_ID))

  return { artifacts, browser, changes: review, files, live, terminal }[id]
}

function PanelRow({ copy, hasProject, spec }: { copy: Translations['panels']; hasProject: boolean; spec: PanelSpec }) {
  const on = usePanelOn(spec.id)
  const hint = useKeybindHint(spec.actionId ?? '')
  const blocked = Boolean(spec.needsProject && !hasProject)
  const text = copy.items[spec.id]

  return (
    <button
      aria-pressed={on}
      className={cn(
        'group/panel flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors disabled:cursor-default',
        on ? 'bg-(--ui-accent)/8' : 'hover:bg-(--ui-control-hover-background)',
        blocked && 'opacity-55'
      )}
      data-panel={spec.id}
      disabled={blocked}
      onClick={() => {
        triggerHaptic('selection')

        if (on) {
          spec.toggle()
        } else {
          turnOnBeside(spec)
        }
      }}
      type="button"
    >
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-lg transition-colors',
          on
            ? 'bg-(--ui-accent) text-white shadow-[0_4px_12px_-4px_var(--ui-accent)]'
            : 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary) group-hover/panel:text-foreground'
        )}
      >
        <Codicon name={spec.icon} size="0.9375rem" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] font-medium text-foreground">{text.label}</span>
        <span className="block text-[0.6875rem] leading-snug text-(--ui-text-tertiary)">
          {blocked ? copy.needsProject : text.description}
        </span>
      </span>
      {hint && (
        <kbd className="shrink-0 rounded-md bg-(--ui-bg-tertiary) px-1.5 py-0.5 font-sans text-[0.625rem] text-(--ui-text-tertiary)">
          {hint}
        </kbd>
      )}
      <span
        aria-hidden
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors',
          on ? 'bg-(--ui-accent)' : 'bg-(--ui-stroke-secondary)'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-[left] duration-200 motion-reduce:transition-none',
            on ? 'left-3.5' : 'left-0.5'
          )}
        />
      </span>
    </button>
  )
}

/**
 * The Panels popover: what can sit beside the chat, each one a switch. Rows
 * stay open on click so you can pick several and see them arrive side by
 * side; "Arrange…" hands over to the layout editor for anything finer.
 */
export function PanelLauncher() {
  const { t } = useI18n()
  const p = t.panels
  const open = useStore($panelLauncherOpen)
  const advanced = useStore($showsAdvancedChrome)
  const hasProject = Boolean(useStore($currentCwd).trim())
  const rows = PANELS.filter(spec => advanced || !spec.advanced)

  return (
    <Popover onOpenChange={next => $panelLauncherOpen.set(next)} open={open}>
      <PopoverAnchor asChild>
        <span aria-hidden className="pointer-events-none fixed top-[calc(var(--titlebar-height,2.25rem)+0.25rem)] right-3 size-px" />
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-[24rem] rounded-2xl p-2 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.35)]"
        data-slot="panel-launcher"
        sideOffset={6}
      >
        <div className="px-2.5 pb-1.5 pt-1">
          <p className="text-[0.8125rem] font-semibold text-foreground">{p.title}</p>
          <p className="text-[0.6875rem] text-(--ui-text-tertiary)">{p.subtitle}</p>
        </div>
        <div className="flex flex-col gap-0.5">
          {rows.map(spec => (
            <PanelRow copy={p} hasProject={hasProject} key={spec.id} spec={spec} />
          ))}
        </div>
        <div className="mt-1.5 flex items-center gap-1 border-t border-(--ui-stroke-tertiary) px-1 pt-1.5">
          {!hasProject && (
            <button
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.75rem] text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
              onClick={() => {
                $panelLauncherOpen.set(false)
                void openFolderAsProject()
              }}
              type="button"
            >
              <Codicon name="folder-opened" size="0.8125rem" />
              {p.openFolder}
            </button>
          )}
          <button
            className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.75rem] text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
            onClick={() => {
              $panelLauncherOpen.set(false)
              toggleLayoutEditMode()
            }}
            type="button"
          >
            <Codicon name="layout" size="0.8125rem" />
            {p.arrange}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The right zone with no project behind it: instead of a dead "no project"
 * label, the ways forward — open a folder, or turn on a panel that works
 * without one (browser, live activity, artifacts).
 */
export function BesideChatChooser() {
  const { t } = useI18n()
  const p = t.panels
  const r = t.rightSidebar
  const rows = PANELS.filter(spec => !spec.needsProject && !spec.advanced)

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-4 py-6" data-slot="beside-chat-chooser">
      <div className="px-1">
        <p className="text-[0.8125rem] font-semibold text-foreground">{r.noProjectOpen}</p>
        <p className="text-[0.75rem] leading-snug text-(--ui-text-tertiary)">{p.subtitle}</p>
      </div>
      <button
        className="flex items-center gap-3 rounded-xl bg-(--ui-accent) px-3 py-2.5 text-left text-white shadow-[0_8px_20px_-10px_var(--ui-accent)] transition-transform hover:-translate-y-px motion-reduce:transition-none"
        onClick={() => void openFolderAsProject()}
        type="button"
      >
        <Codicon name="folder-opened" size="1rem" />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.8125rem] font-medium">{r.openFolder}</span>
          <span className="block text-[0.6875rem] opacity-80">{p.items.files.description}</span>
        </span>
      </button>
      <div className="flex flex-col gap-0.5">
        {rows.map(spec => (
          <PanelRow copy={p} hasProject={false} key={spec.id} spec={spec} />
        ))}
      </div>
    </div>
  )
}
