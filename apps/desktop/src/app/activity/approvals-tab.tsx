import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import {
  $attentionItems,
  requestAttentionReveal,
  type AttentionItem,
  type AttentionItemKind
} from '@/store/attention-inbox'
import { $gateway } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import {
  answerApproval,
  $approvalQueues,
  type ApprovalRequest
} from '@/store/prompts'
import { recordApprovalGranted } from '@/store/bot-rapport'

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
    if (!request || busy) return
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
    if (!sessionId) return
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
        <Codicon name={meta.icon} className={cn('mt-0.5 shrink-0 text-[1rem]', meta.tone)} />
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
          <button
            className={cn(
              'flex-1 rounded-lg bg-emerald-500/15 px-3 py-1.5',
              'text-[0.75rem] font-semibold text-emerald-300',
              'hover:bg-emerald-500/25 disabled:opacity-50'
            )}
            disabled={busy !== null}
            onClick={() => answer('once')}
            type="button"
          >
            {busy === 'once' ? 'Approving...' : 'Approve'}
          </button>
          <button
            className={cn(
              'flex-1 rounded-lg bg-red-500/15 px-3 py-1.5',
              'text-[0.75rem] font-semibold text-red-300',
              'hover:bg-red-500/25 disabled:opacity-50'
            )}
            disabled={busy !== null}
            onClick={() => answer('deny')}
            type="button"
          >
            {busy === 'deny' ? 'Denying...' : 'Deny'}
          </button>
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
        <Codicon name="shield" className="text-[2rem] text-(--ui-text-quaternary)" />
        <p className="text-[0.875rem] font-medium text-foreground">All clear</p>
        <p className="max-w-60 text-[0.75rem] leading-relaxed text-(--ui-text-tertiary)">
          Nothing is waiting on you. When a bot needs approval, it will show up here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2" aria-label="Pending approvals">
      <p className="px-1 text-[0.6875rem] font-medium text-(--ui-text-tertiary)">
        {items.length === 1 ? '1 item needs you' : `${items.length} items need you`}
      </p>
      {items.map(item => (
        <ApprovalCard key={item.id} item={item} />
      ))}
    </div>
  )
}
