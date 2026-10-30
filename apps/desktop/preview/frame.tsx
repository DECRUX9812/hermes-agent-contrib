/**
 * DEV ONLY — full-frame layout preview.
 *
 * Not a copy of the app's components: a stand-in that reuses the REAL row
 * geometry constants and the app's own data-slot hooks, so layout decisions
 * (reading measure, rail widths, band rhythm) can be judged at 1:1 before they
 * are wired into the live tree.
 *
 *   http://127.0.0.1:5176/preview/frame.html?theme=classic
 */
import '@/styles.css'

import { createRoot } from 'react-dom/client'

import { SIDEBAR_ROW_GAP, SIDEBAR_ROW_MIN_H, SIDEBAR_ROW_PAD_TRAIL, SIDEBAR_ROW_PAD_X } from '@/app/chat/sidebar/row-geometry'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { PaneTab, PaneTabLabel, PaneTabStrip } from '@/components/ui/pane-tab'
import { cn } from '@/lib/utils'

import { paintTheme } from './theme'

paintTheme()

const SESSIONS = [
  { title: 'Complete Hermes in-app browser', age: '2h', active: true },
  { title: 'Fix duplicate message bug and', age: '3h' },
  { title: 'Swarm cockpit pass', age: '5h' },
  { title: 'Top bar chrome redesign', age: 'yesterday' },
  { title: 'Desktop scroll feel', age: 'yesterday' },
  { title: 'Kanban lane reconciliation', age: '2d' }
]

function Band() {
  return (
    <div className="flex h-[34px] shrink-0 items-stretch bg-(--pane-tab-strip-bg) shadow-[inset_0_-1px_0_var(--ui-stroke-quaternary)]">
      <div className="flex w-[237px] shrink-0 items-stretch border-r border-(--ui-stroke-quaternary)">
        <div className="flex shrink-0 items-center pl-2.5">
          <Button
            aria-label="Toggle sidebar"
            className="bg-transparent text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background)"
            size="icon-titlebar"
            variant="ghost"
          >
            <Codicon name="layout-sidebar-left" size="14px" />
          </Button>
        </div>
        <PaneTabStrip className="min-w-0 flex-1" segmented titlebar>
          <PaneTab active segmented>
            <PaneTabLabel>Sessions</PaneTabLabel>
          </PaneTab>
          <PaneTab active={false} segmented>
            <PaneTabLabel>Bots</PaneTabLabel>
          </PaneTab>
        </PaneTabStrip>
      </div>
      <PaneTabStrip className="min-w-0 flex-1" titlebar>
        <PaneTab active>
          <span className="flex shrink-0 items-center pl-2.5 -mr-0.5">
            <span className="block size-[6px] rounded-full bg-(--theme-primary)" />
          </span>
          <PaneTabLabel>Complete Hermes in-app browser</PaneTabLabel>
        </PaneTab>
        <PaneTab active={false} onClose={() => {}}>
          <span className="flex shrink-0 items-center pl-2.5 -mr-0.5">
            <span className="block size-[6px] rounded-full bg-(--ui-orange)" />
          </span>
          <PaneTabLabel>Fix duplicate message bug</PaneTabLabel>
        </PaneTab>
        <span className="flex shrink-0 items-center pl-0.5">
          <Button aria-label="New tab" className="bg-transparent text-(--ui-text-tertiary)" size="icon-xs" variant="ghost">
            <Codicon name="add" size="14px" />
          </Button>
        </span>
      </PaneTabStrip>
      <div className="flex shrink-0 items-center gap-0.5 pr-3 pl-1">
        <span aria-hidden className="mx-1 h-3.5 w-px bg-(--ui-stroke-quaternary)" />
        {['globe', 'gear', 'split-horizontal', 'arrow-swap', 'layout-sidebar-right'].map(n => (
          <Button aria-label={n} className="text-(--ui-text-tertiary)" key={n} size="icon-titlebar" variant="ghost">
            <Codicon name={n} size="14px" />
          </Button>
        ))}
      </div>
    </div>
  )
}

