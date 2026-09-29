import { useEffect, useState } from 'react'

import { getHermesConfigRecord, saveHermesConfigRecord } from '@/api/config'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { type ApprovalMode, reconcileApprovalModeForProfile } from '@/store/approval-mode'

export interface AskRules {
  mode: ApprovalMode
  /** Plain-language rules appended to the smart guardian's system prompt. */
  policy: string
}

const MODES: readonly ApprovalMode[] = ['manual', 'smart', 'off']

/** The two approval knobs a person sets for an agent, read off its config. */
export function askRulesFromConfig(config: unknown): AskRules {
  const approvals = (config as { approvals?: { mode?: unknown; smart_policy?: unknown } } | null)?.approvals

  // YAML 1.1 reads a bare `off` as false — the backend treats that as 'off'.
  const raw = approvals?.mode === false ? 'off' : String(approvals?.mode ?? 'smart').toLowerCase()

  return {
    mode: (MODES as readonly string[]).includes(raw) ? (raw as ApprovalMode) : 'manual',
    policy: typeof approvals?.smart_policy === 'string' ? approvals.smart_policy : ''
  }
}

/** The PUT body: only the approvals keys this card owns. The route deep-merges
 *  over disk, so nothing else in the profile's config is touched. */
export function askRulesPatch(rules: AskRules): { approvals: { mode: ApprovalMode; smart_policy: string } } {
  return { approvals: { mode: rules.mode, smart_policy: rules.policy.trim() } }
}

const MODE_ICON: Record<ApprovalMode, string> = { manual: 'shield', smart: 'sparkle', off: 'zap' }

/**
 * "When should <agent> ask you?" — the Dots-style rule you set in advance:
 * act on its own, or stop and ask. It is the profile's own `approvals.mode`
 * plus `approvals.smart_policy` (plain-language house rules the approval
 * guardian follows), so the same rules hold in the app, on Telegram, and in
 * scheduled runs. `approvals.deny` patterns still block under every mode.
 */
export function AskRulesCard({ className, name, profile }: { className?: string; name: string; profile: string }) {
  const { t } = useI18n()
  const a = t.profiles.askRules
  const [saved, setSaved] = useState<AskRules | null>(null)
  const [draft, setDraft] = useState<AskRules | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true

    // Deferred so a missing API bridge (web host, tests) lands in .catch.
    Promise.resolve()
      .then(() => getHermesConfigRecord(profile))
      .then(config => {
        if (live) {
          const rules = askRulesFromConfig(config)
          setSaved(rules)
          setDraft(rules)
        }
      })
      .catch(() => live && setError(true))

    return () => {
      live = false
    }
  }, [profile])

  if (!draft || !saved) {
    return null
  }

  const save = async (next: AskRules) => {
    setBusy(true)
    setError(false)
    setDraft(next)

    try {
      await saveHermesConfigRecord(askRulesPatch(next), profile)
      reconcileApprovalModeForProfile(profile, next.mode)
      setSaved(next)
    } catch {
      setError(true)
      setDraft(saved)
    } finally {
      setBusy(false)
    }
  }

  const policyDirty = draft.policy.trim() !== saved.policy.trim()

  return (
    <div
      className={cn('flex flex-col gap-2 rounded-xl bg-(--ui-widget-surface-background) p-3', className)}
      data-slot="ask-rules"
    >
      <p className="text-[0.8125rem] font-medium text-foreground">{a.title(name)}</p>
      <div className="flex flex-col gap-1" role="radiogroup">
        {MODES.map(mode => {
          const active = draft.mode === mode

          return (
            <button
              aria-checked={active}
              className={cn(
                'flex items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors disabled:cursor-default',
                active
                  ? 'bg-(--ui-accent)/10 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ui-accent)_35%,transparent)]'
                  : 'hover:bg-(--ui-control-hover-background)'
              )}
              data-mode={mode}
              disabled={busy}
              key={mode}
              onClick={() => mode !== draft.mode && void save({ ...draft, mode })}
              role="radio"
              type="button"
            >
              <span
                className={cn(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded-md',
                  active ? 'bg-(--ui-accent) text-white' : 'bg-(--ui-bg-tertiary) text-(--ui-text-tertiary)'
                )}
              >
                <Codicon name={MODE_ICON[mode]} size="0.7rem" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.75rem] font-medium text-foreground">{a.modes[mode].label}</span>
                <span className="block text-[0.6875rem] leading-snug text-(--ui-text-tertiary)">
                  {a.modes[mode].description(name)}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {draft.mode === 'smart' && (
        <div className="flex flex-col gap-1.5">
          <Textarea
            aria-label={a.rulesLabel}
            className="min-h-16 text-[0.75rem]"
            disabled={busy}
            onChange={event => setDraft({ ...draft, policy: event.target.value })}
            placeholder={a.rulesPlaceholder}
            value={draft.policy}
          />
          {policyDirty && (
            <div className="flex justify-end gap-1">
              <Button disabled={busy} onClick={() => setDraft(saved)} size="xs" variant="ghost">
                {a.discard}
              </Button>
              <Button disabled={busy} onClick={() => void save(draft)} size="xs">
                {a.save}
              </Button>
            </div>
          )}
        </div>
      )}
      {error && <p className="text-[0.6875rem] text-(--ui-red)">{a.failed}</p>}
    </div>
  )
}
