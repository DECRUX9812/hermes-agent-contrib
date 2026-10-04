/**
 * Save-a-recording dialog (roadmap #46): review the captured steps, name the
 * draft, write it through the backend's skill-create path into the profile's
 * `~/.hermes/skills/`. A draft, not a finished macro — the artifact says so.
 */

import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldHint } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { createSkill } from '@/hermes'
import { useI18n } from '@/i18n'
import type { RecordedStep } from '@/lib/preview-record/in-page'
import { buildRecordedSkillMarkdown, slugifySkillName, summarizeRecordedStep } from '@/lib/preview-record/skill-md'
import { notify, notifyError } from '@/store/notifications'

const VERB_LABELS = { click: 'Click', navigate: 'Open', press: 'Press', type: 'Type' } as const

function StepRow({ index, step }: { index: number; step: RecordedStep }) {
  const summary = summarizeRecordedStep(step)

  return (
    <div className="flex items-baseline gap-2 rounded px-2 py-1 text-xs odd:bg-foreground/[0.03]">
      <span className="w-5 shrink-0 text-right font-mono text-[0.65rem] text-muted-foreground">{index + 1}.</span>
      <span className="shrink-0 font-medium text-foreground/90">{VERB_LABELS[summary.action]}</span>
      {summary.label ? <span className="min-w-0 truncate text-foreground">{summary.label}</span> : null}
      {summary.detail ? (
        <span className="min-w-0 truncate font-mono text-[0.65rem] text-muted-foreground">{summary.detail}</span>
      ) : null}
    </div>
  )
}

export interface PreviewRecordDialogProps {
  onOpenChange: (open: boolean) => void
  open: boolean
  pageTitle?: string
  pageUrl?: string
  steps: RecordedStep[]
}

export function PreviewRecordDialog({ onOpenChange, open, pageTitle, pageUrl, steps }: PreviewRecordDialogProps) {
  const { t } = useI18n()
  const w = t.preview.web

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const name = useMemo(() => slugifySkillName(title || pageTitle || ''), [title, pageTitle])
  const canSave = !saving && steps.length > 0

  const close = () => {
    setTitle('')
    setDescription('')
    onOpenChange(false)
  }

  const save = async () => {
    setSaving(true)

    try {
      const content = buildRecordedSkillMarkdown({
        description,
        name,
        steps,
        title: title || pageTitle,
        url: pageUrl
      })

      const result = await createSkill({ content, name })

      if (!result.success) {
        notifyError(new Error(result.message || ''), w.recordSaveFailed)

        return
      }

      notify({ kind: 'success', message: w.recordSaved(name), title: w.recordTitle })
      close()
    } catch (error) {
      notifyError(error, w.recordSaveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={next => !next && close()} open={open}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{w.recordTitle}</DialogTitle>
          <DialogDescription>{w.recordDesc}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Field htmlFor="record-skill-name" label={w.recordName}>
              <Input
                id="record-skill-name"
                onChange={event => setTitle(event.target.value)}
                placeholder={pageTitle || w.recordNamePlaceholder}
                value={title}
              />
            </Field>
            <FieldHint>{w.recordNameHint(name)}</FieldHint>
          </div>

          <div className="grid gap-1.5">
            <Field htmlFor="record-skill-desc" label={w.recordDescLabel}>
              <Input
                id="record-skill-desc"
                maxLength={60}
                onChange={event => setDescription(event.target.value)}
                placeholder={w.recordDescPlaceholder}
                value={description}
              />
            </Field>
            <FieldHint>{w.recordDescHint}</FieldHint>
          </div>

          <Field label={w.recordSteps(steps.length)}>
            <div className="max-h-56 overflow-y-auto rounded-md border border-border/60 py-1">
              {steps.length ? (
                steps.map((step, index) => <StepRow index={index} key={index} step={step} />)
              ) : (
                <p className="px-3 py-2 text-xs text-muted-foreground">{w.recordEmpty}</p>
              )}
            </div>
          </Field>
        </div>

        <DialogFooter>
          <Button onClick={close} variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={!canSave} onClick={() => void save()}>
            {saving ? w.recordSaving : w.recordSave}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
