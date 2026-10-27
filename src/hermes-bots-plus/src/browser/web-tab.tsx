/** One web tab: toolbar (history, address, reload) over the page, which is
 *  framed when the site allows it, rendered through the gateway when it does
 *  not (or when a loopback address only exists on the Hermes machine), and a
 *  clear card when neither can show it. Nothing ever jumps out silently. */

import { Button, Codicon, host, Tip, useValue } from '@hermes/plugin-sdk'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { probePage, reachableHere } from './api'
import { type BrowserText, useBrowserText } from './browser-i18n'
import { GatewayView } from './gateway-view'
import {
  $linksHere,
  navigateTab,
  patchTab,
  reloadTab,
  remoteCommand,
  setLinksHere,
  stepHistory,
  type WebTab
} from './store'
import { hostOf, isLoopbackHost, normalizeAddress, parseUrl } from './url'

const FRAME_TIMEOUT_MS = 15000

/** The viewer is on the Hermes machine itself (the desktop app, or a local
 *  webapp), so its loopback is the gateway's loopback. */
function viewerIsLocal(): boolean {
  if (typeof location === 'undefined') {
    return true
  }

  return !/^https?:$/.test(location.protocol) || isLoopbackHost(location.hostname)
}

export function openOutside(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function askBotToOpen(url: string, text: BrowserText): void {
  void host.composer?.insertText?.(null, text.askBotPrompt(url), { mode: 'block' })
}

export function WebTabView({ tab, visible }: { tab: WebTab; visible: boolean }) {
  usePageLoader(tab)

  return (
    <div className="hbb-shell">
      <Toolbar tab={tab} />
      <div className="hbb-body">
        <PageContent tab={tab} visible={visible} />
      </div>
    </div>
  )
}

/** Decide how each navigation is shown. */
function usePageLoader(tab: WebTab): void {
  useEffect(() => {
    const url = tab.target

    if (!url) {
      return
    }

    let cancelled = false
    const set = (patch: Partial<WebTab>) => !cancelled && patchTab<WebTab>(tab.id, patch)

    if (tab.preferRemote) {
      set({ mode: 'remote', loading: true })

      return () => {
        cancelled = true
      }
    }

    const parsed = parseUrl(url)

    if (!parsed) {
      set({ mode: 'unreachable', loading: false, reason: 'invalid' })

      return () => {
        cancelled = true
      }
    }

    set({ mode: 'checking', loading: true, reason: undefined })

    void (async () => {
      if (isLoopbackHost(parsed.hostname)) {
        if (viewerIsLocal() || (await reachableHere(url))) {
          set({ mode: 'frame' })

          return
        }

        // Not on this computer: the address may be a dev server on the Hermes machine.
        const probe = await probePage(url).catch(() => null)
        set(probe?.reachable ? { mode: 'remote', title: probe.title ?? '' } : { mode: 'unreachable', loading: false, reason: 'local' })

        return
      }

      const probe = await probePage(url).catch(() => null)

      if (!probe || !probe.reachable) {
        // The gateway can't tell (offline backend, private network): let this browser try.
        set({ mode: 'frame' })
      } else if (probe.embeddable === false) {
        set({ mode: 'blocked', loading: false, reason: probe.reason, title: probe.title ?? '' })
      } else {
        set({ mode: 'frame', title: probe.title ?? '' })
      }
    })()

    return () => {
      cancelled = true
    }
    // Every navigation (and reload) bumps `nav`; the URL alone would miss reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.nav, tab.preferRemote])
}

function Toolbar({ tab }: { tab: WebTab }) {
  const text = useBrowserText()
  const remote = tab.mode === 'remote'
  const canBack = remote ? Boolean(tab.remoteBack) || tab.index > 0 : tab.index > 0
  const canForward = remote ? Boolean(tab.remoteForward) || tab.index < tab.history.length - 1 : tab.index < tab.history.length - 1

  const go = (delta: -1 | 1) => {
    if (remote && (delta < 0 ? tab.remoteBack : tab.remoteForward)) {
      remoteCommand(tab.id, delta < 0 ? 'back' : 'forward')
    } else {
      stepHistory(tab.id, delta)
    }
  }

  return (
    <div className="hbb-bar">
      <NavButton disabled={!canBack} icon="arrow-left" label={text.back} onClick={() => go(-1)} />
      <NavButton disabled={!canForward} icon="arrow-right" label={text.forward} onClick={() => go(1)} />
      {tab.loading ? (
        <NavButton icon="close" label={text.stop} onClick={() => patchTab<WebTab>(tab.id, { loading: false })} />
      ) : (
        <NavButton
          disabled={!tab.target}
          icon="refresh"
          label={text.reload}
          onClick={() => (remote ? remoteCommand(tab.id, 'reload') : reloadTab(tab.id))}
        />
      )}
      <AddressBar tab={tab} />
      <NavButton disabled={!tab.url} icon="hubot" label={text.askBot} onClick={() => askBotToOpen(tab.url, text)} />
      <NavButton disabled={!tab.url} icon="link-external" label={text.openExternal} onClick={() => openOutside(tab.url)} />
      <div className="hbb-progress" data-state={tab.loading ? 'loading' : tab.target ? 'done' : 'idle'} key={`${tab.nav}:${tab.loading}`} />
    </div>
  )
}

function NavButton({ disabled, icon, label, onClick }: { disabled?: boolean; icon: string; label: string; onClick: () => void }) {
  return (
    <Tip label={label}>
      <button aria-label={label} className="hbb-nav" disabled={disabled} onClick={onClick} type="button">
        <Codicon name={icon} />
      </button>
    </Tip>
  )
}

function AddressBar({ tab }: { tab: WebTab }) {
  const text = useBrowserText()
  const [draft, setDraft] = useState(tab.url)
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) {
      setDraft(tab.url)
    }
  }, [editing, tab.url])

  // A fresh blank tab is for typing.
  useEffect(() => {
    if (!tab.target) {
      inputRef.current?.focus()
    }
  }, [tab.target])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const url = normalizeAddress(draft)

    if (url) {
      navigateTab(tab.id, url)
      setEditing(false)
      inputRef.current?.blur()
    }
  }

  const parsed = parseUrl(tab.url)
  const local = Boolean(parsed && isLoopbackHost(parsed.hostname))
  const tone = !parsed ? 'idle' : local ? 'local' : parsed.protocol === 'https:' ? 'secure' : 'plain'
  const icon = !parsed ? 'search' : local ? 'server-environment' : parsed.protocol === 'https:' ? 'lock' : 'globe'

  return (
    <form className="hbb-addr" onSubmit={submit}>
      <span className="hbb-addr-icon" data-tone={tone}>
        <Codicon name={icon} size={13} />
      </span>
      <input
        aria-label={text.address}
        autoComplete="off"
        data-address={tab.id}
        onBlur={() => setEditing(false)}
        onChange={event => {
          setEditing(true)
          setDraft(event.target.value)
        }}
        onFocus={event => event.currentTarget.select()}
        onKeyDown={event => {
          // First Esc cancels an edit (and is marked handled, so a floating
          // window stays open); with nothing to cancel it falls through and
          // minimises the window.
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            if (draft !== tab.url) {
              event.preventDefault()
            }

            setEditing(false)
            setDraft(tab.url)
            event.currentTarget.blur()
          }
        }}
        placeholder={text.address}
        ref={inputRef}
        spellCheck={false}
        value={draft}
      />
      {tab.mode === 'remote' && (
        <Tip label={text.viaGatewayHint}>
          <span className="hbb-chip">
            <Codicon name="server" size={11} />
            {text.viaGateway}
          </span>
        </Tip>
      )}
    </form>
  )
}

