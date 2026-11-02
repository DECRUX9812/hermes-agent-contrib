/**
 * SurfaceHeader — the header every surface uses.
 *
 * This started life inside one plugin, because Bot Mode drew a room twice and
 * the two copies had already diverged: one hid the destructive action behind an
 * overflow, the other kept a bare trash button next to Settings. The divergence
 * was not a Bot Mode problem; it was the absence of a contract. So the frame
 * lives in the shell now and the plugin consumes it through the SDK, which is
 * what makes "one header" enforceable rather than aspirational.
 *
 * The frame owns: back, surface picture, title, a subtitle slot, at most one
 * primary action, and an overflow whose menu is supplied by the caller — with
 * the rule that destruction is never a neighbour of a live control.
 *
 * Styling is token-only; no literal colours, no per-caller overrides.
 */

import { Fragment, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

export interface SurfaceHeaderAction {
  label: string
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}

interface SurfaceHeaderProps {
  back?: { label: string; onClick: () => void }
  /** Disables the overflow while the room is mid-mutation. */
  busy?: boolean
  imageSrc?: string
  /** Groups render top to bottom with a rule between them; keep destruction last. */
  menuItems: SurfaceHeaderAction[][]
  /** Icon-only trigger: its accessible name is the only way in for AT. */
  menuLabel: string
  primary?: ReactNode
  subtitle?: ReactNode
  title: string
}

export function SurfaceHeader({ back, busy = false, imageSrc, menuItems, menuLabel, primary, subtitle, title }: SurfaceHeaderProps) {
  return (
    <header className="flex min-w-0 items-center gap-2">
      {back && <Button onClick={back.onClick} size="sm" variant="ghost">{back.label}</Button>}
      {imageSrc ? (
        <img alt="" className="size-6 shrink-0 rounded-md object-cover ring-1 ring-(--ui-stroke-secondary)" src={imageSrc} />
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-(--chrome-action-hover) text-(--ui-text-secondary)">
          <Codicon name="organization" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-medium">{title}</h2>
        {subtitle}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {primary}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={menuLabel} disabled={busy} size="sm" variant="ghost">
              <Codicon name="kebab-horizontal" size="0.875rem" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menuItems.map((group, groupIndex) => (
              <Fragment key={groupIndex}>
                {groupIndex > 0 && <DropdownMenuSeparator />}
                {group.map(item => (
                  <DropdownMenuItem
                    className={item.destructive ? 'text-destructive focus:text-destructive' : undefined}
                    disabled={item.disabled}
                    key={item.label}
                    onSelect={item.onSelect}
                  >
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
