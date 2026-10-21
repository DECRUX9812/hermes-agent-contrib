import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Loader2 } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  $attentionItems,
  type AttentionItem,
  type AttentionItemKind,
  requestAttentionReveal
} from '@/store/attention-inbox'
import { recordApprovalGranted } from '@/store/bot-rapport'
import { $gateway } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import {
  $approvalQueues,
  answerApproval,
  type ApprovalRequest
} from '@/store/prompts'

// Approvals tab — everything waiting on the user, with explicit buttons.
// The command is shown in full; Approve and Deny are unambiguous. Follows
// the app's card-stack pattern: one card per request, never a wall of text.

const KIND_META: Record<AttentionItemKind, { icon: string; tone: string }> = {
  approval: { icon: 'shield', tone: 'text-amber-400' },
  clarify: { icon: 'question', tone: 'text-violet-300' },
  error: { icon: 'error', tone: 'text-red-400' },
  secret: { icon: 'key', tone: 'text-amber-400' },
  sudo: { icon: 'terminal', tone: 'text-(--ui-text-secondary)' },
  vaultCode: { icon: 'lock', tone: 'text-(--ui-text-secondary)' },
  vaultSave: { icon: 'lock', tone: 'text-(--ui-text-secondary)' },
  vaultUnlock: { icon: 'unlock', tone: 'text-(--ui-text-secondary)' }
}

function ApprovalCard({ item }: { item: AttentionItem }) {
  const { t } = useI18n()
  const gateway = useStore($gateway)
  const approvalQueues = useStore($approvalQueues)
  const [busy, setBusy] = useState<string | null>(null)

  const meta = KIND_META[item.kind]
  const sessionId = item.sessionId

  // Find the underlying approval request so Approve/Deny can answer it
  // directly. Only approval-kind items carry an answerable request.
  const request: ApprovalRequest | null =
    item.kind === 'approval' && sessionId
      ? (approvalQueues[sessionId] ?? []).find(r => r.requestId && item.id.endsWith(r.requestId)) ?? null
      : null

  const answer = async (choice: 'once' | 'deny') => {
    if (!request || busy) {return}
    setBusy(choice)

    try {
      await answerApproval(gateway, request, choice)

      if (choice === 'once' && sessionId) {
        // Best-effort rapport: the user trusted a bot with something real.
        try {
          recordApprovalGranted(sessionId)
        } catch {
          // Rapport is advisory; never break approvals.
        }
      }

      triggerHaptic('selection')
    } catch (err) {
      notifyError(err, 'Could not answer the request')
    } finally {
      setBusy(null)
    }
  }

  const jumpToSession = () => {
    if (!sessionId) {return}
    requestAttentionReveal(sessionId)
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-(--ui-edge-border)',
        'bg-(--ui-control-background) p-3'
      )}
    >
      <div className="flex items-start gap-2.5">
        <Codicon className={cn('mt-0.5 shrink-0 text-[1rem]', meta.tone)} name={meta.icon} />
        <div className="min-w-0 flex-1">
          <p className="break-words font-mono text-[0.75rem] leading-relaxed text-foreground">
            {item.title}
          </p>
          {item.detail && (
            <p className="mt-1 break-words text-[0.6875rem] leading-relaxed text-(--ui-text-secondary)">
              {item.detail}
            </p>
          )}
          {sessionId && (
            <button
              className="mt-1.5 text-[0.6875rem] font-medium text-violet-300 hover:text-violet-200"
              onClick={jumpToSession}
              type="button"
            >
              Open in conversation
            </button>
          )}
        </div>
      </div>
      {request && (
        <div className="mt-2.5 flex gap-2 border-t border-(--ui-edge-border) pt-2.5">
          <Button
            className="flex-1"
            disabled={busy !== null}
            onClick={() => answer('once')}
            size="sm"
            type="button"
            variant="default"
          >
            {busy === 'once' && <Loader2 className="size-3 animate-spin" />}
            {t.common.approve}
          </Button>
          <Button
            className="flex-1"
            disabled={busy !== null}
            onClick={() => answer('deny')}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy === 'deny' && <Loader2 className="size-3 animate-spin" />}
            {t.common.deny}
          </Button>
        </div>
      )}
    </div>
  )
}

export function ApprovalsTab() {
  const items = useStore($attentionItems)

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <Codicon className="text-[2rem] text-(--ui-text-quaternary)" name="shield" />
        <p className="text-[0.875rem] font-medium text-foreground">All clear</p>
        <p className="max-w-60 text-[0.75rem] leading-relaxed text-(--ui-text-tertiary)">
          Nothing is waiting on you. When a bot needs approval, it will show up here.
        </p>
      </div>
    )
  }

  return (
    <div aria-label="Pending approvals" className="flex flex-col gap-2">
      <p className="px-1 text-[0.6875rem] font-medium text-(--ui-text-tertiary)">
        {items.length === 1 ? '1 item needs you' : `${items.length} items need you`}
      </p>
      {items.map(item => (
        <ApprovalCard item={item} key={item.id} />
      ))}
    </div>
  )
}
