/**
 * The room header, shared by both surfaces.
 *
 * Bot Mode draws a room twice — the Desktop-local surface (`group-chat-view.tsx`)
 * and the gateway surface (`canonical-group-*.tsx`) — and each drew its own
 * header. They diverged exactly where it hurts: the gateway room hid the
 * destructive action behind an overflow trigger, the local room kept a bare
 * trash button beside Settings and Manage members, so "Disband is one slipped
 * click from a lost room" was true in one room and false in the other.
 *
 * The frame is shared: back, room picture, title, subtitle, one primary action,
 * and an overflow that always holds the destructive item. What each room can do
 * differs, so the menu items and the primary action are injected — but the
 * layout, and the rule that destruction is never a neighbour of a live control,
 * are not.
 */

import {
  Button,
  Codicon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@hermes/plugin-sdk'
import { Fragment, type ReactNode } from 'react'

export interface RoomHeaderAction {
  label: string
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}

interface RoomHeaderProps {
  back?: { label: string; onClick: () => void }
  /** Disables the overflow while the room is mid-mutation. */
  busy?: boolean
  imageSrc?: string
  /** Groups render top to bottom with a rule between them; keep destruction last. */
  menuItems: RoomHeaderAction[][]
  /** Icon-only trigger: its accessible name is the only way in for AT. */
  menuLabel: string
  primary?: ReactNode
  subtitle?: ReactNode
  title: string
}

export function RoomHeader({ back, busy = false, imageSrc, menuItems, menuLabel, primary, subtitle, title }: RoomHeaderProps) {
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
