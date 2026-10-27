/**
 * Side Pages (bot-mode c1): pages a bot made in its Bot Chat — an HTML page,
 * a markdown report, an SVG chart — open in a panel that slides in beside the
 * chat instead of living only as a file path in a tool row.
 *
 *  - `SidePagesChip` (composer.top, canonical Bot Chat only) counts the
 *    session's pages, toggles the panel, and hosts it.
 *  - `SidePageCard` claims `::botpage{path="…"}` so a reply can point at a
 *    page with a card that opens it.
 *
 * Self-contained: one fixed-position panel rendered through a React portal
 * into a body-level layer, its own style element, design tokens only — it
 * does not borrow the core preview rail.
 */

import * as sdk from '@hermes/plugin-sdk'
import { atom, Codicon, cn, host, useSessionView, useValue } from '@hermes/plugin-sdk'
import type { TranscriptDirectiveProps } from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { canonicalBotChatOnScreen, canonicalBotRowOnScreen } from './bot-plan-card'
import { $lastRoster } from './data'
import { requestForBot } from './routing'
import { useSidePagesText } from './side-pages-i18n'
import {
  findPage,
  historyToMessages,
  pageFileName,
  pageFrameSrc,
  pageMime,
  pagesFromMessages,
  type SidePage,
  type SidePageKind
} from './side-pages-model'

export const SIDE_PAGE_DIRECTIVE = 'botpage'

interface PanelState {
  activeId: null | string
  open: boolean
  sessionKey: null | string
}

export const $sidePanel = atom<PanelState>({ activeId: null, open: false, sessionKey: null })

export function openSidePage(sessionKey: null | string, activeId: null | string): void {
  $sidePanel.set({ activeId, open: true, sessionKey })
}

export function closeSidePages(): void {
  $sidePanel.set({ ...$sidePanel.get(), open: false })
}

const KIND_ICON: Record<SidePageKind, string> = { html: 'globe', markdown: 'note', svg: 'graph' }

/** Pages fetched from `session.history`, per stored session. The plugin SDK
 *  does not expose the transcript, so the chip (mounted once per chat) loads
 *  it and the cards read the same cache. */
const $historyPages = atom<Record<string, SidePage[]>>({})

const REFRESH_EVENTS = ['tool.complete', 'message.complete'] as const

function useHistoryPages(enabled: boolean, storedId: null | string, runtimeId: null | string): void {
  const busy = useValue(host.state.busy as never) === true
  // Roster rows are rebuilt on refresh; key the fetch on presence, not identity.
  const rowRef = useRef(canonicalBotRowOnScreen(storedId))
  rowRef.current = canonicalBotRowOnScreen(storedId) ?? rowRef.current
  const hasRow = rowRef.current !== null
  const sessionId = runtimeId || storedId
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const row = rowRef.current

    if (!enabled || !row || !storedId || !sessionId) {
      return
    }

    let live = true

    requestForBot<{ messages?: unknown }>(row, 'session.history', { session_id: sessionId })
      .then(result => {
        if (live) {
          $historyPages.set({ ...$historyPages.get(), [storedId]: pagesFromMessages(historyToMessages(result?.messages)) })
        }
      })
      .catch(() => undefined)

    return () => {
      live = false
    }
    // `busy` settling and finished tools both re-read the history.
  }, [busy, enabled, hasRow, sessionId, storedId, tick])

  useEffect(() => {
    if (!enabled || !sessionId || typeof host.onEvent !== 'function') {
      return
    }

    let timer: ReturnType<typeof setTimeout> | undefined

    const onStep = (event: { session_id?: string }) => {
      if (event?.session_id && event.session_id !== sessionId) {
        return
      }

      clearTimeout(timer)
      timer = setTimeout(() => setTick(n => n + 1), 600)
    }

    const offs = REFRESH_EVENTS.map(type => host.onEvent(type, onStep))

    return () => {
      clearTimeout(timer)
      offs.forEach(off => off?.())
    }
  }, [enabled, sessionId])
}

function useBotChatPages(owner = false): { canonical: boolean; pages: SidePage[]; storedId: null | string } {
  const view = useSessionView()
  const storedId = useValue(view.$storedId) ?? null
  const runtimeId = useValue(view.$runtimeId) ?? null
  const messages = useValue(view.$messages)
  const fetched = useValue($historyPages)
  useValue($lastRoster)
  const canonical = canonicalBotChatOnScreen(storedId)
  useHistoryPages(owner && canonical, storedId, runtimeId)

  const live = useMemo(() => pagesFromMessages(messages as never), [messages])
  const pages = live.length ? live : (storedId && fetched[storedId]) || NO_PAGES

  return { canonical, pages, storedId }
}

