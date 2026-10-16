import {
  Button,
  cn,
  Codicon,
  host,
  Tip,
  useQuery,
  useQueryClient,
  useSessionView,
  useValue
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import { AMBITION_KEY, type AmbitionSummary, errorText, fetchSessionSummary, putMode } from './api'
import { useAmbitionI18n } from './i18n'

// ON state = accent — the same vocabulary the composer's other toggles wear.
const CHIP_ON = 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
const CHIP_OFF = 'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'

const summaryKey = (storedSessionId: string) => [AMBITION_KEY, storedSessionId] as const

/**
 * The composer's Ambition toggle. Its state IS the backend mode: the session
 * summary is the one source (the plugin's own store), painted optimistically
 * on toggle and rolled back visibly when the PUT fails. Hidden while there is
 * no session to scope to, while the summary has not loaded, and when the
 * backend has no ambition plugin (REST 404) — it never fakes a state.
 */
export function AmbitionChip() {
  const t = useAmbitionI18n()
  const queryClient = useQueryClient()
  const storedSessionId = useValue(useSessionView().$storedId)
  const [saving, setSaving] = useState(false)

  // Polling is the fallback door only: live changes arrive as the plugin's
  // `card.updated` events (invalidated in plugin.tsx).
  const { data, error } = useQuery({
    enabled: Boolean(storedSessionId),
    queryFn: () => fetchSessionSummary(storedSessionId as string),
    queryKey: summaryKey(storedSessionId ?? ''),
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000
  })

  // No session, no answer yet, or the backend refused (missing plugin /
  // unreachable): nothing to show. The chip never guesses a mode it has
  // not read.
  if (!storedSessionId || error || !data) {
    return null
  }

  const on = data.enabled

  const toggle = async () => {
    if (saving) {
      return
    }

    const next = !on
    const key = summaryKey(storedSessionId)

    // Optimistic paint, then the real write; a failed PUT refetches the
    // backend's truth (the visible rollback) and says so in a toast.
    queryClient.setQueryData<AmbitionSummary>(key, { ...data, enabled: next })
    setSaving(true)

    try {
      await putMode(storedSessionId, next)
      await queryClient.invalidateQueries({ queryKey: [AMBITION_KEY] })
    } catch (toggleError) {
      await queryClient.invalidateQueries({ queryKey: key })
      host.notifyError(toggleError, errorText(toggleError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Tip label={on ? t('modeOn') : t('modeOff')} placement="control">
      <Button
        aria-label="Ambition"
        aria-pressed={on}
        className={cn('h-(--composer-control-size) shrink-0 gap-1 rounded-full px-2 text-ui-2xs', on ? CHIP_ON : CHIP_OFF)}
        data-slot="ambition-chip"
        data-state={on ? 'on' : 'off'}
        disabled={saving}
        onClick={() => void toggle()}
        type="button"
        variant="ghost"
      >
        <Codicon name="target" size="0.8125rem" />
        <span>Ambition</span>
        {saving ? <Codicon className="animate-spin" name="loading" size="0.7rem" /> : null}
      </Button>
    </Tip>
  )
}
