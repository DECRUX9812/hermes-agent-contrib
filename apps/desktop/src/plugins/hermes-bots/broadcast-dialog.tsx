/**
 * D1 — the broadcast dialog: pick bots, write one prompt, send to every
 * selected bot's canonical chat in parallel, watch each reply land.
 *
 * Dispatch itself lives in broadcast.ts (identity + RPC); this file is the
 * view — a checklist over the live roster plus a results list keyed off
 * $broadcastRun. Neither navigates: the whole point is comparing answers
 * side-by-side without leaving the roster.
 */

import {
  Button,
  Checkbox,
  Codicon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  Tip,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { $broadcastRun, broadcastPrompt } from './broadcast'
import type { BroadcastEntry } from './broadcast'
import { $botMeta, botRosterKey } from './data'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
import type { RosterRow } from './types'

function BroadcastStatusGlyph({ status }: { status: BroadcastEntry['status'] }) {
  const b = useBots()

  if (status === 'sending') {
    return <Codicon className="text-(--ui-text-tertiary)" name="loading" spinning />
  }

  if (status === 'working') {
    return <Codicon className="text-(--ui-accent)" name="sync" spinning />
  }

  if (status === 'error') {
    return <Codicon className="text-destructive" name="error" />
  }

  return <Codicon aria-label={b.broadcast.title} className="text-green-600 dark:text-green-400" name="check" />
}

function BroadcastResultCard({ entry }: { entry: BroadcastEntry }) {
  const b = useBots()
  const allMeta = useValue($botMeta)
  const meta = botRosterMeta(entry.bot, allMeta)
  const { shape, color, image } = botAppearance(entry.bot.name, meta)
  const name = displayName(entry.bot, meta)

  const statusLabel =
    entry.status === 'sending'
      ? b.broadcast.statusSending
      : entry.status === 'working'
        ? b.broadcast.statusWorking
        : entry.status === 'error'
          ? b.broadcast.statusFailed
          : null

  return (
    <div
      className="rounded-md border border-(--ui-stroke-secondary) px-2.5 py-2"
      data-testid={`broadcast-result:${entry.key}`}
    >
      <div className="flex items-center gap-1.5">
        <BotFace color={avatarColor(color, entry.bot.name)} image={image} name={entry.bot.name} shape={shape} size={16} />
        <span className="min-w-0 flex-1 truncate text-[0.75rem] font-medium text-(--ui-text-secondary)">{name}</span>
        {statusLabel ? (
          <span className="flex items-center gap-1 text-[0.65rem] text-(--ui-text-tertiary)">
            <BroadcastStatusGlyph status={entry.status} />
            {statusLabel}
          </span>
        ) : (
          <BroadcastStatusGlyph status={entry.status} />
        )}
      </div>
      {entry.status === 'error' ? (
        <div className="mt-1 truncate text-[0.6875rem] text-destructive">{entry.error}</div>
      ) : entry.status === 'done' ? (
        <div className="mt-1 whitespace-pre-wrap break-words text-[0.75rem] text-(--ui-text-secondary)">
          {entry.reply || b.broadcast.emptyReply}
        </div>
      ) : null}
    </div>
  )
}

export function BroadcastDialog({
  bots,
  onClose,
  open
}: {
  bots: RosterRow[]
  onClose: () => void
  open: boolean
}) {
  const b = useBots()
  const allMeta = useValue($botMeta)
  const run = useValue($broadcastRun)
  const eligible = bots.filter(bot => !bot?.ghost)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    if (open) {
      setChecked(new Set(eligible.map(bot => botRosterKey(bot) || bot.name)))
      setPrompt('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggle = (key: string) => {
    setChecked(previous => {
      const next = new Set(previous)

      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      return next
    })
  }

  const selected = eligible.filter(bot => checked.has(botRosterKey(bot) || bot.name))
  const sending = Boolean(run && run.entries.some(entry => entry.status === 'sending' || entry.status === 'working'))

  const send = () => {
    if (!selected.length || !prompt.trim()) {
      return
    }

    broadcastPrompt(selected, prompt)
  }

  return (
    <Dialog
      onOpenChange={value => {
        if (!value) {
          onClose()
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{b.broadcast.title}</DialogTitle>
          <DialogDescription>{b.broadcast.desc}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)">
              {b.broadcast.send(selected.length)}
            </span>
            <div className="flex items-center gap-1">
              <Button
                onClick={() => setChecked(new Set(eligible.map(bot => botRosterKey(bot) || bot.name)))}
                size="xs"
                variant="ghost"
              >
                {b.broadcast.selectAll}
              </Button>
              <Button onClick={() => setChecked(new Set())} size="xs" variant="ghost">
                {b.broadcast.clearAll}
              </Button>
            </div>
          </div>
          <ul className="flex max-h-44 min-h-0 flex-col gap-0.5 overflow-y-auto" data-testid="broadcast-bots">
            {eligible.map(bot => {
              const key = botRosterKey(bot) || bot.name
              const meta = botRosterMeta(bot, allMeta)
              const { shape, color, image } = botAppearance(bot.name, meta)

              return (
                <li className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-(--chrome-action-hover)" key={key}>
                  <Checkbox
                    aria-label={displayName(bot, meta)}
                    checked={checked.has(key)}
                    onCheckedChange={() => toggle(key)}
                  />
                  <BotFace
                    color={avatarColor(color, bot.name)}
                    image={image}
                    name={bot.name}
                    shape={shape}
                    size={18}
                  />
                  <span className="min-w-0 flex-1 truncate text-[0.75rem] text-(--ui-text-secondary)">
                    {displayName(bot, meta)}
                  </span>
                </li>
              )
            })}
          </ul>
          <label className="flex flex-col gap-1">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)">
              {b.broadcast.promptLabel}
            </span>
            <Textarea
              aria-label={b.broadcast.promptLabel}
              onChange={event => setPrompt(event.target.value)}
              placeholder={b.broadcast.promptPlaceholder}
              rows={3}
              value={prompt}
            />
          </label>
          {!selected.length ? (
            <span className="text-[0.6875rem] text-(--ui-text-quaternary)">{b.broadcast.noBotSelected}</span>
          ) : null}
          {run ? (
            <div className="flex min-h-0 max-h-64 flex-col gap-1.5 overflow-y-auto" data-testid="broadcast-results">
              <div className="truncate text-[0.6875rem] italic text-(--ui-text-quaternary)">{run.prompt}</div>
              {run.entries.map(entry => (
                <BroadcastResultCard entry={entry} key={entry.key} />
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Tip label={sending ? b.broadcast.statusWorking : ''}>
            <Button disabled={!selected.length || !prompt.trim() || sending} onClick={send} size="sm">
              {b.broadcast.send(selected.length)}
            </Button>
          </Tip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