function Sidebar() {
  return (
    <aside className="flex w-[237px] shrink-0 flex-col border-r border-(--ui-stroke-quaternary) bg-(--ui-sidebar-surface-background)">
      <div className={cn('mt-1 flex h-8 items-center gap-1.5 px-2 text-[12px] font-medium text-(--ui-text-secondary)')}>
        <Codicon name="add" size="13px" />
        <span className="flex-1">New session</span>
        <span className="text-[9.5px] tracking-wide text-(--ui-text-quaternary)">Ctrl N</span>
      </div>
      <div className="mt-3 px-3 pb-1 text-[10px] font-semibold tracking-[0.09em] text-(--ui-text-quaternary) uppercase">Today</div>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2">
        {SESSIONS.map(s => (
          <div
            className={cn(
              'group flex cursor-default items-center rounded-[5px]',
              SIDEBAR_ROW_MIN_H,
              SIDEBAR_ROW_PAD_X,
              SIDEBAR_ROW_PAD_TRAIL,
              SIDEBAR_ROW_GAP,
              s.active ? 'bg-(--ui-row-active-background)' : 'hover:bg-(--ui-row-hover-background)'
            )}
            key={s.title}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-(--ui-text-quaternary)" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-(--ui-text-secondary)">{s.title}</span>
            <span className="shrink-0 text-[10px] text-(--ui-text-quaternary) opacity-0 group-hover:opacity-100">{s.age}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex h-8 items-center gap-2 border-t border-(--ui-stroke-quaternary) px-3 text-[11px] text-(--ui-text-tertiary)">
        <span className="size-4 rounded-full bg-(--ui-bg-tertiary)" />
        <span className="flex-1 truncate">ritesh</span>
        <Codicon name="settings-gear" size="12px" />
      </div>
    </aside>
  )
}

function Prose() {
  return (
    <>
      <p>
        The layout is mostly a spacing problem: the transcript runs full-bleed, so a line of prose on a wide window measures
        far past the point where the eye can track back to the next line.
      </p>
      <p>
        Capping the reading column fixes that without shrinking anything else — tool cards keep their room, and the composer
        sits on the same measure so the eye travels one width.
      </p>
      <ul>
        <li>One measure for prose, the composer, and system rows.</li>
        <li>Tool output allowed to exceed it, scrolled inside its own card.</li>
      </ul>
    </>
  )
}

function Transcript() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-slot="thread">
      {/* Mirrors the real structure: rows live inside the measured content
          column, which the app caps with --composer-width. */}
      <div className="flex flex-col gap-5 py-6" data-slot="aui_thread-viewport">
        <div className="mx-auto flex w-full flex-col gap-5" data-slot="aui_thread-content">
          <div className="flex w-full items-start gap-3" data-slot="aui_assistant-message-root">
            <span className="mt-0.5 size-5 shrink-0 rounded-full bg-(--ui-bg-secondary)" />
            <div className="min-w-0 text-[13.5px] leading-6 text-foreground max-w-full" data-slot="aui_assistant-message-content">
              <div className="aui-md">
                <Prose />
              </div>
            </div>
          </div>

          <div className="w-full" data-slot="aui_turn-activity">
            <div className="rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background)">
              <div className="flex h-7 items-center gap-2 border-b border-(--ui-stroke-quaternary) px-2.5 text-[11px] text-(--ui-text-tertiary)">
                <Codicon name="terminal" size="12px" />
                <span className="flex-1 truncate">Ran pnpm vitest run --project ui</span>
                <span className="text-(--ui-green)">passed</span>
              </div>
              <pre className="overflow-x-auto px-3 py-2 text-[11px] leading-5 text-(--ui-text-secondary)">
                {'Test Files  4 failed (4)\n      Tests  5 failed | 3 passed (8)'}
              </pre>
            </div>
          </div>

          <div className="flex w-full justify-end" data-slot="aui_user-message-root">
            <div className="max-w-[min(86%,34rem)] rounded-xl border border-(--ui-stroke-quaternary) bg-(--ui-chat-bubble-background) px-3.5 py-2 text-[13.5px] leading-6">
              can you make the whole layout nicer, and smooth
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Composer() {
  return (
    <div className="mx-auto flex shrink-0 justify-center" data-slot="composer-dock">
      <div
        className="w-full rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background) shadow-[var(--shadow-sm)]"
        data-slot="composer-surface"
      >
        <div className="px-3 pt-2.5 pb-1 text-[13.5px] text-(--ui-text-quaternary)">Message Hermes…</div>
        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <Button aria-label="Attach" className="text-(--ui-text-tertiary)" size="icon-xs" variant="ghost">
            <Codicon name="attach" size="13px" />
          </Button>
          <span className="ml-auto text-[10px] text-(--ui-text-quaternary)">Enter to send</span>
          <Button className="ml-1 h-6 px-2.5 text-[11.5px]" size="sm" variant="default">
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

function App() {
  return (
    <div className="flex h-screen w-full flex-col bg-(--ui-editor-surface-background) text-foreground">
      <Band />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-(--ui-stroke-quaternary) px-4">
            <span className="truncate text-[12.5px] font-medium">Complete Hermes in-app browser</span>
            <span className="rounded-full border border-(--ui-stroke-quaternary) px-1.5 py-0.5 text-[10px] text-(--ui-text-tertiary)">
              sonnet-4.5
            </span>
          </div>
          <Transcript />
          <Composer />
        </main>
      </div>
      <div className="flex h-5 shrink-0 items-center gap-2 border-t border-(--ui-stroke-quaternary) bg-(--ui-sidebar-surface-background) px-2 text-[10.5px] text-(--ui-text-tertiary)">
        <span>default</span>
        <span className="opacity-40">·</span>
        <span>gateway ok</span>
        <span className="ml-auto">12.4k ctx</span>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
