import { cn, useQuery } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { api, type DiffSummary as Diff, keys, type PptxShape, type Preview } from './api'
import { useDeskI18n } from './i18n'
import { Empty, QueryError, SkeletonLines } from './ui'

interface PreviewProps {
  changed: Set<string>
  preview: Preview
}

function DocView({ docx }: { docx: NonNullable<Preview['docx']> }) {
  const t = useDeskI18n()
  const paragraphs = docx.paragraphs ?? []
  const comments = docx.comments ?? []

  if (!paragraphs.length) {
    return <Empty>{t('docNoText')}</Empty>
  }

  return (
    <div className="flex flex-col gap-1.5 text-ui-sm">
      {paragraphs.map((paragraph, index) => {
        const heading = /^(heading|title)/i.test(paragraph.style ?? '')

        return (
          <p className={cn(heading && 'text-ui-md font-semibold')} key={index} title={paragraph.style || undefined}>
            {(paragraph.runs ?? []).map((run, runIndex) => (
              <span
                className={cn(run.rev === 'ins' && 'text-brand underline underline-offset-2', run.rev === 'del' && 'text-fg-subtle line-through')}
                key={runIndex}
                title={
                  run.rev
                    ? `${run.rev === 'ins' ? 'Inserted' : 'Deleted'}${run.author ? ` by ${run.author}` : ''}`
                    : undefined
                }
              >
                {run.text}
              </span>
            ))}
          </p>
        )
      })}
      {comments.length ? (
        <div className="mt-1 flex flex-col gap-1.5 border-t border-line pt-2">
          <div className="text-ui-2xs font-semibold text-fg-muted">{t('comments')}</div>
          {comments.map(comment => (
            <div className={cn('rounded-row bg-warning/10 px-2 py-1 text-ui-xs', comment.resolved && 'opacity-60')} key={comment.id}>
              <div className="text-ui-2xs text-fg-muted">
                {comment.author || t('unknownAuthor')}
                {comment.anchor ? t('commentAnchor', comment.anchor) : null}
                {comment.resolved ? ' · ' + t('statusDone') : null}
              </div>
              <div>{comment.text}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function normalizeAddress(address: unknown): string {
  return String(address ?? '')
    .replace(/\$/g, '')
    .replace(/^'(.*)'!/, '$1!')
    .toUpperCase()
}

function isChanged(changed: Set<string>, sheet: string, ref: string | undefined): boolean {
  const cell = normalizeAddress(ref)

  return changed.has(`${String(sheet).toUpperCase()}!${cell}`) || changed.has(cell)
}

function SheetView({ changed, xlsx }: { changed: Set<string>; xlsx: NonNullable<Preview['xlsx']> }) {
  const t = useDeskI18n()
  const sheets = xlsx.sheets ?? []

  if (!sheets.length) {
    return <Empty>{t('workbookNoSheets')}</Empty>
  }

  return (
    <div className="flex flex-col gap-2">
      {sheets.map(sheet => (
        <div className="flex flex-col gap-1" key={sheet.name}>
          <div className="text-ui-2xs font-semibold text-fg-muted">
            {sheet.name}
            {sheet.dims ? <span className="font-normal"> · {sheet.dims}</span> : null}
          </div>
          <div className="overflow-auto">
            <table className="border-collapse font-mono text-ui-2xs tabular-nums">
              <tbody>
                {(sheet.rows ?? []).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td
                        className={cn(
                          'max-w-40 min-w-14 overflow-hidden text-ellipsis whitespace-nowrap border border-line px-1.5 py-0.5',
                          isChanged(changed, sheet.name, cell.ref) && 'bg-brand/15 font-semibold text-fg'
                        )}
                        key={cell.ref ?? cellIndex}
                        title={[cell.ref, cell.formula].filter(Boolean).join('  ') || undefined}
                      >
                        {cell.value === null || cell.value === undefined ? '' : String(cell.value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function pct(value: unknown, total: number): string {
  return total ? `${(Number(value || 0) / total) * 100}%` : '0%'
}

function DeckView({ pptx }: { pptx: NonNullable<Preview['pptx']> }) {
  const t = useDeskI18n()
  const slides = pptx.slides ?? []
  const width = Number(pptx.slide_w) || 0
  const height = Number(pptx.slide_h) || 0

  if (!slides.length) {
    return <Empty>{t('deckNoSlides')}</Empty>
  }

  return (
    <div className="flex flex-col gap-2">
      {slides.map(slide => (
        <div className="flex flex-col gap-1" key={slide.index}>
          <div className="text-ui-2xs font-semibold text-fg-muted">
            {t('slide', Number(slide.index) + 1)}
            {slide.title ? <span className="font-normal"> · {slide.title}</span> : null}
          </div>
          <div
            className="relative w-full overflow-hidden rounded-control border border-line-strong bg-surface-raised"
            style={{ aspectRatio: width && height ? `${width} / ${height}` : '16 / 9' }}
          >
            {(slide.shapes ?? []).map((shape: PptxShape, index) => (
              <div
                className="absolute overflow-hidden whitespace-pre-wrap rounded-sm border border-brand/25 px-0.5 py-0.5 text-fg-secondary"
                key={`${shape.name}-${index}`}
                style={{
                  height: pct(shape.h, height),
                  left: pct(shape.x, width),
                  top: pct(shape.y, height),
                  width: pct(shape.w, width)
                }}
                title={`${shape.name} (${shape.kind})`}
              >
                {shape.text}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PreviewBody({ changed, preview }: PreviewProps) {
  if (preview.kind === 'docx') {
    return <DocView docx={preview.docx ?? {}} />
  }

  if (preview.kind === 'xlsx') {
    return <SheetView changed={changed} xlsx={preview.xlsx ?? {}} />
  }

  if (preview.kind === 'pptx') {
    return <DeckView pptx={preview.pptx ?? {}} />
  }

  return null
}

export interface PreviewPaneProps {
  changed: Set<string>
  emptyText?: string
  enabled?: boolean
  label: string
  path: string
  receiptId?: number | string
  version: string
}

export function PreviewPane({ changed, emptyText, enabled = true, label, path, receiptId, version }: PreviewPaneProps) {
  const { data, error, isLoading, refetch } = useQuery({
    enabled,
    queryFn: () => api.preview(path, receiptId),
    queryKey: keys.preview(path, receiptId, version)
  })

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line">
      <div className="border-b border-line px-2 py-1 text-ui-2xs font-semibold text-fg-muted">{label}</div>
      <div className="min-h-48 max-h-96 overflow-auto p-2">
        {!enabled && emptyText ? <Empty>{emptyText}</Empty> : null}
        {enabled && isLoading ? <SkeletonLines lines={6} /> : null}
        {enabled && error ? <QueryError error={error} onRetry={refetch} /> : null}
        {enabled && data ? <PreviewBody changed={changed} preview={data} /> : null}
      </div>
    </div>
  )
}

function texts(list: { text?: string }[] | undefined): string {
  return (list ?? [])
    .map(part => part?.text ?? '')
    .join(' ')
}

function DiffList({ items }: { items: ReactNode[] }) {
  return items.length ? (
    <ul className="flex max-h-48 flex-col gap-0.5 overflow-auto pt-1.5 text-ui-xs text-fg-secondary">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  ) : null
}

function docxDiff(diff: Diff, t: ReturnType<typeof useDeskI18n>): { counts: string[]; items: ReactNode[] } {
  const revisions = diff.revisions ?? []
  const changed = diff.paragraphs_changed ?? []

  return {
    counts: [t('trackedChanges', revisions.length), t('paragraphsChanged', changed.length)],
    items: [
      ...revisions.map(rev => `${rev.revision_type}${rev.author ? ` (${rev.author})` : ''}: ${rev.text}`),
      ...changed.map(change => `“${change.before}” → “${change.after}”`)
    ]
  }
}

function xlsxDiff(diff: Diff, t: ReturnType<typeof useDeskI18n>): { counts: string[]; items: ReactNode[] } {
  const changed = diff.changed ?? []
  const shifted = diff.shifted ?? []
  const added = diff.added_sheets ?? []
  const removed = diff.removed_sheets ?? []

  return {
    counts: [
      t('cellsChanged', changed.length),
      t('cellsShifted', shifted.length),
      ...(added.length ? [t('sheetsAdded', added.join(', '))] : []),
      ...(removed.length ? [t('sheetsRemoved', removed.join(', '))] : [])
    ],
    items: [
      ...changed.map(cell => `${cell.address}: ${String(cell.before ?? '∅')} → ${String(cell.after ?? '∅')}`),
      ...shifted.map(cell => `${cell.from} → ${cell.to}${cell.value !== undefined ? ` (${String(cell.value)})` : ''}`)
    ]
  }
}

function countOf(value: number | undefined): number {
  return Number(value) || 0
}

function pptxDiff(diff: Diff, t: ReturnType<typeof useDeskI18n>): { counts: string[]; items: ReactNode[] } {
  const slides = diff.slide_changes ?? []
  const changes = slides.flatMap(slide => (slide.text_changes ?? []).map(change => ({ change, slide })))

  return {
    counts: [
      t('slidesAdded', countOf(diff.slides_added)),
      t('slidesRemoved', countOf(diff.slides_removed)),
      t('slidesMoved', countOf(diff.slides_moved)),
      t('textChanges', changes.length)
    ],
    items: changes.map(
      ({ change, slide }) =>
        `Slide ${slide.slide_id} · ${change.shape?.name ?? 'shape'} (${change.kind}): “${texts(change.before)}” → “${texts(change.after)}”`
    )
  }
}

const DIFF_SUMMARIES: Record<string, (diff: Diff, t: ReturnType<typeof useDeskI18n>) => { counts: string[]; items: ReactNode[] }> = {
  docx: docxDiff,
  pptx: pptxDiff,
  xlsx: xlsxDiff
}

export function DiffSummary({ diff }: { diff: Diff }) {
  const t = useDeskI18n()
  const summarize = diff ? DIFF_SUMMARIES[diff.kind] : undefined

  if (!summarize) {
    return null
  }

  const { counts, items } = summarize(diff, t)

  return (
    <details className="rounded-row bg-surface-sunken px-2.5 py-1.5">
      <summary className="cursor-pointer text-ui-xs text-fg-secondary">{counts.join(' · ')}</summary>
      <DiffList items={items} />
    </details>
  )
}

/** Sheet addresses touched by an xlsx diff, normalized for cell highlighting. */
export function changedCells(diff: Diff | undefined): Set<string> {
  return new Set(
    diff && diff.kind === 'xlsx' ? (diff.changed ?? []).map(cell => normalizeAddress(cell.address)) : []
  )
}

export function hasTrackedRuns(preview: Preview | undefined): boolean {
  return (preview?.docx?.paragraphs ?? []).some(paragraph => (paragraph.runs ?? []).some(run => Boolean(run.rev)))
}
