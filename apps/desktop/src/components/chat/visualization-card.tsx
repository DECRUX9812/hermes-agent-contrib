'use client'

import { type FC, useCallback, useEffect, useRef, useState } from 'react'

import { useIsDark } from '@/components/assistant-ui/embeds/use-is-dark'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { type VisualizationPayload, visualizationFromResult } from '@/lib/visualizations'
import { cn } from '@/lib/utils'

/**
 * Inline visualization card — renders agent-generated HTML in a sandboxed
 * iframe, T3-Code-style. The iframe runs with `sandbox="allow-scripts"` and
 * deliberately WITHOUT `allow-same-origin`: the viz gets a unique opaque
 * origin, so it cannot reach the parent page, cookies, or localStorage.
 *
 * The host injects `data-theme="dark|light"` on the guest documentElement so
 * the viz can adapt; Hermes is dark-first so dark is the default.
 */

const CARD_MIN_HEIGHT = 320

function themedSrcDoc(html: string, dark: boolean): string {
  // Inject the theme marker as early as possible so the guest can read
  // `document.documentElement.dataset.theme` during its own boot.
  const marker = `<script>document.documentElement.dataset.theme=${JSON.stringify(dark ? 'dark' : 'light')};</script>`
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, match => `${match}${marker}`)
  }
  return marker + html
}

const VisualizationFrame: FC<{
  payload: VisualizationPayload
  dark: boolean
  expanded: boolean
  onLoad: () => void
  onError: () => void
}> = ({ payload, dark, expanded, onLoad, onError }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Re-assert the theme if it flips while the card is mounted.
  useEffect(() => {
    try {
      iframeRef.current?.contentDocument?.documentElement?.setAttribute(
        'data-theme',
        dark ? 'dark' : 'light'
      )
    } catch {
      // Sandboxed without allow-same-origin: opaque origin, no access. The
      // srcDoc injection already set the initial theme; ignore.
    }
  }, [dark])

  return (
    <iframe
      ref={iframeRef}
      className={cn('w-full border-0', expanded ? 'h-[80dvh]' : 'min-h-[320px]')}
      style={expanded ? undefined : { height: CARD_MIN_HEIGHT }}
      onError={onError}
      onLoad={onLoad}
      sandbox="allow-scripts"
      srcDoc={themedSrcDoc(payload.html, dark)}
      title={payload.title}
    />
  )
}

export const VisualizationCard: FC<{ result?: unknown; title?: string }> = ({ result, title }) => {
  const dark = useIsDark()
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const payload = result === undefined ? null : visualizationFromResult(result)
  const pending = result === undefined

  const closeExpanded = useCallback(() => setExpanded(false), [])

  // Escape closes the expanded view.
  useEffect(() => {
    if (!expanded) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeExpanded()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, closeExpanded])

  // The agent's prose carries the explanation on failure — render nothing,
  // same contract as GeneratedImage.
  if (!pending && !payload) {
    return null
  }

  const headerTitle = payload?.title || title || 'Visualization'

  const renderFrame = (isExpanded: boolean) =>
    payload ? (
      <VisualizationFrame
        key={isExpanded ? 'expanded' : 'inline'}
        dark={dark}
        expanded={isExpanded}
        onError={() => setFailed(true)}
        onLoad={() => setLoaded(true)}
        payload={payload}
      />
    ) : null

  return (
    <>
      <div className="mt-1.5 overflow-hidden rounded-lg border border-(--ui-border-subtle) bg-(--ui-surface-sunken)">
        <div className="flex items-center gap-2 px-3 py-2">
          <Codicon className="text-(--ui-text-tertiary)" name="graph" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-(--ui-text-secondary)">
            {headerTitle}
          </span>
          {payload && !failed && (
            <Button
              aria-label="Expand visualization"
              className="h-7 w-7"
              onClick={() => setExpanded(true)}
              size="icon"
              variant="ghost"
            >
              <Codicon name="expand-all" />
            </Button>
          )}
        </div>
        <div className="relative">
          {pending && (
            <div className="flex h-[320px] items-center justify-center">
              <span className="shimmer text-sm text-(--ui-text-tertiary)">
                Rendering visualization…
              </span>
            </div>
          )}
          {failed && (
            <div className="flex h-[120px] flex-col items-center justify-center gap-1 px-4 text-center">
              <Codicon className="text-(--ui-text-tertiary)" name="warning" />
              <p className="text-sm text-(--ui-text-tertiary)">
                The visualization could not be rendered.
              </p>
            </div>
          )}
          {!failed && renderFrame(false)}
          {!loaded && !failed && !pending && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-(--ui-surface-sunken)">
              <span className="shimmer text-sm text-(--ui-text-tertiary)">
                Rendering visualization…
              </span>
            </div>
          )}
        </div>
      </div>

      {expanded && payload && !failed && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/80 p-4 backdrop-blur-sm"
          onClick={closeExpanded}
          role="dialog"
          aria-modal="true"
          aria-label={headerTitle}
        >
          <div className="mb-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <Codicon className="text-white/70" name="graph" />
            <span className="flex-1 truncate text-sm font-medium text-white/90">{headerTitle}</span>
            <Button
              aria-label="Close"
              className="h-8 w-8 text-white/80 hover:text-white"
              onClick={closeExpanded}
              size="icon"
              variant="ghost"
            >
              <Codicon name="close" />
            </Button>
          </div>
          <div
            className="min-h-0 flex-1 overflow-hidden rounded-lg"
            onClick={e => e.stopPropagation()}
          >
            {renderFrame(true)}
          </div>
        </div>
      )}
    </>
  )
}
