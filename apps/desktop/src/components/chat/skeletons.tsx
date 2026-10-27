import type { CSSProperties } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { translateNow } from '@/i18n'

// Shared loading skeletons for the file/git trees and diffs — quieter than a
// spinner and shaped like the content that's about to land.

const TREE_ROWS: { indent: number; width: string }[] = [
  { indent: 0, width: '55%' },
  { indent: 1, width: '72%' },
  { indent: 1, width: '46%' },
  { indent: 0, width: '60%' },
  { indent: 1, width: '52%' },
  { indent: 2, width: '40%' },
  { indent: 0, width: '64%' }
]

/** Rows of icon + label bars, mimicking a file tree mid-load. */
export function TreeSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2.5" data-slot="tree-skeleton">
      {TREE_ROWS.map((row, index) => (
        <div
          className="flex items-center gap-2"
          key={`${index}-${row.width}`}
          style={{ paddingLeft: `${row.indent * 12}px` }}
        >
          <Skeleton className="size-3.5 shrink-0 rounded-[3px]" />
          <Skeleton className="h-3" style={{ width: row.width }} />
        </div>
      ))}
    </div>
  )
}

const DIFF_ROWS: string[] = ['72%', '40%', '88%', '55%', '64%', '30%', '80%', '48%', '60%', '36%', '70%']

/** Stacked line bars, mimicking a unified diff mid-load. */
export function DiffSkeleton({ style }: { style?: CSSProperties }) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2" data-slot="diff-skeleton" style={style}>
      {DIFF_ROWS.map((width, index) => (
        <Skeleton className="h-3" key={`${index}-${width}`} style={{ width }} />
      ))}
    </div>
  )
}

/** Wide bars per assistant turn — enough shape to read as "a conversation is
 *  about to land here" without pretending to know its final height. */
const THREAD_USER_BAR = '46%'

const THREAD_TURNS: number[][] = [
  [100, 94, 88, 52],
  [100, 76]
]

/**
 * Transcript-shaped loading state for a session switch.
 *
 * The old state was a centred rose spinner over an empty pane: it reserves no
 * height, so the first paint jumped from a 48px glyph to a full scrollable
 * column, and the eye lost its anchor on every navigation. This occupies the
 * reading column with rows at the real text rhythm instead, so the swap reads
 * as content arriving rather than the page being replaced.
 */
export function ThreadSkeleton() {
  return (
    <div
      aria-label={translateNow('assistant.thread.loadingSession')}
      className="pointer-events-none absolute inset-0 z-1 overflow-hidden"
      data-slot="thread-skeleton"
      role="status"
    >
      <div className="mx-auto flex w-full max-w-(--composer-width) flex-col gap-6 px-6 pt-8">
        <div className="flex justify-end">
          <Skeleton className="h-9 rounded-xl" style={{ width: THREAD_USER_BAR }} />
        </div>
        {THREAD_TURNS.map((bars, turn) => (
          <div className="flex flex-col gap-2.5" key={turn}>
            {bars.map(width => (
              <Skeleton className="h-3.5" key={`${turn}-${width}`} style={{ width: `${width}%` }} />
            ))}
            {turn === 0 && (
              // Card-shaped, not a solid slab: a header line over two content
              // lines reads as a tool call; a bare block reads as a lost image.
              <div className="mt-1 flex flex-col gap-2 rounded-lg border border-(--ui-stroke-quaternary) p-2.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="size-3 shrink-0 rounded-[3px]" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-3 w-2/3" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
