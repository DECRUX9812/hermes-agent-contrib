/**
 * Turn a recorded step list into a SKILL.md draft. Pure — the dialog renders
 * the same `describeRecordedStep` lines the file ends up with, so what the
 * user reviews is what lands in `~/.hermes/skills/`.
 *
 * The draft is deliberately a draft: `skill_manage`'s create path enforces the
 * frontmatter contract (name + ≤60-char description, so the system-prompt
 * index keeps its routing signal) and this builder keeps every field inside
 * it.
 */

import type { RecordedStep } from './in-page'

export interface RecordedSkillInput {
  /** Optional author-facing title; the slug is the skill's real name. */
  description?: string
  name: string
  steps: RecordedStep[]
  title?: string
  /** Page the recording started on — becomes step 1's Open line and feeds the
   *  generated description's `on <host>`. */
  url?: string
}

/** `_validate_name` + `_check_identifier` (skill_manager_tool): lowercase
 *  `[a-z0-9][a-z0-9._-]*`. A title with nothing left after slugging falls back
 *  to `recorded-task`. */
export function slugifySkillName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48)

  return /^[a-z0-9]/.test(slug) ? slug : 'recorded-task'
}

export interface RecordedStepSummary {
  /** Verb for the row: Open / Click / Type / Press. */
  action: 'click' | 'navigate' | 'press' | 'type'
  /** Selector, url, or value — the monospace tail. */
  detail: string
  /** The control's recorded label, when the page gave one. */
  label?: string
}

/** The row the review dialog shows AND the line the skill body writes —
 *  derived from one split so the preview can never drift from the artifact. */
export function summarizeRecordedStep(step: RecordedStep): RecordedStepSummary {
  const label = step.label || undefined

  switch (step.kind) {
    case 'navigate':
      return { action: 'navigate', detail: step.url || '' }

    case 'click':
      return { action: 'click', detail: step.selector || '', label }

    case 'press':
      return { action: 'press', detail: step.selector || '', label: step.key }

    case 'type':
      return {
        action: 'type',
        detail: step.redacted ? '' : step.selector || '',
        label: step.redacted ? step.label : step.value
      }
  }
}

/** One numbered line of the skill body. */
export function describeRecordedStep(step: RecordedStep): string {
  const summary = summarizeRecordedStep(step)

  switch (summary.action) {
    case 'navigate':
      return `Open \`${summary.detail}\``

    case 'click':
      return `Click **${summary.label || 'the element'}**${summary.detail ? ` (\`${summary.detail}\`)` : ''}`

    case 'press':
      return `Press **${summary.label || 'Enter'}**${step.label ? ` on **${step.label}**` : ''}${summary.detail ? ` (\`${summary.detail}\`)` : ''}`

    case 'type':
      return step.redacted
        ? `Enter the credential into **${step.label || 'the field'}**${step.selector ? ` (\`${step.selector}\`)` : ''} — the recording keeps no password text`
        : `Type \`${step.value ?? ''}\` into **${step.label || 'the field'}**${step.selector ? ` (\`${step.selector}\`)` : ''}`
  }
}

const yamlDoubleQuoted = (value: string) =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Descriptions must fit the 60-char system-prompt budget AND end in a period
 *  (`_validate_frontmatter` rejects longer ones on create). */
function descriptionFor(input: RecordedSkillInput): string {
  const custom = (input.description || '').trim().replace(/\s+/g, ' ')

  if (custom) {
    if (custom.length <= 60 && custom.endsWith('.')) {return custom}
    const clipped = custom.slice(0, 59).replace(/[.\s]+$/, '')

    return clipped ? `${clipped}.` : 'Recorded UI workflow.'
  }

  let host = ''

  try {
    host = input.url ? new URL(input.url).hostname : ''
  } catch {
    host = ''
  }

  const generated = host ? `Recorded UI workflow on ${host}.` : 'Recorded UI workflow.'

  return generated.length <= 60 ? generated : 'Recorded UI workflow.'
}

export function buildRecordedSkillMarkdown(input: RecordedSkillInput): string {
  const title = (input.title || '').trim() || `Recorded workflow: ${input.name}`
  const description = descriptionFor(input)

  const lines: string[] = [
    '---',
    `name: ${input.name}`,
    `description: ${yamlDoubleQuoted(description)}`,
    'version: 0.1.0',
    'metadata:',
    '  hermes:',
    '    tags: [Recorded]',
    '---',
    '',
    `# ${title}`,
    '',
    'Recorded in the desktop in-app browser. Replay with `drive_preview` — the',
    'preview act engine understands `click`/`type`/`press`/`scroll` on the open',
    'page — or perform the steps in any browser. Selectors are the page\'s own',
    'at record time; verify the draft before relying on it.',
    '',
    '## Steps',
    ''
  ]

  if (input.url) {
    lines.push(`1. Open \`${input.url}\``, ...input.steps.map((step, i) => `${i + 2}. ${describeRecordedStep(step)}`))
  } else {
    input.steps.forEach((step, i) => lines.push(`${i + 1}. ${describeRecordedStep(step)}`))
  }

  lines.push('')

  return lines.join('\n')
}
