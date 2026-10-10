import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { triggerAndRefreshCronJobs } from '@/app/cron/cron-actions'
import { openSession } from '@/app/open-session'
import { CRON_ROUTE } from '@/app/routes'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { openExternalLink } from '@/lib/external-link'
import { triggerHaptic } from '@/lib/haptics'
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  GitFork,
  KeyRound,
  Lock,
  MessageQuestion,
  ShieldLock,
  Terminal,
  X
} from '@/lib/icons'
import { isEditableTarget, OVERLAY_SURFACE } from '@/lib/keybinds/combo'
import { cn } from '@/lib/utils'
import { requestAttentionReveal } from '@/store/attention-inbox'
import { recordApprovalGranted } from '@/store/bot-rapport'
import { setCronFocusJobId } from '@/store/cron'
import { $gateway } from '@/store/gateway'
import { $homeFeedItems, dismissHomeFeedItem, type HomeFeedItem, type HomeFeedItemKind } from '@/store/home-feed'
import { notifyError } from '@/store/notifications'
import { $approvalQueues, answerApproval, type ApprovalRequest } from '@/store/prompts'
import { storedSessionIdForRuntimeId } from '@/store/session-states'

function HomeFeedIcon({ kind }: { kind: HomeFeedItemKind }) {
  switch (kind) {
    case 'approval':
      return <ShieldLock className="size-4 shrink-0 text-amber-400" />

    case 'clarify':
      return <MessageQuestion className="size-4 shrink-0 text-violet-300" />

    case 'error':
      return <AlertCircle className="size-4 shrink-0 text-red-400" />

    case 'secret':
      return <KeyRound className="size-4 shrink-0 text-amber-400" />

    case 'sudo':
      return <Terminal className="size-4 shrink-0 text-(--ui-text-secondary)" />

    case 'vaultCode':

    case 'vaultSave':

    case 'vaultUnlock':
      return <Lock className="size-4 shrink-0 text-(--ui-text-secondary)" />

    case 'cronOverdue':
      return <AlertTriangle className="size-4 shrink-0 text-amber-400" />

    case 'cronDue':
      return <Clock className="size-4 shrink-0 text-primary" />

    case 'prReview':
      return <GitFork className="size-4 shrink-0 text-emerald-400" />

    default:
      return <Clock className="size-4 shrink-0 text-(--ui-text-secondary)" />
  }
}

/** Number-key hint on a card's primary button; keys 1-9 only. */
function ShortcutHint({ n }: { n?: number }) {
  return n && n <= 9 ? (
    <span aria-hidden="true" className="ml-1 font-mono text-[10px] opacity-60">
      {n}
    </span>
  ) : null
}

interface HomeFeedCardProps {
  item: HomeFeedItem
  onDismiss: (id: string) => void
  shortcutNumber?: number
}

