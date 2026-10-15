'use client'

import { useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { createContext, type FC, useCallback, useContext, useMemo, useRef, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { SCAFFOLD_LABEL_CLASS, ScaffoldRow } from '@/components/chat/scaffold-row'
import { Button } from '@/components/ui/button'
import { CardStack, type CardStackAction } from '@/components/ui/card-stack'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { LogView } from '@/components/ui/log-view'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Loader2 } from '@/lib/icons'
import { releaseApprovalKey } from '@/lib/keybinds/approval-keys'
import { useStoresSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { $gateway } from '@/store/gateway'
import { reconnectAction } from '@/store/gateway-reconnect'
import { notifyError } from '@/store/notifications'
import {
  answerApproval,
  type ApprovalRequest,
  clearApprovalRequest,
  replayPendingApproval,
  sessionApprovalRequests,
  sessionApprovalStackSize
} from '@/store/prompts'
import { $botChatSessionIds, $sessionStates, $sessionTiles, isBotChatSession } from '@/store/session-states'
import { $showToolActivity } from '@/store/tool-activity'
import { setToolDisclosureOpen } from '@/store/tool-view'

import { isApprovalActivity } from './approval-activity'
import { toolEntryDisclosureId } from './fallback-model/targets'
import { isToolCallPart, summarizeToolRun } from './run-summary'

type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'
export const ApprovalPlacementContext = createContext<'inline' | 'floating'>('inline')

// One transcript-owned host for the session. Execution rows never mount,
// register or re-home this queue, including the first delayed tool.start.
export const PendingApprovalStack: FC = () => {
  const { t } = useI18n()
  const placement = useContext(ApprovalPlacementContext)
  const sessionId = useStore(useSessionView().$runtimeId)
  const requests = useStore(useMemo(() => sessionApprovalRequests(sessionId), [sessionId]))
  const total = useStore(useMemo(() => sessionApprovalStackSize(sessionId), [sessionId]))
  const reduced = useReducedMotion()

  return (
    <motion.section
      animate={{ paddingBlock: requests.length ? 8 : 0 }}
      aria-label={t.assistant.approval.jumpToApproval}
      className={cn(
        'min-w-0',
        placement === 'floating' ? 'sticky bottom-4 z-10 mt-auto w-full max-w-xl self-center' : 'w-full max-w-xl'
      )}
      data-approval-placement={placement}
      data-approval-stack=""
      data-session-id={sessionId ?? undefined}
      data-slot="tool-approval-stack"
      initial={false}
      transition={reduced || requests.length ? { duration: 0 } : { duration: 0.22, ease: 'easeInOut' }}
    >
      <ApprovalActivity floating={placement === 'floating'} visible={requests.length > 0} />
      <ApprovalQueue floating={placement === 'floating'} requests={requests} total={total} />
    </motion.section>
  )
}

function ApprovalActivity({ floating, visible }: { floating: boolean; visible: boolean }) {
  const { t } = useI18n()
  const reduced = useReducedMotion()
  const showToolActivity = useStore($showToolActivity)
  const sessionId = useStore(useSessionView().$runtimeId)

  const botChat = useStoresSelector([$botChatSessionIds, $sessionStates, $sessionTiles], () =>
    isBotChatSession(sessionId)
  )

  const summary = useAuiState(state => {
    if (!visible) {
      return ''
    }

    const start = state.thread.messages.findLastIndex(message => message.role === 'user')

    const tools = state.thread.messages
      .slice(start + 1)
      .filter(message => message.role === 'assistant')
      .flatMap(message => message.content.filter(isToolCallPart).filter(isApprovalActivity))

    return tools.length
      ? summarizeToolRun(
          tools,
          tools.some(tool => tool.result === undefined)
        )
      : ''
  })

  const disclosureIds = useAuiState(state => {
    if (!visible) {
      return ''
    }

    const start = state.thread.messages.findLastIndex(message => message.role === 'user')

    return state.thread.messages
      .slice(start + 1)
      .filter(message => message.role === 'assistant')
      .flatMap(message =>
        message.content
          .filter(isToolCallPart)
          .filter(isApprovalActivity)
          .map(tool => toolEntryDisclosureId(message.id, tool))
      )
      .join('\n')
  })

  // The pending approval stays. The run summary is tool feed that follows
  // display.tool_progress, and a Bot Chat drops it because its tool cards
  // already show the call waiting for approval.
  if (!showToolActivity || botChat) {
    return null
  }

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          animate={{ height: 'auto', opacity: 1 }}
          className="overflow-hidden"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          key="activity"
          transition={{ duration: reduced ? 0 : 0.22, ease: 'easeInOut' }}
        >
          <div
            className={cn('mb-1 min-w-0', floating && 'rounded bg-(--ui-chat-surface-background)')}
            data-approval-activity=""
            data-glass-opaque={floating ? '' : undefined}
            data-tool-summary=""
          >
            <ScaffoldRow
              onToggle={
                disclosureIds
                  ? () => {
                      for (const id of disclosureIds.split('\n')) {
                        setToolDisclosureOpen(id, true)
                      }
                    }
                  : undefined
              }
              open={false}
            >
              <span className={cn(SCAFFOLD_LABEL_CLASS, 'truncate')}>
                {summary || t.assistant.approval.jumpToApproval}
              </span>
            </ScaffoldRow>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

async function sendApproval(request: ApprovalRequest, choice: ApprovalChoice) {
  const gateway = $gateway.get()

  if (!gateway) {
    throw new Error('Gateway disconnected')
  }

  if (
    !sessionApprovalRequests(request.sessionId)
      .get()
      .some(item => item.requestId === request.requestId)
  ) {
    return
  }

  await answerApproval(gateway, request, choice)
  triggerHaptic(choice === 'deny' ? 'cancel' : 'submit')
  clearApprovalRequest(request.sessionId, request.requestId)
  void replayPendingApproval(gateway, request.sessionId).catch(() => undefined)
}

export function ApprovalQueue({
  requests,
  total,
  floating = false
}: {
  requests: ApprovalRequest[]
  total: number
  floating?: boolean
}) {
  const { t } = useI18n()

  return (
    <CardStack
      getKey={request => request.requestId ?? 'legacy'}
      items={requests}
      onSwipe={(request, _side, action) => {
        void action
          .depart(() => sendApproval(request, 'deny'))
          .catch(error => {
            releaseApprovalKey()
            notifyError(error, t.assistant.approval.sendFailed)
          })
      }}
      surfaceClassName={cn(
        'rounded-card border border-line bg-surface-raised p-4',
        floating && 'shadow-e2'
      )}
      swipeDirections={['left']}
    >
      {(request, action) => (
        <ApprovalCard
          position={total - requests.length + requests.indexOf(request) + 1}
          request={request}
          stack={action}
          total={total}
        />
      )}
    </CardStack>
  )
}

interface ApprovalCardProps {
  request: ApprovalRequest
  total: number
  position: number
  stack: CardStackAction
}

const ApprovalCard: FC<ApprovalCardProps> = ({ request, total, position, stack }) => {
  const { t } = useI18n()
  const copy = t.assistant.approval
  const gateway = useStore($gateway)
  const [submitting, setSubmitting] = useState<ApprovalChoice | null>(null)
  const submittingRef = useRef(false)
  // "Always allow" persists the pattern to ~/.hermes/config.yaml permanently, so
  // it goes through a confirm step rather than firing straight from the menu.
  const [confirmAlways, setConfirmAlways] = useState(false)

  const present = stack.active
  const busy = submitting !== null || !present || stack.busy
  // Answering with the pointer moves focus onto the card, and the card then
  // unmounts, which parks focus on <body> — where type-to-focus routes the next
  // keystrokes into the chat composer. For a computer_use flow the agent may
  // have just aimed its input at another pane (terminal, preview), so the
  // approval hands focus back to whatever held it before the press (#113839).
  const focusOrigin = useRef<HTMLElement | null>(null)
  const cardRef = useRef<HTMLElement | null>(null)

  const rememberFocusOrigin = useCallback(() => {
    const active = document.activeElement

    if (active instanceof HTMLElement && active !== document.body && !cardRef.current?.contains(active)) {
      focusOrigin.current = active
    }
  }, [])

  const restoreFocusOrigin = useCallback(() => {
    const origin = focusOrigin.current
    const active = document.activeElement

    focusOrigin.current = null

    // Only when the answer itself is what stranded focus — never steal from a
    // surface the user moved to while the reply was in flight.
    if (origin?.isConnected && (!active || active === document.body || cardRef.current?.contains(active))) {
      origin.focus({ preventScroll: true })
    }
  }, [])

  // false when the backend won't honor a permanent allow → hide "Always allow here".
  const allowPermanent = request.allowPermanent !== false
  const choices = request.choices ?? (request.smartDenied ? ['once', 'deny'] : undefined)
  const allowSession = choices ? choices.includes('session') : true
  const allowAlways = choices ? choices.includes('always') : allowPermanent
  const hasCommand = request.command.trim().length > 0
  // A plugin `approve` rule escalates through the same gate with a synthetic
  // display target (`<tool> (plugin approval rule)`) while the real command /
  // change lives in `description` — the user approves a label they cannot act
  // on otherwise. Show the description whenever the command is missing or one
  // of these synthetic labels; a real command keeps rendering as the command.
  const SYNTHETIC_COMMAND_RE = /^<[^>]+> \(/

  const showsDescription = !hasCommand || SYNTHETIC_COMMAND_RE.test(request.command.trim())

  const details = showsDescription ? request.description.trim() : request.command.trim()

  const respond = useCallback(
    async (choice: ApprovalChoice) => {
      const pending = sessionApprovalRequests(request.sessionId).get()

      if (submittingRef.current || !pending.some(item => item.requestId === request.requestId)) {
        return
      }

      if (!gateway) {
        notifyError(new Error(copy.gatewayDisconnected), copy.sendFailed, { action: reconnectAction() })

        return
      }

      submittingRef.current = true
      setSubmitting(choice)

      try {
        await stack.depart(() => sendApproval(request, choice))
        restoreFocusOrigin()
      } catch (error) {
        releaseApprovalKey()
        notifyError(error, copy.sendFailed)
        submittingRef.current = false
        setSubmitting(null)
      }
    },
    [copy.gatewayDisconnected, copy.sendFailed, gateway, request, restoreFocusOrigin, stack]
  )

  return (
    <article
      aria-hidden={!present || undefined}
      className="min-w-0"
      data-request-id={request.requestId}
      data-slot="tool-approval-card"
      inert={!present}
      onPointerDownCapture={rememberFocusOrigin}
      ref={cardRef}
    >
      <p className="text-ui-sm font-medium text-fg">
        {showsDescription ? copy.cardDetailsTitle : copy.cardTitle}
        {total > 1 && (
          <span className="ml-2 text-ui-2xs tabular-nums text-fg-muted">
            {position} / {total}
          </span>
        )}
      </p>
      {details.length > 0 && <LogView className="mt-2 max-h-28">{details}</LogView>}
      <div className="mt-3 flex items-center justify-end gap-2" data-slot="tool-approval-actions">
        <Button data-approval-deny="" disabled={busy} onClick={() => void respond('deny')} size="sm" variant="ghost">
          {submitting === 'deny' ? <Loader2 className="size-3 animate-spin" /> : copy.deny}
        </Button>
        {allowAlways && (
          <Button
            disabled={busy}
            onClick={() => {
              // Defer one tick so focus settles before the dialog mounts —
              // otherwise Radix's focus-return races the dialog and dismisses
              // it via onInteractOutside.
              setTimeout(() => setConfirmAlways(true), 0)
            }}
            size="sm"
            variant="ghost"
          >
            {copy.alwaysAllowHere}
          </Button>
        )}
        {allowSession && (
          <Button disabled={busy} onClick={() => void respond('session')} size="sm" variant="secondary">
            {submitting === 'session' ? <Loader2 className="size-3 animate-spin" /> : copy.allowSession}
          </Button>
        )}
        <Button data-approval-run="" disabled={busy} onClick={() => void respond('once')} size="sm">
          {submitting === 'once' ? <Loader2 className="size-3 animate-spin" /> : copy.allowOnce}
          <span className="opacity-60">↵</span>
        </Button>
      </div>

      <Dialog onOpenChange={setConfirmAlways} open={confirmAlways}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.alwaysTitle}</DialogTitle>
            <DialogDescription>{copy.alwaysDescription(request.description)}</DialogDescription>
          </DialogHeader>

          {request.command.trim() && <LogView className="max-h-32">{request.command.trim()}</LogView>}

          <DialogFooter>
            <Button onClick={() => setConfirmAlways(false)} size="sm" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => {
                setConfirmAlways(false)
                void respond('always')
              }}
              size="sm"
              variant="destructive"
            >
              {copy.alwaysAllow}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}
