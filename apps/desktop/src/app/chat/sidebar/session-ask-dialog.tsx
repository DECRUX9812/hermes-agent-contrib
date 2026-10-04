import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { Loader2 } from '@/lib/icons'
import { isSubmitEnter } from '@/lib/ime'
import { useSessionSlice } from '@/lib/use-session-slice'
import { notifyError } from '@/store/notifications'
import { $sessions, sessionMatchesStoredId, sessionPinId } from '@/store/session'
import {
  $sessionAskPending,
  $sessionAskThreads,
  askSessionQuestion,
  clearSessionAskThread,
  sessionAskKey
} from '@/store/session-ask'

interface SessionAskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Stored session id from the row/tab that opened the dialog. */
  sessionId: string
  title: string
  profile?: string
}

/**
 * The companion thread (#44): "Ask about this session" — a side channel that
 * answers from the session's stored transcript via `session.ask`, never the
 * live conversation. Turns persist per (profile, session); the dialog itself
 * owns no state beyond the draft input.
 */
export function SessionAskDialog({ open, onOpenChange, sessionId, title, profile }: SessionAskDialogProps) {
  const { t } = useI18n()
  const r = t.sidebar.row.ask
  const session = useStore($sessions).find(s => sessionMatchesStoredId(s, sessionId))
  // Pin the thread to the durable lineage id so a compressed-away tip keeps
  // its history (same rule as tags); the RPC itself gets the row id the
  // backend resolves (live id or stored key both work).
  const durableId = session ? sessionPinId(session) : sessionId
  const ownerProfile = session?.profile ?? profile
  const thread = useSessionSlice($sessionAskThreads, sessionAskKey(ownerProfile, durableId))
  const pending = useStore($sessionAskPending)[sessionAskKey(ownerProfile, durableId)]
  const [question, setQuestion] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuestion('')
    }
  }, [open])

  // Keep the latest answer in view as turns land; opening an existing thread
  // starts scrolled to the end so the newest exchange is what you see.
  useEffect(() => {
    const el = scrollRef.current

    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [open, thread.length, pending])

  const ask = async () => {
    const trimmed = question.trim()

    if (!trimmed || !durableId || pending) {
      return
    }

    setQuestion('')

    try {
      await askSessionQuestion(ownerProfile, sessionId, trimmed)
    } catch (err) {
      setQuestion(trimmed)
      notifyError(err, r.failed)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{r.dialogTitle}</DialogTitle>
          <DialogDescription>{r.dialogDesc(title || durableId)}</DialogDescription>
        </DialogHeader>
        <div className="min-h-24 flex-1 space-y-3 overflow-y-auto py-1" ref={scrollRef}>
          {thread.length === 0 && !pending && <p className="text-sm text-(--ui-text-tertiary)">{r.empty}</p>}
          {thread.map((turn, index) => (
            <div className="space-y-1" key={`${turn.askedAt}-${index}`}>
              <p className="text-sm font-medium">{turn.question}</p>
              <p className="text-sm whitespace-pre-wrap text-(--ui-text-secondary)">{turn.answer}</p>
              {turn.truncated && <p className="text-xs text-(--ui-text-tertiary)">{r.truncatedNote}</p>}
            </div>
          ))}
          {pending && (
            <p className="flex items-center gap-2 text-sm text-(--ui-text-tertiary)">
              <Loader2 className="size-3.5 animate-spin" /> {r.thinking}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            autoFocus
            disabled={Boolean(pending)}
            onChange={event => setQuestion(event.target.value)}
            onKeyDown={event => {
              if (isSubmitEnter(event)) {
                event.preventDefault()
                void ask()
              } else if (event.key === 'Escape') {
                onOpenChange(false)
              }
            }}
            placeholder={r.placeholder}
            value={question}
          />
          <Button disabled={!question.trim() || Boolean(pending)} onClick={() => void ask()} type="button">
            {r.send}
          </Button>
        </div>
        <DialogFooter>
          {thread.length > 0 && (
            <Button onClick={() => clearSessionAskThread(ownerProfile, durableId)} type="button" variant="ghost">
              {r.clear}
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
