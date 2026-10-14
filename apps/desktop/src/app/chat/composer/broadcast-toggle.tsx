import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $broadcastAvailable, $broadcastOn, setBroadcastOn } from '@/store/broadcast'

import { ACTIVE_ICON_BTN, GHOST_ICON_BTN } from './control-classes'

/** Sends what you type to every visible chat pane. Only offered when there are
 *  two or more panes to send to; it turns itself off below that. */
export function BroadcastToggle({ disabled = false }: { disabled?: boolean }) {
  const { t } = useI18n()
  const available = useStore($broadcastAvailable)
  const on = useStore($broadcastOn)

  if (!available) {
    return null
  }

  const label = t.composer.broadcastTip

  return (
    <Tip
      label={
        <span className="flex flex-col gap-0.5">
          <span>{label}</span>
          <span className="text-fg-subtle">{t.composer.broadcastNote}</span>
        </span>
      }
      placement="control"
    >
      <Button
        aria-label={label}
        aria-pressed={on}
        className={
          on
            ? cn('h-(--composer-control-size) shrink-0 gap-1 rounded-full px-2 text-ui-2xs', ACTIVE_ICON_BTN)
            : GHOST_ICON_BTN
        }
        disabled={disabled}
        onClick={() => {
          triggerHaptic('selection')
          setBroadcastOn(!on)
        }}
        type="button"
        variant="ghost"
      >
        <Codicon name="broadcast" size="0.8125rem" />
        {on ? <span>{t.composer.broadcastOn}</span> : null}
      </Button>
    </Tip>
  )
}
