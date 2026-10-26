import type { MouseEvent } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { hostPathLabel } from '@/lib/external-link'
import { cn } from '@/lib/utils'
import { openPreview } from '@/store/preview'

import type { ToolCardView } from './types'

/** The web page a set of steps was last on: the newest step that knows its
 *  address, at or before `index` (a click or screenshot stays on the page the
 *  last navigation opened). Empty when none of them does. */
export function stepPageUrl(cards: readonly ToolCardView[], index = cards.length - 1): string {
  for (let at = Math.min(index, cards.length - 1); at >= 0; at -= 1) {
    const url = cards[at]?.thumb?.url

    if (url && /^https?:\/\//i.test(url)) {
      return url
    }
  }

  return ''
}

/** Opens a step's page in the side preview. `iconOnly` is the compact form
 *  for a card row, where it must not toggle the row it sits in. */
export function OpenPageButton({
  className,
  iconOnly = false,
  url
}: {
  className?: string
  iconOnly?: boolean
  url: string
}) {
  const { t } = useI18n()
  const label = t.assistant.toolCards.viewer.openPage
  const { $runtimeId, $storedId } = useSessionView()

  const open = (event: MouseEvent) => {
    event.stopPropagation()
    openPreview(
      { kind: 'url', label: hostPathLabel(url), source: url, url },
      $storedId.get() ?? undefined,
      $runtimeId.get()
    )
  }

  return (
    <Button
      aria-label={label}
      className={cn(iconOnly ? 'shrink-0 text-fg-subtle hover:text-fg' : 'h-6 gap-1 px-1.5 text-ui-xs', className)}
      data-open-page=""
      onClick={open}
      onKeyDown={event => event.stopPropagation()}
      size={iconOnly ? 'icon-xs' : 'sm'}
      title={url}
      type="button"
      variant="ghost"
    >
      <Codicon name="link-external" />
      {iconOnly ? null : label}
    </Button>
  )
}
