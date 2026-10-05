import { useStore } from '@nanostores/react'
import { type ComponentType, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { navItemActive, useSidebarNavItems } from '@/app/chat/sidebar/nav-items'
import { jobState, nextRunOverdueMs } from '@/app/cron/job-state'
import { BrandMark } from '@/components/brand-mark'
import { $paneVisible, revealTreePane } from '@/components/pane-shell/tree/store'
import { Codicon } from '@/components/ui/codicon'
import { Tip, TipKeybindLabel } from '@/components/ui/tooltip'
import { useContributions } from '@/contrib/react/use-contributions'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { openCommandPalette } from '@/store/command-palette'
import { $cronJobs } from '@/store/cron'
import { recordAction } from '@/store/desktop-metrics'
import { $sidebarOpen, setSidebarOpen } from '@/store/layout'
import { $newChatProfile } from '@/store/profile'

import { type AppView, SETTINGS_ROUTE } from '../routes'
import type { SidebarNavItem } from '../types'

import { BOTS_PANE, railActiveKey, railPanelAction, SESSIONS_PANE } from './activity-rail-model'
import { TITLEBAR_HEIGHT } from './titlebar'

// The icon rail at the window's left edge (Codex / VS Code activity bar, in
// Hermes's own dress): the Nous mark as Home, the sidebar's panels, then
// every page. It stays when the sidebar folds, so the app is never more than
// one click from anywhere. Destinations come from the same list the
// sidebar's nav rows use (useSidebarNavItems), plugin rows included.

const RAIL_BUTTON =
  'relative grid size-9 place-items-center rounded-[0.7rem] text-(--ui-text-tertiary) outline-none transition-[background-color,color] duration-150 [-webkit-app-region:no-drag] hover:bg-(--ui-control-hover-background) hover:text-foreground focus-visible:ring-2 focus-visible:ring-(--ui-accent)/50'

const RAIL_BUTTON_ACTIVE = 'bg-(--ui-control-active-background) text-foreground'

interface RailEntry {
  key: string
  label: ReactNode
  ariaLabel: string
  icon: ComponentType<{ className?: string }>
  active: boolean
  attention?: boolean
  onPress: () => void
}

function RailButton({
  entry,
  register
}: {
  entry: RailEntry
  register: (key: string, el: HTMLElement | null) => void
}) {
  return (
    <Tip label={entry.label} side="right" sideOffset={10}>
      <button
        aria-current={entry.active ? 'page' : undefined}
        aria-label={entry.ariaLabel}
        className={cn(RAIL_BUTTON, entry.active && RAIL_BUTTON_ACTIVE)}
        data-active={entry.active}
        data-rail-entry={entry.key}
        onClick={entry.onPress}
        ref={el => register(entry.key, el)}
        type="button"
      >
        <entry.icon className="rail-glyph text-[1.125rem]!" />
        {entry.attention && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-500 ring-2 ring-(--ui-bg-chrome)"
          />
        )}
      </button>
    </Tip>
  )
}

const glyphs = new Map<string, ComponentType<{ className?: string }>>()

/** A stable icon component for a codicon name (stable so buttons don't remount). */
function glyph(name: string): ComponentType<{ className?: string }> {
  let icon = glyphs.get(name)

  if (!icon) {
    icon = props => <Codicon name={name} {...props} />
    glyphs.set(name, icon)
  }

  return icon
}

function RailDivider() {
  return <span aria-hidden="true" className="my-1 h-px w-5 shrink-0 bg-(--ui-stroke-tertiary)" />
}

/** Slides between entries; springs a touch past its mark (Hermes's motion). */
function useIndicator(activeKey: null | string) {
  const nodes = useRef(new Map<string, HTMLElement>())
  const [box, setBox] = useState<null | { top: number; height: number }>(null)
  const [settled, setSettled] = useState(false)

  const register = (key: string, el: HTMLElement | null) => {
    if (el) {
      nodes.current.set(key, el)
    } else {
      nodes.current.delete(key)
    }
  }

  useLayoutEffect(() => {
    const el = activeKey ? nodes.current.get(activeKey) : undefined

    setBox(el ? { top: el.offsetTop + 8, height: el.offsetHeight - 16 } : null)
    // The first placement lands without travelling in from the top.
    const frame = requestAnimationFrame(() => setSettled(true))

    return () => cancelAnimationFrame(frame)
  }, [activeKey])

  return { box, register, settled }
}