function PageContent({ tab, visible }: { tab: WebTab; visible: boolean }) {
  const text = useBrowserText()

  switch (tab.mode) {
    case 'idle':
      return <NewTabPage tab={tab} />
    case 'checking':
      return null
    case 'frame':
      return <FramedPage tab={tab} />
    case 'remote':
      return <GatewayView tab={tab} visible={visible} />
    case 'blocked':
      return (
        <CenterCard
          body={text.blockedBody}
          icon="shield"
          title={text.blockedTitle(hostOf(tab.url))}
          tone="warn"
        >
          <Button onClick={() => patchTab<WebTab>(tab.id, { preferRemote: true, mode: 'remote', loading: true })} size="sm">
            <Codicon name="eye" />
            {text.viewHere}
          </Button>
          <Button onClick={() => openOutside(tab.url)} size="sm" variant="outline">
            <Codicon name="link-external" />
            {text.openExternal}
          </Button>
          <Button onClick={() => askBotToOpen(tab.url, text)} size="sm" variant="ghost">
            <Codicon name="hubot" />
            {text.askBot}
          </Button>
        </CenterCard>
      )
    case 'unreachable':
      return (
        <CenterCard
          body={tab.reason === 'local' ? text.unreachableLocal : text.unreachableRemote}
          icon="debug-disconnect"
          title={text.unreachableTitle(hostOf(tab.url) || tab.url)}
          tone="warn"
        >
          <Button onClick={() => reloadTab(tab.id)} size="sm">
            <Codicon name="refresh" />
            {text.tryAgain}
          </Button>
          <Button onClick={() => openOutside(tab.url)} size="sm" variant="outline">
            <Codicon name="link-external" />
            {text.openExternal}
          </Button>
        </CenterCard>
      )
  }
}

