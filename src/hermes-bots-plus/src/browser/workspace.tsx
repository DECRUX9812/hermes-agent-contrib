/** The browser workspace: a tab strip over the active tab's view. Web tabs
 *  stay mounted while hidden so a framed page keeps its state; screens and
 *  activity render only while in front. */

import { Codicon, Favicon, Tip, useValue } from '@hermes/plugin-sdk'
import { type KeyboardEvent, type MouseEvent, useEffect, useRef } from 'react'

import { BotScreenPane } from '../screen-pane'

import { ActivityTabView } from './activity-tab'
import { useBrowserText } from './browser-i18n'
import { browserToTab, closeBrowser, closeBrowserTab, floatBrowser, newBrowserTab } from './open'
import { $activeTab, $activity, $tabs, type BrowserTab } from './store'
import { addressLabel } from './url'
import { WebTabView } from './web-tab'

export function BrowserWorkspace({ docked = null, floating = false }: { docked?: 'left' | 'right' | null; floating?: boolean }) {
  const tabs = useValue($tabs)
  const active = useValue($activeTab)
  const shellRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey

    // The app's own shortcut layer runs first; a chord it handled is done.
    if (event.defaultPrevented || !mod || event.altKey || event.shiftKey) {
      return
    }

    const key = event.key.toLowerCase()

    if (key === 't') {
      event.preventDefault()
      newBrowserTab()
    } else if (key === 'w' && active) {
      event.preventDefault()
      closeBrowserTab(active)
    } else if (key === 'l') {
      event.preventDefault()
      shellRef.current?.querySelector<HTMLInputElement>(`[data-address='${active}']`)?.focus()
    }
  }

  return (
    <div className="hbb-shell" data-hermes-browser="" onKeyDown={onKeyDown} ref={shellRef}>
      <TabStrip active={active} docked={docked} floating={floating} tabs={tabs} />
      <div className="hbb-body">
        {tabs.map(tab => {
          const visible = tab.id === active

          if (!visible && tab.kind !== 'web') {
            return null
          }

          return (
            <div className="hbb-pane" data-hidden={visible ? 'false' : 'true'} key={tab.id}>
              {tab.kind === 'web' ? (
                <WebTabView tab={tab} visible={visible} />
              ) : tab.kind === 'bot' ? (
                <div className="hbb-pane hbb-enter">
                  <BotScreenPane bot={tab.bot} />
                </div>
              ) : (
                <ActivityTabView tab={tab} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TabStrip({
  active,
  docked,
  floating,
  tabs
}: {
  active: null | string
  docked: 'left' | 'right' | null
  floating: boolean
  tabs: BrowserTab[]
}) {
  const text = useBrowserText()
  const seen = useRef(new Set<string>())
  const stripRef = useRef<HTMLDivElement>(null)

  // New tabs animate in once; the first render (restored tabs) does not.
  const first = seen.current.size === 0
  const fresh = new Set(tabs.filter(tab => !seen.current.has(tab.id)).map(tab => tab.id))

  useEffect(() => {
    tabs.forEach(tab => seen.current.add(tab.id))
  }, [tabs])

  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <div aria-label={text.title} className="hbb-tabs" ref={stripRef} role="tablist">
      {tabs.map(tab => (
        <TabButton active={tab.id === active} fresh={!first && fresh.has(tab.id)} key={tab.id} tab={tab} />
      ))}
      <Tip label={text.newTab}>
        <button aria-label={text.newTab} className="hbb-tab-new" onClick={newBrowserTab} type="button">
          <Codicon name="add" />
        </button>
      </Tip>
      {!floating && (
        <>
          <span className="hbb-tabs-spacer" />
          <Tip label={text.popOut}>
            <button aria-label={text.popOut} className="hbb-tab-new" onClick={floatBrowser} type="button">
              <Codicon name="multiple-windows" />
            </button>
          </Tip>
          {docked && (
            <>
              <Tip label={text.toTab}>
                <button aria-label={text.toTab} className="hbb-tab-new" onClick={browserToTab} type="button">
                  <Codicon name="window" />
                </button>
              </Tip>
              <Tip label={text.closeBrowser}>
                <button aria-label={text.closeBrowser} className="hbb-tab-new" onClick={closeBrowser} type="button">
                  <Codicon name="close" />
                </button>
              </Tip>
            </>
          )}
        </>
      )}
    </div>
  )
}

function TabButton({ active, fresh, tab }: { active: boolean; fresh: boolean; tab: BrowserTab }) {
  const text = useBrowserText()
  const activity = useValue($activity)
  const label = tabLabel(tab, text.newTab)

  const close = (event: MouseEvent) => {
    event.stopPropagation()
    closeBrowserTab(tab.id)
  }

  return (
    <div
      aria-selected={active}
      className="hbb-tab"
      data-active={active ? 'true' : 'false'}
      data-fresh={fresh ? 'true' : 'false'}
      onAuxClick={event => {
        if (event.button === 1) {
          close(event)
        }
      }}
      onClick={() => $activeTab.set(tab.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          $activeTab.set(tab.id)
        }
      }}
      role="tab"
      tabIndex={0}
      title={tab.kind === 'web' && tab.url ? tab.url : label}
    >
      <span className="hbb-tab-icon">
        <TabIcon running={tab.kind === 'activity' && Boolean(activity[tab.key]?.running)} tab={tab} />
      </span>
      <span className="hbb-tab-label">{label}</span>
      <button aria-label={text.closeTab} className="hbb-tab-x" onClick={close} type="button">
        <Codicon name="close" size={12} />
      </button>
    </div>
  )
}

export function TabIcon({ running, tab }: { running: boolean; tab: BrowserTab }) {
  if (tab.kind === 'bot') {
    return <Codicon name="device-desktop" size={14} />
  }

  if (tab.kind === 'activity') {
    return running ? <span className="hbp-lv-dot size-1.5 rounded-full" /> : <Codicon name="eye" size={14} />
  }

  if (tab.loading) {
    return <Codicon name="loading" size={14} spinning />
  }

  if (!tab.url) {
    return <Codicon name="globe" size={14} />
  }

  return <Favicon className="size-3.5" fallback={<Codicon name="globe" size={14} />} url={tab.url} />
}

export function tabLabel(tab: BrowserTab, blank: string): string {
  if (tab.kind !== 'web') {
    return tab.title
  }

  return tab.title || (tab.url ? addressLabel(tab.url) : blank)
}
