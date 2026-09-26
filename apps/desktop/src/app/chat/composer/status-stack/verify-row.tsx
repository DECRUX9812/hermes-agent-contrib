import { memo } from 'react'

import { previewConsoleState } from '@/app/chat/right-rail/preview-console-store'
import { StatusRow } from '@/components/chat/status-row'
import { Codicon } from '@/components/ui/codicon'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { $previewTabs, openPreview } from '@/store/preview'
import type { PreviewVerifyRecord } from '@/store/preview-verify'

/**
 * One verify_preview verdict as a status row (roadmap #33): spinner while the
 * settle window runs, then pass or fail with the error count. Activating a
 * verdict re-fronts the preview tab it checked and opens its console — the
 * row's job is to take the user to the errors, not to recite them.
 */
export const PreviewVerifyRow = memo(function PreviewVerifyRow({
  item,
  onDismiss
}: {
  item: PreviewVerifyRecord
  onDismiss: () => void
}) {
  const { t } = useI18n()

  const openConsole = () => {
    if (!item.tabId) {
      return
    }

    const tab = $previewTabs.get().find(candidate => candidate.id === item.tabId)

    if (!tab) {
      return
    }

    openPreview(tab.target)
    previewConsoleState(item.tabId).$open.set(true)
  }

  const label = item.running
    ? t.statusStack.verifyChecking
    : item.ok
      ? t.statusStack.verifyPassed
      : t.statusStack.verifyFailed(item.errorCount)

  return (
    <StatusRow
      dismiss={{ label: t.statusStack.dismiss, onDismiss }}
      leading={
        item.running ? (
          <GlyphSpinner
            ariaLabel={t.statusStack.running}
            className="text-[0.8rem] leading-none text-muted-foreground/80"
            spinner="braille"
          />
        ) : (
          <Codicon
            aria-hidden
            className={item.ok ? 'text-emerald-500/80' : 'text-red-400/90'}
            name={item.ok ? 'pass-filled' : 'error'}
            size="0.8rem"
          />
        )
      }
      onActivate={item.running ? undefined : openConsole}
    >
      <Tip
        label={
          <>
            {item.url ?? label}
            <br />
            <span className="opacity-70">{t.statusStack.verifyOpenConsole}</span>
          </>
        }
        placement="row"
      >
        <span className="min-w-0 truncate text-[0.73rem] leading-4 text-foreground/92">
          {label}
          {!item.running && item.firstError && <span className="text-muted-foreground/80"> — {item.firstError}</span>}
        </span>
      </Tip>
    </StatusRow>
  )
})
