import { useStore } from '@nanostores/react'

import { useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import { triggerHaptic } from '@/lib/haptics'
import {
  AlertCircle,
  HelpCircle,
  KeyRound,
  Lock,
  MessageQuestion,
  ShieldLock,
  Terminal
} from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $attentionItems, type AttentionItem, type AttentionItemKind, requestAttentionReveal } from '@/store/attention-inbox'
import { $cronSessions, $messagingSessions, $sessions } from '@/store/session'
import { storedSessionIdForRuntimeId } from '@/store/session-states'
import { buildSessionByAnyId } from '../chat/sidebar/session-index'
import { OverlayView } from '../overlays/overlay-view'

const KIND_ICONS: Record<AttentionItemKind, { className: string; icon: typeof AlertCircle }> = {
  approval: { className: 'text-amber-500', icon: ShieldLock },
  clarify: { className: 'text-(--ui-text-secondary)', icon: MessageQuestion },
  error: { className: 'text-destructive', icon: AlertCircle },
  secret: { className: 'text-(--ui-text-secondary)', icon: KeyRound },
  sudo: { className: 'text-(--ui-text-secondary)', icon: Terminal },
  'vault-code': { className: 'text-(--ui-text-secondary)', icon: HelpCircle },
  'vault-save': { className: 'text-(--ui-text-secondary)', icon: Lock },
  'vault-unlock': { className: 'text-(--ui-text-secondary)', icon: Lock }
}

interface AttentionInboxViewProps {
  onClose: () => void
  /** Opens a stored session id (the wiring hands in `openSession`). */
  onOpenSession: (storedSessionId: string) => void
}

/**
 * Roadmap #16 — the attention inbox: every pending approval, clarify, prompt,
 * and session-scoped error across profiles in one overlay. Clicking a row
 * closes the overlay, opens that session, and hands the transcript a one-shot
 * marker (`requestAttentionReveal`) so it lands scrolled to the waiting card.
 */
export function AttentionInboxView({ onClose, onOpenSession }: AttentionInboxViewProps) {
  const { t } = useI18n()
  const copy = t.attentionInbox
  const items = useStore($attentionItems)
  const sessions = useStore($sessions)
  const cronSessions = useStore($cronSessions)
  const messagingSessions = useStore($messagingSessions)
  const sessionByAnyId = buildSessionByAnyId(sessions, cronSessions, messagingSessions)

  const open = (item: AttentionItem) => {
    if (!item.sessionId) {
      return
    }

    const storedId = storedSessionIdForRuntimeId(item.sessionId) ?? item.sessionId

    triggerHaptic('selection')
    requestAttentionReveal(item.sessionId)
    onOpenSession(storedId)
    onClose()
  }

  const titleOf = (item: AttentionItem): string => {
    if (!item.sessionId) {
      return copy.appScope
    }

    const session = sessionByAnyId.get(storedSessionIdForRuntimeId(item.sessionId) ?? item.sessionId)

    return session ? sessionTitle(session) : copy.unknownSession
  }

  return (
    <OverlayView onClose={onClose} rootClassName="mx-auto w-full max-w-xl">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-baseline justify-between px-5 pt-[calc(var(--titlebar-height)+0.875rem)] pb-2">
          <h1 className="text-[length:var(--conversation-text-font-size)] font-semibold text-foreground">
            {copy.title}
          </h1>
          {items.length > 0 && (
            <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
              {copy.count(items.length)}
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="grid min-h-48 flex-1 place-items-center px-6 pb-8 text-center">
            <div className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
              {copy.empty}
            </div>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {items.map(item => {
              const tone = KIND_ICONS[item.kind]
              const Icon = tone.icon
              const navigable = Boolean(item.sessionId)
              const sessionName = titleOf(item)

              return (
                <li key={item.id}>
                  <button
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left',
                      navigable
                        ? 'cursor-pointer hover:bg-(--chrome-action-hover)'
                        : 'cursor-default opacity-70'
                    )}
                    disabled={!navigable}
                    onClick={() => open(item)}
                    type="button"
                  >
                    <Icon aria-label={copy.kinds[item.kind]} className={cn('mt-0.5 size-3.5 shrink-0', tone.className)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 truncate text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
                          {item.title || copy.kinds[item.kind]}
                        </span>
                        <span className="ml-auto shrink-0 truncate text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                          {sessionName}
                        </span>
                      </span>
                      {(item.detail || item.kind !== 'error') && (
                        <span className="block truncate text-[length:var(--conversation-caption-font-size)] text-(--ui-text-secondary)">
                          {item.detail ?? copy.kinds[item.kind]}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </OverlayView>
  )
}
