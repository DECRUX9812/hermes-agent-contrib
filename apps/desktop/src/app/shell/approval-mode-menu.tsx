import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useMemo } from 'react'

import type { StatusbarItem } from '@/app/shell/statusbar-controls'
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { Zap, ZapFilled } from '@/lib/icons'
import {
  $approvalModes,
  type ApprovalMode,
  type ApprovalModeRequester,
  setApprovalModeForProfile,
  syncApprovalModeForProfile
} from '@/store/approval-mode'

export interface ApprovalModeMenu {
  mode: ApprovalMode
  /** Current-mode icon — filled when approvals are off (autonomous). */
  icon: ReactNode
  /** `Manual` / `Smart` / `Off` for the current mode. */
  label: string
  /** The radio menu body; the caller wraps it in its own MenuContent. */
  menuContent: ReactNode
  /** Accessibility/tooltip title for the current mode. */
  title: string
}

/** Shared approval-mode menu state — the same mode picker backs the statusbar
 *  item and the composer pill, so both flip together (profile-scoped, backend-
 *  synced via `config.set`). */
export function useApprovalModeMenu(profile: string, requestGateway: ApprovalModeRequester): ApprovalModeMenu {
  const { t } = useI18n()
  const copy = t.shell.approvalMode
  const modes = useStore($approvalModes)
  const mode = modes[profile.trim() || 'default'] ?? 'smart'

  const labels = useMemo<Record<ApprovalMode, string>>(
    () => ({ manual: copy.manual, smart: copy.smart, off: copy.off }),
    [copy.manual, copy.off, copy.smart]
  )

  const descriptions = useMemo<Record<ApprovalMode, string>>(
    () => ({
      manual: copy.manualDescription,
      smart: copy.smartDescription,
      off: copy.offDescription
    }),
    [copy.manualDescription, copy.offDescription, copy.smartDescription]
  )

  useEffect(() => {
    void syncApprovalModeForProfile(requestGateway, profile).catch(() => undefined)
  }, [profile, requestGateway])

  const menuContent = (
    <>
      <DropdownMenuLabel>{copy.title}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuRadioGroup
        onValueChange={value => {
          void setApprovalModeForProfile(requestGateway, profile, value as ApprovalMode).catch(() => undefined)
        }}
        value={mode}
      >
        {(['manual', 'smart', 'off'] as const).map(value => (
          <DropdownMenuRadioItem className="items-start gap-2" key={value} value={value}>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-foreground">{labels[value]}</span>
              <span className="text-[0.6875rem] leading-snug text-(--ui-text-tertiary)">{descriptions[value]}</span>
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  )

  return {
    icon: mode === 'off' ? <ZapFilled className="size-3.5" /> : <Zap className="size-3.5 opacity-70" />,
    label: labels[mode],
    menuContent,
    mode,
    title: copy.ariaLabel(labels[mode])
  }
}

export function useApprovalModeStatusbarItem(profile: string, requestGateway: ApprovalModeRequester): StatusbarItem {
  const { icon, label, menuContent, mode, title } = useApprovalModeMenu(profile, requestGateway)

  return {
    className: mode === 'off' ? 'bg-(--chrome-action-hover) text-foreground' : undefined,
    icon,
    id: 'approval-mode',
    label,
    menuAlign: 'end',
    menuClassName: 'w-72 p-1',
    menuContent,
    title,
    variant: 'menu'
  }
}