const NO_PAGES: SidePage[] = []

/** composer.top: "Pages · n" toggle + the panel host for this Bot Chat. */
export function SidePagesChip() {
  const copy = useSidePagesText()
  const { canonical, pages, storedId } = useBotChatPages(true)
  const panel = useValue($sidePanel)
  const layer = usePortalLayer(canonical && pages.length > 0)

  if (!canonical || !pages.length) {
    return null
  }

  const mine = panel.sessionKey === storedId
  const open = panel.open && mine

  return (
    <div className="hbp-sp-chip-row">
      <button
        aria-expanded={open}
        className="hbp-sp-chip"
        data-open={open || undefined}
        onClick={() => (open ? closeSidePages() : openSidePage(storedId, mine ? panel.activeId : null))}
        title={copy.chipHint}
        type="button"
      >
        <Codicon name="layout-sidebar-right" size="0.8rem" />
        <span>{copy.chip(pages.length)}</span>
      </button>
      {layer && rootPortal(<SidePagesPanel activeId={mine ? panel.activeId : null} open={open} pages={pages} />, layer)}
    </div>
  )
}

/** `::botpage{path="…"}` — a card naming the page; opens it in the panel. */
export function SidePageCard({ attrs, streaming }: TranscriptDirectiveProps) {
  const copy = useSidePagesText()
  const { canonical, pages, storedId } = useBotChatPages()

  if (!canonical || streaming) {
    return null
  }

  const page = findPage(pages, { id: attrs.id, path: attrs.path || attrs.file })

  if (!page) {
    return null
  }

  return (
    <button className="hbp-sp-card" onClick={() => openSidePage(storedId, page.id)} type="button">
      <span className="hbp-sp-card-icon">
        <Codicon name={KIND_ICON[page.kind]} size="1rem" />
      </span>
      <span className="hbp-sp-card-text">
        <span className="hbp-sp-card-title">{page.title}</span>
        <span className="hbp-sp-card-meta">
          {copy.kind[page.kind]} · {pageFileName(page)}
        </span>
      </span>
      <span className="hbp-sp-card-open">
        {copy.open}
        <Codicon name="arrow-right" size="0.75rem" />
      </span>
    </button>
  )
}

