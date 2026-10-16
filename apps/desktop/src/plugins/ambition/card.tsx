import {
  Button,
  cn,
  host,
  StatusBadge,
  type TranscriptToolPartProps,
  useQuery,
  useQueryClient,
  useSessionView,
  useValue
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import {
  acceptCard,
  type AmbitionCard,
  type AmbitionField,
  cardIdFrom,
  declineCard,
  errorText,
  fetchSessionSummary,
  patchCard,
  summaryKey
} from './api'
import { useAmbitionI18n } from './i18n'

// Rendered field rows, in the order the card defines them. `access` is the
// plugin's optional sixth field (rendered only when the agent set one).
const ROW_FIELDS: readonly AmbitionField[] = ['altitude', 'depth', 'range', 'target', 'judge', 'access']

// Field → i18n key of its row label.
const FIELD_LABELS: Record<AmbitionField, string> = {
  access: 'needsFromYou',
  altitude: 'altitude',
  depth: 'depth',
  judge: 'judge',
  range: 'range',
  target: 'target'
}

// The plugin store clamps fields at 2000 chars; mirror the cap so a paste
// doesn't round-trip to a 422.
const MAX_FIELD_LEN = 2000

/** One labelled field, editable inline: a quiet textarea that PATCHes the
 *  card on blur when its text changed. Remounts on the card's `updated_at`
 *  (the parent keys by it), so a saved edit — ours or another surface's —
 *  repaints from backend truth. */
function FieldRow({
  field,
  label,
  onCommit,
  value
}: {
  field: AmbitionField
  label: string
  onCommit: (field: AmbitionField, text: string) => void
  value: string
}) {
  const [draft, setDraft] = useState(value)
  const dirty = draft !== value

  return (
    <label className="flex min-w-0 flex-col gap-0.5" data-ambition-field={field}>
      <span className="text-ui-2xs font-semibold text-fg-muted">{label}</span>
      <textarea
        className={cn(
          'w-full resize-y rounded-row bg-surface-sunken px-2 py-1 text-ui-sm text-fg outline-none',
          'focus-ring',
          dirty && 'border border-line-strong'
        )}
        maxLength={MAX_FIELD_LEN}
        onBlur={() => {
          const text = draft.trim()

          if (text !== '' && draft !== value) {
            onCommit(field, draft)
          }
        }}
        onChange={event => setDraft(event.target.value)}
        rows={2}
        value={draft}
      />
    </label>
  )
}

/** The inline Ambition card at the `ambition_card` tool call: five labelled
 *  fields (plus "Needs from you" when the agent set one), each editable
 *  inline, with [Accept] / [Smaller]. A widening card wears the
 *  needs-approval (amber) vocabulary. Once decided it folds to one line.
 *  Never a modal. */
export function AmbitionCardPart({ result }: TranscriptToolPartProps) {
  const t = useAmbitionI18n()
  const queryClient = useQueryClient()
  const storedSessionId = useValue(useSessionView().$storedId)
  const [saving, setSaving] = useState(false)

  const cardId = cardIdFrom(result)

  const { data } = useQuery({
    enabled: Boolean(storedSessionId),
    queryFn: () => fetchSessionSummary(storedSessionId as string),
    queryKey: summaryKey(storedSessionId ?? ''),
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000
  })

  if (!storedSessionId || !data) {
    return null
  }

  const card: AmbitionCard | null = (cardId && data.cards.find(c => c.id === cardId)) || null

  if (!card) {
    // The tool result failing (the plugin tool reports {ok: false, ...}
    // instead of throwing) or a card the summary does not carry: say so,
    // never invent one.
    const detail =
      result && typeof result === 'object' && 'error' in result ? String((result as { error?: unknown }).error ?? '') : ''

    return (
      <div className="flex items-center gap-1.5 py-0.5 text-ui-xs text-fg-muted" data-slot="ambition-card-missing">
        <StatusBadge aria-label={t('cardUnavailable')} state="queued" />
        <span>{t('cardUnavailable')}</span>
        {detail ? <span className="text-fg-subtle">{detail}</span> : null}
      </div>
    )
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: summaryKey(storedSessionId) })

  const commit = async (field: AmbitionField, text: string) => {
    setSaving(true)

    try {
      await patchCard(card.id, { [field]: text })
      await refresh()
    } catch (patchError) {
      await refresh()
      host.notifyError(patchError, `${t('saveFailed')} ${errorText(patchError)}`)
    } finally {
      setSaving(false)
    }
  }

  const decide = async (decision: 'accept' | 'decline') => {
    setSaving(true)

    try {
      if (decision === 'accept') {
        await acceptCard(card.id)
      } else {
        await declineCard(card.id)
      }

      await refresh()
    } catch (decideError) {
      await refresh()
      host.notifyError(decideError, errorText(decideError))
    } finally {
      setSaving(false)
    }
  }

  // Decided: one folded line — the card is the contract now, and the hook
  // replays it into the agent's next turn.
  if (card.status === 'accepted' || card.status === 'declined') {
    const statusWord = card.status === 'accepted' ? t('statusAccepted') : t('statusDeclined')

    return (
      <div
        className="flex min-w-0 items-center gap-1.5 py-0.5 text-ui-xs text-fg-secondary"
        data-ambition-status={card.status}
        data-slot="ambition-card-folded"
      >
        <StatusBadge aria-label={statusWord} state={card.status === 'accepted' ? 'done' : 'queued'} />
        <span className="shrink-0">{'Ambition: ' + statusWord}</span>
        {card.fields.target ? (
          <span className="min-w-0 truncate font-mono text-fg-muted tabular-nums">
            {'· ' + t('target') + ' ' + card.fields.target}
          </span>
        ) : null}
      </div>
    )
  }

  const statusWord = card.status === 'proposed' ? t('statusProposed') : t('statusEdited')

  return (
    <div
      className="mt-1 flex w-full min-w-0 max-w-3xl flex-col gap-2 rounded-card border border-line bg-surface-raised p-3"
      data-ambition-status={card.status}
      data-slot="ambition-card"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-ui-xs font-semibold text-fg">Ambition</span>
        <span className="flex items-center gap-1 text-ui-2xs text-fg-muted">
          <StatusBadge
            aria-label={card.widens_scope ? t('widensScope') : statusWord}
            state={card.widens_scope ? 'needs-approval' : 'queued'}
          />
          {statusWord}
        </span>
        {card.widens_scope ? (
          <span className="text-ui-2xs font-semibold text-warning" data-slot="ambition-widens-scope">
            {t('widensScope')}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        {ROW_FIELDS.filter(field => field !== 'access' || card.fields.access).map(field => (
          <FieldRow
            field={field}
            key={`${card.id}:${card.updated_at}:${field}`}
            label={t(FIELD_LABELS[field])}
            onCommit={(name, text) => void commit(name, text)}
            value={card.fields[field] ?? ''}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button data-slot="ambition-accept" disabled={saving} onClick={() => void decide('accept')} size="sm" type="button">
          {t('accept')}
        </Button>
        <Button
          data-slot="ambition-decline"
          disabled={saving}
          onClick={() => void decide('decline')}
          size="sm"
          type="button"
          variant="secondary"
        >
          {t('smaller')}
        </Button>
      </div>
    </div>
  )
}
