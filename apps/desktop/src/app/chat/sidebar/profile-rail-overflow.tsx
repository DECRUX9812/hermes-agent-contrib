import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { sessionDotClassName } from '../session-status-dot'

export interface ProfileRailOverflowItem {
  glyph: string
  id: string
  label: string
  onSelect: () => void
}

interface ProfileRailOverflowProps {
  /** Rows above the separator (profile verbs); `trailing` rows sit below it. */
  items: ProfileRailOverflowItem[]
  label: string
  /** A fleet run is in flight — the roster row is inside, so the trigger says so. */
  live?: boolean
  trailing: ProfileRailOverflowItem[]
}

// The rail foot keeps three glyphs (home, +, this); every other door on the
// strip lives here so the foot never outgrows a narrow sidebar.
export function ProfileRailOverflow({ items, label, live = false, trailing }: ProfileRailOverflowProps) {
  const row = (item: ProfileRailOverflowItem) => (
    <DropdownMenuItem key={item.id} onSelect={item.onSelect}>
      <Codicon name={item.glyph} size="0.875rem" />
      <span>{item.label}</span>
    </DropdownMenuItem>
  )

  return (
    <DropdownMenu>
      <Tip label={label}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={label}
            className="relative shrink-0 text-fg-muted hover:text-fg data-[state=open]:bg-selected data-[state=open]:text-fg"
            data-slot="profile-rail-overflow"
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Codicon name="ellipsis" size="0.875rem" />
            {live && (
              <span aria-hidden="true" className={cn('absolute right-0.5 top-0.5', sessionDotClassName('working'))} />
            )}
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" side="top">
        {items.map(row)}
        {trailing.length > 0 && items.length > 0 && <DropdownMenuSeparator />}
        {trailing.map(row)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
