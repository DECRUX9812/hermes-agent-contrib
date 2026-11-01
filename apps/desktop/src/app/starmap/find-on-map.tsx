import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { Search } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { matchCounterLabel } from './find-matches'

interface FindOnMapProps {
  // Current hit index (0-based) among `matchCount`.
  index: number
  matchCount: number
  onChange: (query: string) => void
  onClear: () => void
  onStep: (direction: 1 | -1) => void
  query: string
}

/**
 * Find a star on the map.
 *
 * Presentational on purpose: matching lives in find-matches.ts and the camera
 * move in star-map.tsx, so this component is only the box, the count and the
 * keys. Every state it can be in is visible — empty box (no counter), hits
 * ("3/12"), and no hits ("No matches", in the danger colour, with the step
 * buttons disabled) — because a search that quietly finds nothing is the one
 * outcome a user cannot diagnose.
 */
export function FindOnMap({ index, matchCount, onChange, onClear, onStep, query }: FindOnMapProps) {
  const { t } = useI18n()
  const typed = query.trim().length > 0
  const none = typed && matchCount === 0

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-1.5 py-1',
        '[-webkit-app-region:no-drag] backdrop-blur-sm'
      )}
    >
      <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />

      <input
        aria-label={t.starmap.find}
        className="w-32 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onStep(event.shiftKey ? -1 : 1)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClear()
          }
        }}
        placeholder={t.starmap.findPlaceholder}
        type="search"
        value={query}
      />

      {typed && (
        <span
          aria-live="polite"
          className={cn(
            'min-w-10 text-center text-[0.62rem] tabular-nums',
            none ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {none ? t.starmap.findNone : matchCounterLabel(index, matchCount)}
        </span>
      )}

      <Button
        aria-label={t.starmap.findPrev}
        className="size-6 text-muted-foreground hover:text-foreground"
        disabled={matchCount === 0}
        onClick={() => onStep(-1)}
        size="icon"
        variant="ghost"
      >
        <span aria-hidden>↑</span>
      </Button>

      <Button
        aria-label={t.starmap.findNext}
        className="size-6 text-muted-foreground hover:text-foreground"
        disabled={matchCount === 0}
        onClick={() => onStep(1)}
        size="icon"
        variant="ghost"
      >
        <span aria-hidden>↓</span>
      </Button>
    </div>
  )
}
