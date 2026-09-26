import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { CheckboxMark } from '@/components/ui/checkbox'
import { Codicon } from '@/components/ui/codicon'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $fleetRoster } from '@/store/fleet-roster'

import { PanelAction, PanelSectionLabel } from '../overlays/panel'

import { type FanOutTarget, fanOutTargets } from './fan-out-model'

/**
 * Parallel fan-out picker (roadmap #21): the user explicitly checks the
 * profiles/bots that get the prompt — there is NO implicit routing — then one
 * send mints a sibling session tile per pick. The roster header renders the
 * collapsed "Fan out" action; this is the expanded panel — a prompt field +
 * the checkbox list. The `onSend` callback (wiring) owns creation + submit;
 * this surface only names the picks and the text.
 */
export function FanOutPanel({
  onCollapse,
  onSend
}: {
  onCollapse: () => void
  onSend: (targets: FanOutTarget[], text: string) => void
}) {
  const { t } = useI18n()
  const roster = useStore($fleetRoster)
  const targets = useMemo(() => fanOutTargets(roster), [roster])

  const [text, setText] = useState('')
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  const toggle = (key: string) =>
    setPicked(current => {
      const next = new Set(current)

      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      return next
    })

  const selected = targets.filter(target => picked.has(target.key))
  const canSend = selected.length > 0 && text.trim().length > 0

  return (
    <div className="mb-3 shrink-0 rounded-md bg-foreground/4 px-3 py-2.5" data-slot="fan-out-panel">
      <PanelSectionLabel className="mb-1.5">{t.roster.fanOutTitle}</PanelSectionLabel>
      <Textarea
        aria-label={t.roster.fanOutTitle}
        autoFocus
        className="mb-2 min-h-9 resize-none text-xs"
        onChange={event => setText(event.target.value)}
        placeholder={t.roster.fanOutPlaceholder}
        value={text}
      />
      <div className="mb-2 grid max-h-40 min-w-0 gap-px overflow-y-auto overscroll-contain">
        {targets.length === 0 ? (
          <p className="px-1 py-1.5 text-[0.68rem] text-muted-foreground/60">{t.roster.fanOutNoAgents}</p>
        ) : (
          targets.map(target => {
            const checked = picked.has(target.key)

            return (
              <button
                aria-pressed={checked}
                className={cn(
                  'row-hover flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-left text-[0.72rem]',
                  checked ? 'text-foreground' : 'text-muted-foreground/75'
                )}
                key={target.key}
                onClick={() => toggle(target.key)}
                type="button"
              >
                <CheckboxMark checked={checked} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate font-medium">{target.agent.handle}</span>
                <span className="shrink-0 truncate text-[0.62rem] text-muted-foreground/55">
                  {target.agent.connectionLabel}
                </span>
              </button>
            )
          })
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <button
          className="flex items-center gap-1 text-[0.68rem] text-muted-foreground/70 hover:text-foreground"
          onClick={onCollapse}
          type="button"
        >
          <Codicon name="chevron-up" size="0.75rem" />
          {t.roster.fanOutClose}
        </button>
        <PanelAction
          disabled={!canSend}
          icon="send"
          onClick={() => {
            if (canSend) {
              onSend(selected, text.trim())
            }
          }}
          primary
        >
          {t.roster.fanOutSend(selected.length)}
        </PanelAction>
      </div>
    </div>
  )
}
