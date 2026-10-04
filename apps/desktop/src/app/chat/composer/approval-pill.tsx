import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { useApprovalModeMenu } from '@/app/shell/approval-mode-menu'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { releaseTypingFocus } from '@/components/ui/keyboard-first'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { $activeGatewayProfile } from '@/store/profile'

const PILL = cn(
  'h-(--composer-control-size) max-w-40 shrink-0 gap-1 rounded-md px-2 text-xs font-normal',
  'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
)

/**
 * Composer approval-mode picker — the permission posture (Ask / Smart /
 * Autonomous) surfaced next to Send instead of only in the statusbar, matching
 * the pattern every agent app converged on (Claude's mode selector, Goose's
 * bottom-bar toggle). Same shared menu + profile-scoped store as the statusbar
 * item, so both controls stay in sync.
 */
export function ApprovalPill({ compact = false, disabled }: { compact?: boolean; disabled: boolean }) {
  const profile = useStore($activeGatewayProfile)
  const { requestGateway } = useGatewayRequest()
  const { icon, label, menuContent, mode, title } = useApprovalModeMenu(profile, requestGateway)
  const [open, setOpen] = useState(false)

  // Closing the menu ends its claim on the keyboard: Radix restores focus to
  // this pill, so without the release the Enter that picked a mode swallows
  // whatever the user types next (same fix as the model pill).
  const setMenuOpen = (next: boolean) => {
    setOpen(next)

    if (!next) {
      releaseTypingFocus()
    }
  }

  const pillClass = compact
    ? cn(
        'size-(--composer-control-size) shrink-0 justify-center gap-0 rounded-md p-0',
        'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
      )
    : PILL

  return (
    <DropdownMenu onOpenChange={setMenuOpen} open={open}>
      <Tip label={title} side="top">
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={title}
            className={cn(pillClass, mode === 'off' && 'text-foreground')}
            disabled={disabled}
            type="button"
            variant="ghost"
          >
            {icon}
            {!compact && <span className="truncate">{label}</span>}
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-72 p-1" side="top" sideOffset={8}>
        {menuContent}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
