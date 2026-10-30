/**
 * Top-bar preview harness — DEV ONLY.
 *
 * Renders the real `PaneTab` / `PaneTabStrip` primitives (not a copy of their
 * markup) inside a hand-built approximation of the shell, at the app's real
 * heights, so the chrome can be judged on pixels while it is redesigned.
 *
 *   http://127.0.0.1:5176/preview/topbar.html
 *
 * It talks to no backend: every tab is mock data. Nothing here ships — the file
 * is not an input to the app build.
 */
import '@/styles.css'

import { createRoot } from 'react-dom/client'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { PaneTab, PaneTabLabel, PaneTabStrip } from '@/components/ui/pane-tab'
import { cn } from '@/lib/utils'
import { classicTheme, githubTheme, nousTheme } from '@/themes/presets'
import { DEFAULT_TYPOGRAPHY } from '@/themes/presets'

const THEMES: Record<string, typeof nousTheme> = { classic: classicTheme, github: githubTheme, nous: nousTheme }

const SYSTEM_SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

/** The app paints these seeds from its ThemeProvider; the harness paints the same. */
function paintTheme() {
  const root = document.documentElement
  const params = new URLSearchParams(window.location.search)
  const theme = THEMES[params.get('theme') || 'nous'] ?? nousTheme
  const c = theme.colors
  const typo = { ...DEFAULT_TYPOGRAPHY, ...theme.typography }
  root.dataset.hermesTheme = theme.name
  root.dataset.hermesMode = 'light'
  root.style.setProperty('color-scheme', 'light')

  const vars: Record<string, string> = {
    '--theme-foreground': c.foreground,
    '--theme-primary': c.primary,
    '--theme-secondary': c.secondary,
    '--theme-accent-soft': c.accent,
    '--theme-midground': c.midground ?? c.ring,
    '--theme-warm': c.primary,
    '--theme-background-seed': c.background,
    '--theme-sidebar-seed': c.sidebarBackground ?? c.background,
    '--theme-card-seed': c.card,
    '--theme-elevated-seed': c.popover,
    '--theme-bubble-seed': c.userBubble ?? c.popover,
    '--dt-primary-foreground': c.primaryForeground,
    '--dt-secondary-foreground': c.secondaryForeground,
    '--dt-accent-foreground': c.accentForeground,
    '--dt-border': c.border,
    '--dt-input': c.input,
    '--dt-ring': c.ring,
    '--dt-base-size': typo.baseSize ?? '15px',
    '--dt-line-height': String(typo.lineHeight ?? 1.55),
    '--dt-letter-spacing': typo.letterSpacing ?? '0em',
    '--dt-font-sans': typo.fontSans || SYSTEM_SANS,
    '--dt-font-mono': typo.fontMono
  }

  for (const [k, v] of Object.entries(vars)) {root.style.setProperty(k, v)}

  if (window.location.search.includes('dark')) {
    root.classList.add('dark')
    root.dataset.hermesMode = 'dark'
    root.style.setProperty('color-scheme', 'dark')
  }
}

paintTheme()

function Dot({ tone }: { tone: 'action' | 'attention' | 'idle' }) {
  return (
    <span className="flex shrink-0 items-center pl-2.5 -mr-0.5">
      <span
        className={cn(
          'block size-[6px] rounded-full',
          tone === 'action' && 'bg-(--theme-primary)',
          tone === 'attention' && 'bg-(--ui-orange)',
          tone === 'idle' && 'bg-(--ui-text-quaternary)'
        )}
      />
    </span>
  )
}

function Tab({
  active,
  closeable = true,
  label,
  tone = 'idle'
}: {
  active?: boolean
  closeable?: boolean
  label: string
  tone?: 'action' | 'attention' | 'idle'
}) {
  return (
    <PaneTab
      active={active}
      aria-selected={active}
      onClose={closeable ? () => {} : undefined}
      role="tab"
      style={{ cursor: 'grab' }}
    >
      <Dot tone={tone} />
      <PaneTabLabel>{label}</PaneTabLabel>
    </PaneTab>
  )
}

