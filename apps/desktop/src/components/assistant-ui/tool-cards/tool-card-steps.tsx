import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Favicon } from '@/components/ui/favicon'
import { useMediaImage } from '@/hooks/use-media-image'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { isPublicHost } from './public-host'
import { CardBlock } from './tool-card-block'
import type { ToolCardGroup, ToolCardView } from './types'

function stepHost(card: ToolCardView): string {
  return card.thumb?.kind === 'site' ? card.thumb.host : ''
}

function stepScreenshot(card: ToolCardView): string {
  return card.thumb?.kind === 'screenshot' ? card.thumb.src : ''
}

/** The settled default is the latest step with a picture, else the last one. */
function latestScreenshotIndex(cards: readonly ToolCardView[]): number | null {
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    if (stepScreenshot(cards[index])) {
      return index
    }
  }

  return null
}

function StepShot({ src }: { src: string }) {
  const image = useMediaImage(src, 16 / 9)

  if (!image.src || image.failed) {
    return null
  }

  return (
    <img
      alt=""
      aria-hidden
      className="h-full w-full object-contain"
      onError={image.onError}
      onLoad={event => image.onLoad(event.currentTarget)}
      src={image.src}
    />
  )
}

/** The browser steps viewer: a frame on the selected step plus an ordered
 *  step list. Key handling sits on the section so arrows work from any of
 *  its buttons without adding a tab stop. */
export function BrowserSteps({ group }: { group: ToolCardGroup }) {
  const { t } = useI18n()
  const copy = t.assistant.toolCards.viewer
  const { cards, name } = group
  const total = cards.length
  const [manual, setManual] = useState<number | null>(null)

  const live = group.state !== 'done'
  const settledDefault = latestScreenshotIndex(cards) ?? total - 1
  const selected = Math.min(manual ?? (live ? total - 1 : settledDefault), total - 1)
  const step = cards[selected]
  const shot = stepScreenshot(step)
  const host = stepHost(step)

  const move = (delta: number) => {
    setManual(Math.min(total - 1, Math.max(0, selected + delta)))
  }

  return (
    <section
      aria-label={copy.title(name)}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft') {
          move(-1)
        } else if (event.key === 'ArrowRight') {
          move(1)
        }
      }}
    >
      <div className="text-ui-xs font-semibold text-fg">{copy.title(name)}</div>
      <div className="mt-1 aspect-video w-full max-w-md overflow-hidden rounded-card border border-line bg-surface-sunken">
        {shot ? (
          <StepShot key={shot} src={shot} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-ui-xs text-fg-subtle">
            {host && isPublicHost(host) && step.thumb?.kind === 'site' ? (
              <span className="inline-grid size-3.5 place-items-center">
                <Favicon fallback={<span className="block size-full" />} url={step.thumb.url} />
              </span>
            ) : null}
            {host ? <span className="truncate">{host}</span> : null}
            <span>{copy.noScreenshot}</span>
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1">
        <Button
          aria-label={copy.previous}
          disabled={selected <= 0}
          onClick={() => move(-1)}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name="chevron-left" />
        </Button>
        <span className="min-w-0 flex-1 text-center text-ui-xs text-fg-muted tabular-nums">
          {copy.step(selected + 1, total)}
        </span>
        <Button
          aria-label={copy.next}
          disabled={selected >= total - 1}
          onClick={() => move(1)}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name="chevron-right" />
        </Button>
      </div>
      <ol className="mt-1 flex flex-col gap-0.5">
        {cards.map((card, index) => {
          const rowHost = stepHost(card)

          return (
            <li key={card.id}>
              <button
                aria-current={index === selected ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-row px-2 py-1 text-left text-ui-xs text-fg-muted hover:bg-hover',
                  index === selected && 'bg-selected text-fg'
                )}
                onClick={() => setManual(index)}
                type="button"
              >
                <span className="shrink-0 tabular-nums">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{card.status}</span>
                {rowHost ? <span className="shrink-0 truncate">{rowHost}</span> : null}
              </button>
            </li>
          )
        })}
      </ol>
      <div className="mt-2">
        <CardBlock card={step} showStatus={false} />
      </div>
    </section>
  )
}
