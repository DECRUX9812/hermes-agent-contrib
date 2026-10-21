import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { notifyError } from '@/store/notifications'

import { ToggleRow } from './primitives'

/**
 * The opt-in menu-bar status toggle (#38). Nothing lands in the menu bar until
 * this is on (offer, don't hijack) — it is deliberately separate from
 * "minimize to tray", which keeps governing window behavior on its own.
 */
export function MenuBarStatusSetting() {
  const { t } = useI18n()
  const c = t.settings.config
  const bridge = window.hermesDesktop?.menuBarStatus
  const [status, setStatus] = useState<{ enabled: boolean; available: boolean; statusEnabled: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const revision = useRef(0)

  const load = useCallback(async () => {
    if (!bridge) {
      return
    }

    const version = ++revision.current
    setLoadFailed(false)

    try {
      const next = await bridge.get()

      if (revision.current === version) {
        setStatus(next)
      }
    } catch (error) {
      if (revision.current === version) {
        setLoadFailed(true)
        notifyError(error, c.failedLoad)
      }
    }
  }, [bridge, c.failedLoad])

  useEffect(() => {
    if (!bridge) {
      return
    }

    // Broadcasts carry the whole tray status (window policy + menu-bar flag),
    // so an update from anywhere — another window, main-side defaulting —
    // lands here live.
    const unsubscribe = bridge.onChanged(next => {
      revision.current++
      setStatus(next)
      setLoadFailed(false)
    })

    void load()

    return () => {
      revision.current++
      unsubscribe()
    }
  }, [bridge, load])

  if (!bridge) {
    return null
  }

  const save = async (statusEnabled: boolean) => {
    const previous = status
    const version = ++revision.current
    setSaving(true)
    setStatus({ enabled: status?.enabled ?? false, available: status?.available ?? false, statusEnabled })

    try {
      const next = await bridge.set(statusEnabled)

      if (revision.current === version) {
        setStatus(next)
      }
    } catch (error) {
      if (revision.current === version) {
        setStatus(previous)
      }

      notifyError(error, c.autosaveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <ToggleRow
        checked={status?.statusEnabled ?? false}
        description={
          status?.statusEnabled && !status.available && !saving ? c.menuBarStatusUnavailable : c.menuBarStatusDesc
        }
        disabled={!status || saving}
        label={c.menuBarStatusTitle}
        onChange={statusEnabled => void save(statusEnabled)}
      />
      {loadFailed && (
        <Button onClick={() => void load()} size="sm" variant="secondary">
          {t.settings.screenshot.retry}
        </Button>
      )}
    </>
  )
}
