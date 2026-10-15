import { useStore } from '@nanostores/react'
import { useNavigate } from 'react-router'

import { openSession } from '@/app/open-session'
import { StatusBadge } from '@/components/status-dot'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import {
  $attentionItems,
  type AttentionItem,
  type AttentionItemKind,
  requestAttentionReveal
} from '@/store/attention-inbox'
import { storedSessionIdForRuntimeId } from '@/store/session-states'

const KIND_META: Record<AttentionItemKind, { icon: string; tone: string }> = {
  approval: { icon: 'shield', tone: 'text-warning' },
  clarify: { icon: 'question', tone: 'text-info' },
  error: { icon: 'error', tone: 'text-danger' },
  secret: { icon: 'key', tone: 'text-warning' },
  sudo: { icon: 'terminal', tone: 'text-fg-secondary' },
  vaultCode: { icon: 'lock', tone: 'text-fg-secondary' },
  vaultSave: { icon: 'lock', tone: 'text-fg-secondary' },
  vaultUnlock: { icon: 'unlock', tone: 'text-fg-secondary' }
}

function openAttentionItem(item: AttentionItem, navigate: ReturnType<typeof useNavigate>): void {
  if (!item.sessionId) {
    return
  }

  requestAttentionReveal(item.sessionId)
  openSession(storedSessionIdForRuntimeId(item.sessionId) ?? item.sessionId, navigate, 'stack')
}

function AttentionRow({ item, navigate }: { item: AttentionItem; navigate: ReturnType<typeof useNavigate> }) {
  const { t } = useI18n()
  const meta = KIND_META[item.kind]

  return (
    <li>
      <button
        className="focus-ring flex w-full min-w-0 items-start gap-3 rounded-row px-3 py-2.5 text-left hover:bg-hover"
        disabled={!item.sessionId}
        onClick={() => openAttentionItem(item, navigate)}
        type="button"
      >
        {item.kind === 'approval' ? (
          <StatusBadge
            aria-label={t.assistant.approval.jumpToApproval}
            className="mt-1"
            state="needs-approval"
          />
        ) : (
          <Codicon className={`mt-0.5 shrink-0 ${meta.tone}`} name={meta.icon} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui-sm font-medium text-fg">{item.title || t.attentionInbox.kinds[item.kind]}</span>
          {item.detail ? <span className="mt-0.5 block truncate text-ui-xs text-fg-secondary">{item.detail}</span> : null}
        </span>
        {item.sessionId ? (
          <span className="shrink-0 text-ui-xs text-fg-muted">{t.common.open}</span>
        ) : null}
      </button>
    </li>
  )
}

export function ApprovalsTab() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const items = useStore($attentionItems)
  const count = items.length

  return (
    <section aria-label={t.attentionInbox.title} className="flex min-h-0 flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-ui-sm font-medium text-fg">{t.attentionInbox.title}</h2>
        {count > 0 ? <span className="font-mono text-ui-xs tabular-nums text-fg-muted">{t.attentionInbox.count(count)}</span> : null}
      </div>
      {count === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
          <Codicon className="text-fg-subtle" name="shield" />
          <p className="text-ui-xs text-fg-muted">{t.attentionInbox.empty}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map(item => (
            <AttentionRow item={item} key={item.id} navigate={navigate} />
          ))}
        </ul>
      )}
    </section>
  )
}
