import { useStore } from '@nanostores/react'
import type * as React from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { RowButton } from '@/components/ui/row-button'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { openExternalLink } from '@/lib/external-link'
import { AlertTriangle, ExternalLink } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $corruptSessionStores } from '@/store/session'

import { SidebarRowCluster, SidebarRowShell, SidebarRowStack } from './chrome'

// Stands in for session rows, so it borrows their chrome instead of copying
// the grid — a placeholder on a different edge than the rows it resolves into
// makes the list step sideways on load. Varied widths read as text, not a bar.
const SKELETON_WIDTHS = ['w-[62%]', 'w-[84%]', 'w-[71%]', 'w-[78%]'] as const

export function SidebarSessionSkeletons() {
  return (
    <SidebarRowStack aria-hidden="true">
      {SKELETON_WIDTHS.map((width, i) => (
        <SidebarRowShell key={i}>
          <SidebarRowCluster>
            <Skeleton className={cn('h-3 rounded-sm', width)} />
          </SidebarRowCluster>
        </SidebarRowShell>
      ))}
    </SidebarRowStack>
  )
}

export function SidebarEmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="px-3.5 py-2 text-ui-xs text-fg-subtle">{children}</p>
}

export function SidebarGhostRow({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <RowButton
      className="mx-1.5 flex h-(--row-h) min-w-0 items-center gap-2 rounded-row px-2 text-left text-ui-sm text-fg-secondary transition-colors duration-(--dur-instant) hover:bg-hover hover:text-fg focus-ring"
      onClick={onClick}
    >
      <Codicon className="shrink-0 text-fg-muted" name={icon} size="0.75rem" />
      <span className="min-w-0 truncate">{label}</span>
    </RowButton>
  )
}

export function SidebarPinnedEmptyState() {
  const { t } = useI18n()

  return (
    <div className="flex min-h-7 items-center gap-1.5 rounded-lg pl-2 text-[0.75rem] text-(--ui-text-tertiary)">
      <span className="grid w-3.5 shrink-0 place-items-center text-(--ui-text-quaternary)">
        <Codicon name="pin" size="0.75rem" />
      </span>
      <span>{t.sidebar.shiftClickHint}</span>
    </div>
  )
}

// A failed drill-in load must not share the "no sessions yet" copy — that
// reads as data loss. Borrows the row chrome so it resolves into the rows it
// replaces without the list stepping sideways.
export function SidebarLoadErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n()

  return (
    <div className="grid min-h-16 place-items-center rounded-lg px-2 text-center">
      <div className="flex flex-col items-center gap-2">
        <Codicon className="text-(--ui-text-quaternary)" name="error" size="1rem" />
        <p className="text-xs text-(--ui-text-tertiary)">{t.sidebar.projectLoadFailed}</p>
        <Button className="mt-0.5 text-(--ui-text-secondary)" onClick={onRetry} size="sm" variant="ghost">
          <Codicon name="refresh" size="0.75rem" />
          {t.common.retry}
        </Button>
      </div>
    </div>
  )
}

const SESSION_STORAGE_RECOVERY_URL =
  'https://hermes-agent.nousresearch.com/docs/user-guide/session-storage-recovery#when-the-three-steps-do-not-work'

interface SidebarStorageCorruptNoticeProps {
  openRecoveryGuide?: (url: string) => void
}

// A structurally corrupt state.db empties (or thins out) the list below it,
// which reads as deleted history (#72046). Persistent while the backend
// reports the store corrupt; there is nothing to dismiss until it is recovered.
export function SidebarStorageCorruptNotice({
  openRecoveryGuide = openExternalLink
}: SidebarStorageCorruptNoticeProps) {
  const profiles = useStore($corruptSessionStores)
  const { t } = useI18n()
  const copy = t.sidebar.storageCorrupt

  if (profiles.length === 0) {
    return null
  }

  return (
    <div className="shrink-0 px-2 pb-1 pt-1">
      <Alert className="gap-x-2 px-3 py-2 text-xs" data-testid="storage-corrupt-notice" variant="destructive">
        <AlertTriangle />
        <AlertTitle className="line-clamp-none">{copy.title}</AlertTitle>
        <AlertDescription>
          <p>{copy.body(profiles.join(', '))}</p>
          <p>{copy.action}</p>
          <code className="break-all text-[0.7rem]">
            hermes sessions recover --source &lt;state.db&gt; --inspect-only
          </code>
          <Button
            className="-ml-1 mt-0.5 text-(--ui-text-secondary)"
            onClick={() => openRecoveryGuide(SESSION_STORAGE_RECOVERY_URL)}
            size="sm"
            variant="ghost"
          >
            <ExternalLink />
            {copy.guide}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}
