/** Cloud browsers, from the viewer's side.
 *
 *  Most bots browse in a provider's cloud browser: you can watch it, but
 *  only the bot can drive it, so the take-over slot shows a disabled
 *  "watching a cloud browser" button instead of a control that would fail.
 *  The plugin's Browser settings page switches one bot at a time between
 *  its cloud browser and a local headed one (which can be taken over),
 *  behind a confirm, with the server backing the profile config up first. */

import { Codicon, ConfirmDialog, Tip, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import { forgetBrowserBackends } from '../browser-backend'
import { $lastRoster, cachedUnionRoster, primeRoster } from '../data'
import type { RosterRow } from '../types'

import { type BrowserModeInfo, getBrowserMode, setBrowserMode } from './api'
import { useBrowserText } from './browser-i18n'

export const BROWSER_SETTINGS_PAGE = 'browser'

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole)
}

/** The take-over slot for a bot whose browser runs in the cloud. Disabled;
 *  the wrapper carries the tooltip because a disabled button gets no hover. */
export function CloudTakeOver({ compact = false }: { compact?: boolean }) {
  const text = useBrowserText()

  return (
    <Tip label={text.cloudTip}>
      <span aria-label={`${text.cloudWatching}. ${text.cloudTip}`} className="hbf-cloud-wrap" role="note" tabIndex={0}>
        <button
          aria-label={text.cloudWatching}
          className="hbf-lease"
          data-cloud="true"
          data-compact={compact ? 'true' : 'false'}
          disabled
          type="button"
        >
          <Codicon name="cloud" size={13} />
          <span className="hbf-lease-long">{text.cloudWatching}</span>
          <span className="hbf-lease-short">{text.cloudWatchingShort}</span>
        </button>
      </span>
    </Tip>
  )
}

/** Local bots only: a remote bot's config lives on another machine. */
export function localBots(rows: readonly RosterRow[]): RosterRow[] {
  const seen = new Set<string>()

  return rows.filter(row => {
    if (row.remoteSource || !row.name || seen.has(row.name)) {
      return false
    }

    seen.add(row.name)

    return true
  })
}

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; info: BrowserModeInfo }

function BotBrowserRow({ bot }: { bot: RosterRow }) {
  const text = useBrowserText()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [confirm, setConfirm] = useState<'cloud' | 'local' | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    let live = true

    getBrowserMode(bot.name).then(
      info => live && setLoad({ state: 'ready', info }),
      () => live && setLoad({ state: 'error' })
    )

    return () => {
      live = false
    }
  }, [bot.name])

  const mode = load.state === 'ready' ? load.info.mode : null
  const label = mode === 'local' ? text.modeLocal : mode === 'cloud' ? text.modeCloud : mode === 'other' ? text.modeOther : load.state === 'loading' ? text.settingsLoading : text.settingsUnknown
  const target = mode === 'local' ? 'cloud' : 'local'
  const vars = { bot: bot.name }

  return (
    <div className="hbs-row" data-bot={bot.name}>
      <span className="hbs-name">{bot.name}</span>
      {note && <span className="hbs-note">{note}</span>}
      <span className="hbs-chip" data-mode={mode ?? 'unknown'}>
        <Codicon name={mode === 'local' ? 'device-desktop' : mode === 'cloud' ? 'cloud' : 'question'} size={12} />
        {label}
      </span>
      <button className="hbs-act" disabled={load.state !== 'ready'} onClick={() => setConfirm(target)} type="button">
        {target === 'local' ? text.useLocal : text.useCloud}
      </button>
      <ConfirmDialog
        busyLabel={text.switching}
        cancelLabel={text.cancel}
        confirmLabel={text.confirmSwitch}
        description={fill(confirm === 'cloud' ? text.confirmCloudBody : text.confirmLocalBody, vars)}
        doneLabel={text.switched}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) {
            return
          }

          try {
            const change = await setBrowserMode(bot.name, confirm)
            setLoad({ state: 'ready', info: change })
            setNote(fill(text.backupSaved, { file: change.backup }))
            forgetBrowserBackends()
          } catch (error) {
            throw new Error(fill(text.modeFailed, { error: error instanceof Error ? error.message : String(error) }))
          }
        }}
        open={confirm !== null}
        title={fill(confirm === 'cloud' ? text.confirmCloudTitle : text.confirmLocalTitle, vars)}
      />
    </div>
  )
}

function cachedProfiles(): RosterRow[] {
  const rows = cachedUnionRoster()?.profiles

  return Array.isArray(rows) ? rows.filter(row => row && !row.ghost) : []
}

export function BrowserSettingsPage() {
  const text = useBrowserText()
  const live = useValue($lastRoster)
  // The Bots pane publishes the roster only while mounted; Settings may open
  // without it, so read the shared roster cache and fetch it once on a miss.
  const [cached, setCached] = useState<RosterRow[]>(() => cachedProfiles())

  useEffect(() => {
    if (live.length || cached.length) {
      return
    }

    let alive = true

    void primeRoster().then(() => {
      if (alive) {
        setCached(cachedProfiles())
      }
    })

    return () => {
      alive = false
    }
  }, [live.length, cached.length])

  const bots = localBots(live.length ? live : cached)

  return (
    <div className="hbs-page" data-hermes-browser-settings="">
      <p className="hbs-intro">{text.settingsIntro}</p>
      {bots.length === 0 ? (
        <p className="hbs-note">{text.settingsEmpty}</p>
      ) : (
        <div className="hbs-list">
          {bots.map(bot => (
            <BotBrowserRow bot={bot} key={bot.name} />
          ))}
        </div>
      )}
    </div>
  )
}