function ToolGlyph({ name, label }: { name: string; label: string }) {
  return (
    <Button
      aria-label={label}
      className="bg-transparent text-(--ui-text-tertiary) select-none hover:bg-(--ui-control-hover-background) hover:text-(--ui-text-primary)"
      size="icon-titlebar"
      variant="ghost"
    >
      <Codicon name={name} size="14px" />
    </Button>
  )
}

function Sidebar() {
  return (
    <div className="flex w-[264px] shrink-0 flex-col border-r border-(--ui-stroke-quaternary) bg-(--ui-sidebar-surface-background)">
      <div className="mt-1 flex h-8 items-center gap-2 px-2.5 text-[12px] font-medium text-(--ui-text-secondary)">
        <Codicon name="add" size="13px" />
        <span className="flex-1">New session</span>
        <span className="flex items-center gap-1 text-[10px] text-(--ui-text-quaternary)">
          <kbd className="rounded-[4px] border border-(--ui-stroke-quaternary) px-1 py-0.5">Ctrl</kbd>
          <kbd className="rounded-[4px] border border-(--ui-stroke-quaternary) px-1 py-0.5">N</kbd>
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-px px-1.5">
        {['Fix duplicate message bug and', 'Complete Hermes in-app browser', 'Swarm cockpit pass'].map(row => (
          <div className="truncate rounded-md px-2 py-1.5 text-[12.5px] text-(--ui-text-secondary)" key={row}>
            {row}
          </div>
        ))}
      </div>
    </div>
  )
}

function App() {
  const tabs = [
    { label: 'Complete Hermes in-app browser', active: true, tone: 'action' as const },
    { label: 'Fix duplicate message bug and', tone: 'attention' as const },
    { label: 'Swarm cockpit pass', tone: 'idle' as const }
  ]

  return (
    <div className="flex h-screen w-full flex-col bg-(--ui-editor-surface-background) text-foreground">
      {/* The window band spans the WHOLE window in the app (the sidebar starts
          below it), so the tab strip and the left cluster share one rail. */}
      <div className="flex h-[34px] shrink-0 items-stretch bg-(--pane-tab-strip-bg,var(--ui-sidebar-surface-background)) shadow-[inset_0_-1px_0_var(--ui-stroke-quaternary)]">
        <div className="flex w-[264px] shrink-0 items-stretch border-r border-(--ui-stroke-quaternary)">
          <div className="flex shrink-0 items-center pl-2.5">
            <Button
              aria-label="Toggle sidebar"
              className="bg-transparent text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-(--ui-text-primary)"
              size="icon-titlebar"
              variant="ghost"
            >
              <Codicon name="layout-sidebar-left" size="14px" />
            </Button>
          </div>
          {/* The sidebar's own strip rides the same band now: its switcher sits
              beside the toggle instead of on a second row. */}
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
          {tabs.map(tab => (
            <Tab active={tab.active} key={tab.label} label={tab.label} tone={tab.tone} />
          ))}
          <span className="flex shrink-0 items-center pl-0.5">
            <Button
              aria-label="New session tab"
              className="rounded-[6px] bg-transparent text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-(--ui-text-primary)"
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="add" size="14px" />
            </Button>
          </span>
        </PaneTabStrip>
        <div className="flex shrink-0 items-center gap-0.5 pr-3 pl-1">
          <span aria-hidden className="mx-1 h-3.5 w-px bg-(--ui-stroke-quaternary)" />
          <ToolGlyph label="Browser" name="globe" />
          <ToolGlyph label="Settings" name="gear" />
          <ToolGlyph label="Split" name="split-horizontal" />
          <ToolGlyph label="Swap panes" name="arrow-swap" />
          <ToolGlyph label="Right panel" name="layout-sidebar-right" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 bg-(--ui-editor-surface-background) p-6">
            <div className="mx-auto max-w-2xl rounded-xl border border-(--ui-stroke-quaternary) bg-(--ui-chat-surface-background) px-4 py-3 text-[13px] text-(--ui-text-secondary)">
              bruhh take over and finish this stuff Thanks
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
