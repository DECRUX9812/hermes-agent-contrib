import { browserThumbnailSource, useBrowserStepSnapshot, useBrowserStepThumbnail } from '@/components/assistant-ui/tool-cards/browser-step-resource'
import { useMediaImage } from '@/hooks/use-media-image'
import { useI18n } from '@/i18n'
import type { PreviewTarget } from '@/store/preview'

function outputText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value === undefined || value === null) {
    return ''
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function DetailSection({ label, value }: { label: string; value: string }) {
  return (
    <section className="grid min-w-0 gap-1">
      <h3 className="text-ui-xs font-medium text-fg-secondary">{label}</h3>
      <pre className="max-h-48 min-w-0 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-row bg-surface-sunken p-2 font-mono text-ui-xs text-fg">
        {value}
      </pre>
    </section>
  )
}

function ToolStepPaneContent({ step }: { step: NonNullable<PreviewTarget['step']> }) {
  const { t } = useI18n()
  const browser = step.family === 'browser'
  const request = { owner: step.owner, profile: undefined, sessionId: step.sessionId, toolCallId: step.toolCallId }
  const thumbnailQuery = useBrowserStepThumbnail(request, browser)
  const snapshotQuery = useBrowserStepSnapshot(request, browser)
  const fallbackSrc = step.thumbnail?.kind === 'screenshot' ? step.thumbnail.src : undefined
  const thumbnail = browserThumbnailSource(thumbnailQuery.data, fallbackSrc)
  const image = useMediaImage(thumbnail ?? '', 16 / 9)
  const args = outputText(step.args)
  const result = outputText(step.result)
  const label = t.assistant.toolCards
  const browserUrl = step.url ?? snapshotQuery.data?.url ?? thumbnailQuery.data?.url

  return (
    <aside aria-label={step.title ?? label.viewer.title(step.name)} className="flex h-full min-w-0 flex-col gap-3 overflow-auto p-(--space-panel)" data-tool-step-pane="">
      <h2 className="text-ui-sm font-semibold text-fg">{step.title ?? label.viewer.title(step.name)}</h2>
      <DetailSection label={label.viewer.action} value={step.action} />
      {browser && browserUrl ? <DetailSection label={label.viewer.url} value={browserUrl} /> : null}
      {step.durationLabel ? (
        <section className="flex items-center justify-between gap-3 text-ui-xs">
          <h3 className="font-medium text-fg-secondary">{label.details.duration}</h3>
          <span className="font-mono tabular-nums text-fg">{step.durationLabel}</span>
        </section>
      ) : null}
      {args ? <DetailSection label={label.details.request} value={args} /> : null}
      <section className="grid min-w-0 gap-1">
        <h3 className="text-ui-xs font-medium text-fg-secondary">{label.details.output}</h3>
        <pre className="max-h-64 min-w-0 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-row bg-surface-sunken p-2 font-mono text-ui-xs text-fg">
          {result || label.details.noOutput}
        </pre>
      </section>
      {browser && snapshotQuery.data?.found && snapshotQuery.data.text ? (
        <DetailSection label={label.viewer.snapshot} value={snapshotQuery.data.text} />
      ) : null}
      {thumbnail && image.src && !image.failed ? (
        <section className="grid min-w-0 gap-1">
          <h3 className="text-ui-xs font-medium text-fg-secondary">{label.viewer.thumbnail}</h3>
          <div className="aspect-video w-full overflow-hidden rounded-card bg-surface-sunken">
            <img
              alt={step.name}
              className="h-full w-full object-contain"
              onError={image.onError}
              onLoad={event => image.onLoad(event.currentTarget)}
              src={image.src}
            />
          </div>
        </section>
      ) : null}
    </aside>
  )
}

export function ToolStepPane({ target }: { target: PreviewTarget }) {
  if (!target.step) {
    return null
  }

  return <ToolStepPaneContent step={target.step} />
}