function FramedPage({ tab }: { tab: WebTab }) {
  const [ready, setReady] = useState(false)
  const sameOrigin = parseUrl(tab.target)?.origin === location.origin

  useEffect(() => {
    setReady(false)
    const timer = window.setTimeout(() => patchTab<WebTab>(tab.id, { loading: false }), FRAME_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [tab.id, tab.nav])

  return (
    <iframe
      allow="clipboard-write; fullscreen"
      className="hbb-frame"
      data-ready={ready ? 'true' : 'false'}
      key={tab.nav}
      onLoad={() => {
        setReady(true)
        patchTab<WebTab>(tab.id, { loading: false })
      }}
      referrerPolicy="no-referrer"
      // Only a page from another origin may keep its own origin: the app's own
      // origin with scripts and same-origin would escape the sandbox.
      sandbox={`allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts allow-downloads${sameOrigin ? '' : ' allow-same-origin'}`}
      src={tab.target}
      title={tab.title || hostOf(tab.url)}
    />
  )
}

const SUGGESTIONS = ['localhost:3000', 'localhost:5173', 'localhost:8000']

function NewTabPage({ tab }: { tab: WebTab }) {
  const text = useBrowserText()
  const linksHere = useValue($linksHere)

  return (
    <CenterCard body={text.emptyBody} icon="globe" title={text.emptyTitle} tone="info">
      <div className="hbb-suggest" aria-label={text.emptyHint}>
        {SUGGESTIONS.map(address => (
          <button key={address} onClick={() => navigateTab(tab.id, normalizeAddress(address))} type="button">
            <Codicon name="server-environment" size={12} />
            {address}
          </button>
        ))}
      </div>
      <Tip label={text.linksHereHint}>
        <label className="hbb-toggle">
          <input checked={linksHere} onChange={event => setLinksHere(event.target.checked)} type="checkbox" />
          {text.linksHere}
        </label>
      </Tip>
    </CenterCard>
  )
}

function CenterCard({
  body,
  children,
  icon,
  title,
  tone
}: {
  body: string
  children?: ReactNode
  icon: string
  title: string
  tone: 'info' | 'warn'
}) {
  return (
    <div className="hbb-center">
      <div className="hbb-card hbb-enter">
        <span className="hbb-card-icon" data-tone={tone}>
          <Codicon name={icon} size={20} />
        </span>
        <h3>{title}</h3>
        <p>{body}</p>
        {children && <div className="hbb-actions">{children}</div>}
      </div>
    </div>
  )
}