function downloadPage(page: SidePage): void {
  const url = URL.createObjectURL(new Blob([page.content], { type: `${pageMime(page.kind)};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = pageFileName(page)
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function PageView({ page }: { page: SidePage }) {
  if (page.kind === 'markdown') {
    const Markdown = (sdk as Record<string, unknown>).MessageTextContent as
      | ((props: { media?: boolean; text: string }) => JSX.Element)
      | undefined

    return (
      <div className="hbp-sp-doc">
        {Markdown ? <Markdown media={false} text={page.content} /> : <pre>{page.content}</pre>}
      </div>
    )
  }

  const Frame = (sdk as Record<string, unknown>).SandboxedFrame as
    | ((props: { className?: string; src: string; title: string }) => JSX.Element)
    | undefined

  return Frame ? (
    <Frame className="hbp-sp-frame" key={page.id + page.content.length} src={pageFrameSrc(page)} title={page.title} />
  ) : (
    <pre className="hbp-sp-doc">{page.content}</pre>
  )
}

/**
 * The composer dock sits inside the chat pane's isolated stacking context,
 * which hides a `position: fixed` panel behind the transcript, so the panel is
 * rendered through a React portal into its own body-level layer. The plugin
 * runtime exposes no react-dom, so the portal element is built by hand: React
 * reconciles any `{$$typeof: react.portal}` child as a HostPortal and attaches
 * its event listeners to the container, so `onClick` and every React control
 * inside a page (code-block copy buttons, …) keep working.
 */
const PORTAL_TYPE = Symbol.for('react.portal')

function rootPortal(children: ReactNode, container: HTMLElement): ReactNode {
  return { $$typeof: PORTAL_TYPE, children, containerInfo: container, implementation: null, key: null } as unknown as ReactNode
}

function usePortalLayer(enabled: boolean): HTMLElement | null {
  const [layer, setLayer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') {
      return
    }

    const node = document.createElement('div')
    node.className = 'hbp-sp-layer'
    document.body.appendChild(node)
    setLayer(node)

    return () => {
      setLayer(null)
      node.remove()
    }
  }, [enabled])

  return layer
}

export function SidePagesPanel({ activeId, open, pages }: { activeId: null | string; open: boolean; pages: SidePage[] }) {
  const copy = useSidePagesText()
  const [copied, setCopied] = useState(false)
  const active = pages.find(page => page.id === activeId) ?? pages[pages.length - 1] ?? null

  useEffect(() => {
    if (!open) {
      return
    }

    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && closeSidePages()
    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => setCopied(false), [active?.id])

  const copyPage = async () => {
    if (!active) {
      return
    }

    try {
      await navigator.clipboard.writeText(active.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <aside
      aria-hidden={!open}
      aria-label={copy.panelLabel}
      className="hbp-sp-panel"
      data-open={open || undefined}
    >
      <header className="hbp-sp-head">
        <span className="hbp-sp-head-title">{active?.title ?? copy.listLabel}</span>
        {active && <span className="hbp-sp-badge">{copy.kind[active.kind]}</span>}
        <span className="hbp-sp-spacer" />
        <button
          className="hbp-sp-act"
          disabled={!active}
          onClick={() => void copyPage()}
          title={copy.copy}
          type="button"
        >
          <Codicon name={copied ? 'check' : 'copy'} size="0.85rem" />
          <span>{copied ? copy.copied : copy.copy}</span>
        </button>
        <button
          className="hbp-sp-act"
          disabled={!active}
          onClick={() => active && downloadPage(active)}
          title={copy.download}
          type="button"
        >
          <Codicon name="desktop-download" size="0.85rem" />
          <span>{copy.download}</span>
        </button>
        <button
          aria-label={copy.close}
          className="hbp-sp-act hbp-sp-icon"
          onClick={closeSidePages}
          title={copy.close}
          type="button"
        >
          <Codicon name="close" size="0.85rem" />
        </button>
      </header>
      <div className="hbp-sp-body">
        <nav aria-label={copy.listLabel} className="hbp-sp-list">
          {pages.map(page => (
            <button
              aria-current={page.id === active?.id || undefined}
              className={cn('hbp-sp-item')}
              key={page.id}
              onClick={() => openSidePage($sidePanel.get().sessionKey, page.id)}
              title={page.path}
              type="button"
            >
              <Codicon name={KIND_ICON[page.kind]} size="0.85rem" />
              <span className="hbp-sp-item-text">
                <span className="hbp-sp-item-title">{page.title}</span>
                <span className="hbp-sp-item-meta">{copy.kind[page.kind]}</span>
              </span>
            </button>
          ))}
        </nav>
        <section className="hbp-sp-view">{active && open ? <PageView page={active} /> : null}</section>
      </div>
    </aside>
  )
}

/** Tokens only (hermes-design motion + ui surface tokens), each motion token
 *  with its default so the panel still animates without the design plugin. */
export function sidePagesStyleSheet(): string {
  const slow = '260ms'
  const base = '180ms'
  const fast = '120ms'
  const outQuint = 'cubic-bezier(0.22,1,0.36,1)'
  const standard = 'cubic-bezier(0.2,0,0,1)'

  return [
    `.hbp-sp-chip-row{display:flex;justify-content:flex-end;}`,
    `.hbp-sp-chip{display:inline-flex;align-items:center;gap:0.375rem;height:1.5rem;padding:0 0.625rem;border-radius:999px;`,
    `font-size:0.75rem;color:var(--ui-text-secondary);background:var(--ui-bg-quaternary);box-shadow:inset 0 0 0 1px var(--ui-stroke-tertiary);`,
    `transition:background-color ${fast} ${standard},color ${fast} ${standard},box-shadow ${fast} ${standard};}`,
    `.hbp-sp-chip:hover{background:var(--ui-control-hover-background);color:var(--ui-text-primary);}`,
    `.hbp-sp-chip[data-open]{color:var(--ui-text-primary);box-shadow:inset 0 0 0 1px var(--ui-accent);}`,

    `.hbp-sp-card{display:flex;align-items:center;gap:0.75rem;width:100%;max-width:32rem;margin:0.375rem 0;padding:0.625rem 0.75rem;text-align:left;`,
    `border-radius:var(--radius-xl);background:var(--ui-bg-elevated);box-shadow:inset 0 0 0 1px var(--ui-stroke-tertiary),var(--shadow-xs);`,
    `transition:box-shadow ${fast} ${standard},transform ${fast} ${standard};}`,
    `.hbp-sp-card:hover{box-shadow:inset 0 0 0 1px var(--ui-stroke-secondary),var(--shadow-sm);transform:translateY(-1px);}`,
    `.hbp-sp-card-icon{display:grid;place-items:center;width:2rem;height:2rem;flex:none;border-radius:var(--radius-lg);background:var(--ui-bg-quaternary);color:var(--ui-text-secondary);}`,
    `.hbp-sp-card-text{display:flex;flex-direction:column;min-width:0;flex:1;}`,
    `.hbp-sp-card-title{font-size:0.8125rem;font-weight:600;color:var(--ui-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}`,
    `.hbp-sp-card-meta{font-size:0.75rem;color:var(--ui-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}`,
    `.hbp-sp-card-open{display:inline-flex;align-items:center;gap:0.25rem;font-size:0.75rem;color:var(--ui-text-secondary);}`,

    `.hbp-sp-panel{position:fixed;z-index:60;top:2.75rem;right:0.75rem;bottom:0.75rem;width:min(46rem,calc(100vw - 6rem));`,
    `display:flex;flex-direction:column;overflow:hidden;border-radius:var(--radius-2xl);background:var(--ui-bg-elevated);`,
    `box-shadow:inset 0 0 0 1px var(--ui-stroke-secondary),var(--shadow-lg);`,
    `transform:translateX(calc(100% + 1rem));opacity:0;visibility:hidden;pointer-events:none;`,
    `transition:transform ${slow} ${outQuint},opacity ${base} ${standard},visibility 0s linear ${slow};}`,
    `.hbp-sp-panel[data-open]{transform:none;opacity:1;visibility:visible;pointer-events:auto;`,
    `transition:transform ${slow} ${outQuint},opacity ${base} ${standard},visibility 0s;}`,
    `@media (prefers-reduced-motion:reduce){.hbp-sp-panel,.hbp-sp-panel[data-open]{transition:opacity ${fast} linear,visibility 0s;transform:none;}}`,
    `.hbp-sp-head{display:flex;align-items:center;gap:0.375rem;min-height:2.75rem;padding:0 0.5rem 0 1rem;border-bottom:1px solid var(--ui-stroke-tertiary);}`,
    `.hbp-sp-head-title{font-size:0.875rem;font-weight:600;color:var(--ui-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}`,
    `.hbp-sp-badge{flex:none;font-size:0.6875rem;padding:0.0625rem 0.5rem;border-radius:999px;color:var(--ui-text-secondary);background:var(--ui-bg-quaternary);}`,
    `.hbp-sp-spacer{flex:1;}`,
    `.hbp-sp-act{display:inline-flex;align-items:center;gap:0.3125rem;height:1.75rem;padding:0 0.5rem;border-radius:var(--radius-md);`,
    `font-size:0.75rem;color:var(--ui-text-secondary);transition:background-color ${fast} ${standard},color ${fast} ${standard};}`,
    `.hbp-sp-act:hover:not(:disabled){background:var(--ui-control-hover-background);color:var(--ui-text-primary);}`,
    `.hbp-sp-act:disabled{opacity:0.5;}`,
    `.hbp-sp-icon{width:1.75rem;justify-content:center;padding:0;}`,
    `.hbp-sp-body{display:flex;flex:1;min-height:0;}`,
    `.hbp-sp-list{display:flex;flex-direction:column;gap:0.125rem;width:12rem;flex:none;padding:0.5rem;overflow-y:auto;border-right:1px solid var(--ui-stroke-tertiary);}`,
    `.hbp-sp-item{display:flex;align-items:flex-start;gap:0.5rem;padding:0.4375rem 0.5rem;text-align:left;border-radius:var(--radius-md);color:var(--ui-text-secondary);`,
    `transition:background-color ${fast} ${standard},color ${fast} ${standard};}`,
    `.hbp-sp-item:hover{background:var(--ui-control-hover-background);color:var(--ui-text-primary);}`,
    `.hbp-sp-item[aria-current]{background:var(--ui-bg-quaternary);color:var(--ui-text-primary);box-shadow:inset 2px 0 0 var(--ui-accent);}`,
    `.hbp-sp-item-text{display:flex;flex-direction:column;min-width:0;}`,
    `.hbp-sp-item-title{font-size:0.78125rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}`,
    `.hbp-sp-item-meta{font-size:0.6875rem;color:var(--ui-text-tertiary);}`,
    `.hbp-sp-view{flex:1;min-width:0;overflow:auto;background:var(--ui-surface-background);}`,
    `.hbp-sp-frame{display:block;width:100%;height:100%;}`,
    `.hbp-sp-doc{padding:1rem 1.25rem;font-size:0.875rem;}`,
    `.hbp-sp-doc pre,pre.hbp-sp-doc{white-space:pre-wrap;}`
  ].join('')
}

export function mountSidePagesStyles(): () => void {
  if (typeof document === 'undefined') {
    return () => {}
  }

  const id = 'hermes-bots-plus-side-pages'
  document.getElementById(id)?.remove()
  const el = document.createElement('style')
  el.id = id
  el.textContent = sidePagesStyleSheet()
  document.head.appendChild(el)

  return () => {
    el.remove()
    closeSidePages()
  }
}
