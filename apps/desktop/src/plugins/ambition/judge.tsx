import { cn, StatusBadge, type StatusState, type TranscriptToolPartProps } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { type AmbitionVerdict } from './api'
import { useAmbitionI18n } from './i18n'

// Verdict → the shared status vocabulary: pass is done (green), fail is
// error (red), inconclusive is queued (muted).
const VERDICT_STATE: Record<AmbitionVerdict, StatusState> = {
  fail: 'error',
  inconclusive: 'queued',
  pass: 'done'
}

interface JudgeFacts {
  evidence: string
  judge: string
  measured: string
  verdict: AmbitionVerdict
}

/** Read the judge facts off the tool call — the model's own arguments, with
 *  the tool result's echo as the fallback. */
function judgeFacts(args: Record<string, unknown>, result: unknown): null | JudgeFacts {
  const read = (source: unknown): null | JudgeFacts => {
    if (!source || typeof source !== 'object') {
      return null
    }

    const record = source as Record<string, unknown>
    const verdict = record.verdict

    if (
      typeof record.measured !== 'string' ||
      typeof record.judge !== 'string' ||
      typeof record.evidence !== 'string' ||
      typeof verdict !== 'string' ||
      !(verdict in VERDICT_STATE)
    ) {
      return null
    }

    return {
      evidence: record.evidence,
      judge: record.judge,
      measured: record.measured,
      verdict: verdict as AmbitionVerdict
    }
  }

  return read(args) ?? read(result)
}

const targetFromResult = (result: unknown): string =>
  result && typeof result === 'object' && typeof (result as { target?: unknown }).target === 'string'
    ? (result as { target: string }).target
    : ''

/**
 * The judge result chip at the `ambition_judge` tool call: Target vs Measured
 * (numbers read as numbers), the shared status mark for the verdict, and the
 * outside judge's name. The evidence — the why — expands on click.
 */
export function AmbitionJudgePart({ args, isError, result }: TranscriptToolPartProps) {
  const t = useAmbitionI18n()
  const [showEvidence, setShowEvidence] = useState(false)

  // The plugin tool reports {ok: false, ...} instead of throwing; either a
  // failed call or a rejected record keeps the honest error line.
  const failed =
    isError ||
    (result && typeof result === 'object' && 'ok' in result ? (result as { ok?: unknown }).ok !== true : false)

  const facts = failed ? null : judgeFacts(args, result)

  if (failed || !facts) {
    const detail =
      result && typeof result === 'object' && 'error' in result ? String((result as { error?: unknown }).error ?? '') : ''

    return (
      <div className="flex min-w-0 items-center gap-1.5 py-0.5 text-ui-xs text-fg-muted" data-slot="ambition-judge-error">
        <StatusBadge aria-label={t('cardUnavailable')} state="error" />
        <span className="min-w-0 truncate">{t('cardUnavailable')}{detail ? ` ${detail}` : ''}</span>
      </div>
    )
  }

  const verdictLabel =
    facts.verdict === 'pass' ? t('verdictPass') : facts.verdict === 'fail' ? t('verdictFail') : t('verdictInconclusive')

  const target = targetFromResult(result)

  return (
    <div
      className="mt-1 flex min-w-0 flex-col gap-0.5 text-ui-xs text-fg-secondary"
      data-slot="ambition-judge"
      data-verdict={facts.verdict}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <StatusBadge aria-label={verdictLabel} state={VERDICT_STATE[facts.verdict]} />
        {target ? (
          <span className="font-mono tabular-nums" data-slot="ambition-judge-target">
            {t('target') + ': ' + target}
          </span>
        ) : null}
        <span className="font-mono tabular-nums" data-slot="ambition-judge-measured">
          {t('measured') + ': ' + facts.measured}
        </span>
        <span className="text-fg-muted">{facts.judge}</span>
        {facts.evidence ? (
          <button
            className={cn(
              'focus-ring shrink-0 rounded px-1 text-ui-2xs text-fg-muted',
              'underline decoration-dotted underline-offset-2 hover:text-fg-secondary'
            )}
            data-slot="ambition-judge-evidence-toggle"
            onClick={() => setShowEvidence(!showEvidence)}
            type="button"
          >
            {showEvidence ? t('evidenceHide') : t('evidence')}
          </button>
        ) : null}
      </div>
      {showEvidence && facts.evidence ? (
        <div className="wrap-anywhere rounded-row bg-surface-sunken px-2 py-1 text-ui-2xs text-fg-muted" data-slot="ambition-judge-evidence">
          {facts.evidence}
        </div>
      ) : null}
    </div>
  )
}