export function HomeFeedCard({ item, onDismiss, shortcutNumber }: HomeFeedCardProps) {
  const navigate = useNavigate()
  const { t } = useI18n()

  const gateway = useStore($gateway)
  const approvalQueues = useStore($approvalQueues)
  const [busy, setBusy] = useState<string | null>(null)

  const sessionId = item.sessionId

  // Answer only the exact request this card shows; no match means Open, never
  // a guess at some other queued request.
  const request: ApprovalRequest | null =
    item.kind === 'approval' && sessionId
      ? ((approvalQueues[sessionId] ?? []).find(r => r.requestId && item.id.endsWith(r.requestId)) ?? null)
      : null

  const handleApprove = async () => {
    if (!request || busy) {
      return
    }

    setBusy('once')

    try {
      await answerApproval(gateway, request, 'once')

      if (sessionId) {
        recordApprovalGranted(sessionId)
      }

      triggerHaptic('selection')
    } catch (err) {
      notifyError(err, t.common.answerFailed)
    } finally {
      setBusy(null)
    }
  }

  const handleDeny = async () => {
    if (!request || busy) {
      return
    }

    setBusy('deny')

    try {
      await answerApproval(gateway, request, 'deny')
      triggerHaptic('selection')
    } catch (err) {
      notifyError(err, t.common.answerFailed)
    } finally {
      setBusy(null)
    }
  }

  const handleOpenSession = () => {
    if (!sessionId) {
      return
    }

    requestAttentionReveal(sessionId)
    const storedId = storedSessionIdForRuntimeId(sessionId) ?? sessionId
    openSession(storedId, navigate, 'stack')
  }

  const handleRunNow = async () => {
    if (!item.cronJobId || busy) {
      return
    }

    setBusy('run')

    try {
      await triggerAndRefreshCronJobs(item.cronJobId, 'all')
      triggerHaptic('selection')
    } catch (err) {
      notifyError(err, t.common.runFailed)
    } finally {
      setBusy(null)
    }
  }

  const handleOpenCron = () => {
    if (item.cronJobId) {
      setCronFocusJobId(item.cronJobId)
      navigate(CRON_ROUTE)
    }
  }

  const pr = item.kind === 'prReview' ? item.rawPullRequest : undefined
  const inbox = t.attentionInbox
  const title = pr ? inbox.pullRequest(pr.number, pr.title) : item.title

  const caption = pr ? `${pr.branch} · ${pr.checks ? inbox.prChecks[pr.checks] : inbox.prChecks.none}` : item.caption

  const handleOpenPr = () => {
    if (item.prUrl) {
      openExternalLink(item.prUrl)
    }
  }

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-(--chrome-action-hover)/40"
      data-feed-id={item.id}
      data-feed-kind={item.kind}
    >
      <HomeFeedIcon kind={item.kind} />

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium leading-snug text-foreground">{title}</div>
        {caption && <div className="truncate text-[0.6875rem] leading-snug text-(--ui-text-secondary)">{caption}</div>}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {request ? (
          <>
            <Button
              aria-label={t.common.approve}
              data-feed-primary="true"
              disabled={busy !== null}
              onClick={handleApprove}
              size="xs"
              variant="default"
            >
              {t.common.approve}
              <ShortcutHint n={shortcutNumber} />
            </Button>
            <Button disabled={busy !== null} onClick={handleDeny} size="xs" variant="destructive">
              {t.common.deny}
            </Button>
            {sessionId && (
              <Button onClick={handleOpenSession} size="xs" variant="text">
                {t.common.open}
              </Button>
            )}
          </>
        ) : item.kind === 'cronOverdue' || item.kind === 'cronDue' ? (
          <>
            <Button
              aria-label={t.common.runNow}
              data-feed-primary="true"
              disabled={busy !== null}
              onClick={handleRunNow}
              size="xs"
              variant="secondary"
            >
              {t.common.runNow}
              <ShortcutHint n={shortcutNumber} />
            </Button>
            <Button onClick={handleOpenCron} size="xs" variant="text">
              {t.common.open}
            </Button>
          </>
        ) : item.kind === 'prReview' ? (
          <Button
            aria-label={t.common.open}
            data-feed-primary="true"
            onClick={handleOpenPr}
            size="xs"
            variant="secondary"
          >
            {t.common.open}
            <ShortcutHint n={shortcutNumber} />
          </Button>
        ) : (
          sessionId && (
            <Button
              aria-label={t.common.open}
              data-feed-primary="true"
              onClick={handleOpenSession}
              size="xs"
              variant="secondary"
            >
              {t.common.open}
              <ShortcutHint n={shortcutNumber} />
            </Button>
          )
        )}

        <Button aria-label={t.common.dismiss} onClick={() => onDismiss(item.id)} size="icon-xs" variant="ghost">
          <X className="size-3" />
        </Button>
      </div>
    </div>
  )
}

export interface HomeFeedProps {
  items?: HomeFeedItem[]
  onDismiss?: (id: string) => void
}

export function HomeFeed({ items: propsItems, onDismiss: propsOnDismiss }: HomeFeedProps = {}) {
  const storeItems = useStore($homeFeedItems)
  const items = propsItems ?? storeItems
  const onDismiss = propsOnDismiss ?? dismissHomeFeedItem

  useEffect(() => {
    if (items.length === 0) {
      return
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) {
        return
      }

      if (typeof document !== 'undefined' && document.querySelector(OVERLAY_SURFACE)) {
        return
      }

      const num = parseInt(e.key, 10)

      if (num >= 1 && num <= Math.min(items.length, 9)) {
        const targetItem = items[num - 1]
        const cardEl = document.querySelector(`[data-feed-id="${targetItem.id}"]`)
        const primaryBtn = cardEl?.querySelector<HTMLButtonElement>('button[data-feed-primary="true"]')

        if (primaryBtn && !primaryBtn.disabled) {
          e.preventDefault()
          primaryBtn.click()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items])

  if (items.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        'pointer-events-auto absolute bottom-[calc(var(--composer-measured-height,4rem)+0.75rem)] left-1/2 z-20',
        'w-[min(var(--composer-width),calc(100%-2rem))] -translate-x-1/2',
        'flex flex-col overflow-hidden rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)/95 shadow-sm divide-y divide-(--ui-stroke-tertiary) backdrop-blur-md'
      )}
      data-slot="home-feed"
    >
      {items.map((item, index) => (
        <HomeFeedCard item={item} key={item.id} onDismiss={onDismiss} shortcutNumber={index + 1} />
      ))}
    </div>
  )
}
