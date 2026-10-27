import type { MouseEvent } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Favicon } from '@/components/ui/favicon'
import { Tip } from '@/components/ui/tooltip'
import { useMediaImage } from '@/hooks/use-media-image'
import { useI18n } from '@/i18n'
import { hostPathLabel } from '@/lib/external-link'
import { cn } from '@/lib/utils'
import { openPreview } from '@/store/preview'

import { isPublicHost } from './public-host'
import type { ToolCardView } from './types'

/** A site's icon, inline at 14px. Renders nothing for private hosts so the
 *  lookup never touches the LAN; the fixed empty fallback keeps local names
 *  from flashing a spinner. */
export function SiteFavicon({ host, url }: { host: string; url: string }) {
  if (!isPublicHost(host)) {
    return null
  }

  return (
    <span className="inline-grid size-3.5 shrink-0 place-items-center">
      <Favicon fallback={<span className="block size-full" />} url={url} />
    </span>
  )
}

/** A fixed-size screenshot tile: the box is always the same geometry so the
 *  row never reflows when the image resolves, and it vanishes on failure. */
export function ScreenshotThumb({ src }: { src: string }) {
  const image = useMediaImage(src, 16 / 10)

  if (image.failed) {
    return null
  }

  return (
    <span className="h-10 w-16 shrink-0 overflow-hidden rounded-control border border-line bg-surface-sunken">
      {image.src ? (
        <img
          alt=""
          aria-hidden
          className="h-full w-full object-cover object-top"
          onError={image.onError}
          onLoad={event => image.onLoad(event.currentTarget)}
          src={image.src}
        />
      ) : null}
    </span>
  )
}

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
    <Tip label={url}>
      <Button
        aria-label={label}
        className={cn(iconOnly ? 'shrink-0 text-fg-subtle hover:text-fg' : 'h-6 gap-1 px-1.5 text-ui-xs', className)}
        data-open-page=""
        onClick={open}
        onKeyDown={event => event.stopPropagation()}
        size={iconOnly ? 'icon-xs' : 'sm'}
        type="button"
        variant="ghost"
      >
        <Codicon name="link-external" />
        {iconOnly ? null : label}
      </Button>
    </Tip>
  )
}