export function ActivityRail({
  currentView,
  onNavigate
}: {
  currentView: AppView
  onNavigate: (item: SidebarNavItem) => void
}) {
  const { t } = useI18n()
  const s = t.sidebar
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const navItems = useSidebarNavItems()
  const sidebarOpen = useStore($sidebarOpen)
  const sessionsShown = useStore($paneVisible(SESSIONS_PANE))
  const botsShown = useStore($paneVisible(BOTS_PANE))
  const hasBots = useContributions('panes').some(pane => pane.id === BOTS_PANE)
  const cronJobs = useStore($cronJobs)

  const cronAttention = useMemo(
    () => cronJobs.some(job => jobState(job) === 'running' || nextRunOverdueMs(job) !== null),
    [cronJobs]
  )

  const newSession = navItems.find(item => item.id === 'new-session')
  const pages = navItems.filter(item => item.id !== 'new-session')
  const activePage = pages.find(item => navItemActive(item, currentView, pathname))?.id ?? null

  const panels = [
    { key: SESSIONS_PANE, shown: sessionsShown },
    ...(hasBots ? [{ key: BOTS_PANE, shown: botsShown }] : [])
  ]

  const activeKey = railActiveKey(activePage, panels, sidebarOpen)
  const { box, register, settled } = useIndicator(activeKey)

  const togglePanel = (pane: string, shown: boolean) => {
    if (railPanelAction({ paneShown: shown, sidebarOpen }) === 'fold') {
      setSidebarOpen(false)

      return
    }

    setSidebarOpen(true)
    revealTreePane(pane)
  }

  const go = (item: SidebarNavItem) => {
    if (item.action === 'new-session') {
      $newChatProfile.set(null)
    }

    if (item.keybindActionId) {
      recordAction(item.keybindActionId, 'click')
    }

    onNavigate(item)
  }

  const labelFor = (item: SidebarNavItem) => s.nav[item.id] ?? item.label

  const panelEntries: RailEntry[] = [
    {
      key: SESSIONS_PANE,
      label: t.sidebar.sessions,
      ariaLabel: t.sidebar.sessions,
      icon: glyph('comment-discussion'),
      active: activeKey === SESSIONS_PANE,
      onPress: () => togglePanel(SESSIONS_PANE, sessionsShown)
    },
    ...(hasBots
      ? [
          {
            key: BOTS_PANE,
            label: t.common.bots,
            ariaLabel: t.common.bots,
            icon: glyph('hubot'),
            active: activeKey === BOTS_PANE,
            onPress: () => togglePanel(BOTS_PANE, botsShown)
          }
        ]
      : [])
  ]

  const pageEntries: RailEntry[] = pages.map(item => {
    const text = labelFor(item)

    return {
      key: item.id,
      label: item.keybindActionId ? <TipKeybindLabel actionId={item.keybindActionId} text={text} /> : text,
      ariaLabel: text,
      icon: item.icon,
      active: activeKey === item.id,
      attention: item.id === 'cron' && cronAttention,
      onPress: () => go(item)
    }
  })

  const toolEntries: RailEntry[] = [
    {
      key: 'palette',
      label: <TipKeybindLabel actionId="nav.commandPalette" text={t.keybinds.actions['nav.commandPalette']} />,
      ariaLabel: t.keybinds.actions['nav.commandPalette'],
      icon: glyph('search'),
      active: false,
      onPress: openCommandPalette
    },
    {
      key: 'settings',
      label: <TipKeybindLabel actionId="nav.settings" text={t.keybinds.actions['nav.settings']} />,
      ariaLabel: t.keybinds.actions['nav.settings'],
      icon: glyph('settings-gear'),
      active: currentView === 'settings',
      onPress: () => navigate(SETTINGS_ROUTE)
    }
  ]

  const homeText = newSession ? labelFor(newSession) : ''

  return (
    <nav
      aria-label={s.railAria}
      className="relative flex h-full w-12 shrink-0 flex-col items-center border-r border-(--ui-stroke-tertiary) bg-(--ui-bg-chrome) pb-2"
      data-slot="activity-rail"
    >
      {/* The titlebar band: window drag + where the native controls sit. */}
      <div className="w-full shrink-0 [-webkit-app-region:drag]" style={{ height: TITLEBAR_HEIGHT }} />

      {box && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute left-0 w-[3px] rounded-r-full bg-(--ui-accent) shadow-[0_0_10px_var(--ui-accent)]',
            settled &&
              'motion-safe:transition-[top,height] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.34,1.4,0.64,1)]'
          )}
          data-slot="activity-rail-indicator"
          style={{ height: box.height, top: box.top }}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden scrollbar-none">
        {newSession && (
          <Tip
            label={
              newSession.keybindActionId ? (
                <TipKeybindLabel actionId={newSession.keybindActionId} text={homeText} />
              ) : (
                homeText
              )
            }
            side="right"
            sideOffset={10}
          >
            <button
              aria-label={homeText}
              className="mb-1 grid size-9 shrink-0 place-items-center rounded-[0.7rem] outline-none transition-transform duration-200 [-webkit-app-region:no-drag] hover:scale-105 focus-visible:ring-2 focus-visible:ring-(--ui-accent)/50 active:scale-95"
              data-rail-entry="home"
              onClick={() => go(newSession)}
              type="button"
            >
              <BrandMark className="size-8" />
            </button>
          </Tip>
        )}
        {panelEntries.map(entry => (
          <RailButton entry={entry} key={entry.key} register={register} />
        ))}
        {pageEntries.length > 0 && <RailDivider />}
        {pageEntries.map(entry => (
          <RailButton entry={entry} key={entry.key} register={register} />
        ))}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
        {toolEntries.map(entry => (
          <RailButton entry={entry} key={entry.key} register={register} />
        ))}
      </div>
    </nav>
  )
}
