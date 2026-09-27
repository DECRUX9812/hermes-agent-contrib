/**
 * Bot templates (bot-mode revamp C1): renderer-local presets the create
 * dialog seeds fields from — Researcher / Engineer / Ops / Custom. Nothing
 * here reaches the backend as a new RPC: a preset is just a bundle of seeds
 * (title, description, SOUL stub, model default, suggested skills) applied
 * to the dialog's existing state, then the stock `profiles.create` +
 * `profiles.configure` writes carry them.
 *
 * Soul stubs are agent-facing content — they land in the profile's SOUL.md —
 * so they stay English like every other persona scaffold (`composeSoul`,
 * DEFAULT_SOUL_MD); they are deliberately NOT in the i18n bundles. The
 * user-visible seeds (preset names, titles, descriptions) are.
 */

export type BotTemplateId = 'custom' | 'engineer' | 'ops' | 'researcher'

/** Picker order — real presets first, Custom last as the blank slate. */
export const BOT_TEMPLATE_IDS: readonly BotTemplateId[] = ['researcher', 'engineer', 'ops', 'custom']

export interface BotTemplateSpec {
  /** Model pin seeded into the dialog's Advanced picker. `auto`/`auto` asks
   *  the gateway to auto-route from whatever providers are configured; `''`
   *  means inherit the launch profile (the profiles.create default). */
  model: string
  provider: string
  /** Bundled-skill LEAF names the template keeps enabled; the rest of the
   *  installed catalog is disabled at creation — the template IS the curated
   *  skill set. Empty = leave the clone source's skills untouched. */
  skills: string[]
  /** SOUL.md seed (agent-facing; stays English). `''` lets `composeSoul`
   *  generate the persona from name/title/description as usual. */
  soul: string
}

const RESEARCHER_SOUL = `# Researcher

Deep-research specialist. Works questions to ground truth: forms a plan,
gathers primary sources, cross-checks claims, and reports findings with
citations. Prefers primary material over summaries; says "I don't know" rather
than guessing; keeps a running list of open questions.`

const ENGINEER_SOUL = `# Engineer

Software engineer. Works in small verified steps: read the code first, make
the smallest change that solves the problem, run the tests, and show the
diff. Prefers existing conventions over new abstractions; flags risky or
ambiguous work instead of pushing through it.`

const OPS_SOUL = `# Ops

Operations and monitoring. Watches systems, schedules, and queues; investigates
anomalies methodically (check logs before theorizing); escalates with a crisp
summary instead of a wall of output. Writes down what it did.`

export const BOT_TEMPLATES: Record<BotTemplateId, BotTemplateSpec> = {
  custom: { model: '', provider: '', skills: [], soul: '' },
  engineer: {
    model: 'auto',
    provider: 'auto',
    skills: [
      'codebase-inspection',
      'github',
      'requesting-code-review',
      'simplify-code',
      'spike',
      'systematic-debugging',
      'test-driven-development'
    ],
    soul: ENGINEER_SOUL
  },
  ops: {
    model: 'auto',
    provider: 'auto',
    skills: ['blocked-page-recovery', 'document-to-action-items', 'meeting-action-items', 'sdlc-review'],
    soul: OPS_SOUL
  },
  researcher: {
    model: 'auto',
    provider: 'auto',
    skills: ['arxiv', 'competitor-news-monitor', 'grounded-citations', 'llm-wiki'],
    soul: RESEARCHER_SOUL
  }
}

/** The skill-name form both the describe catalog (`research/arxiv` on newer
 *  gateways) and presets (`arxiv`) can agree on. */
export function leafSkillName(name: string): string {
  const leaf = name.split('/').pop() || name

  return leaf.trim().toLowerCase()
}

function suggestedSkillSet(spec: BotTemplateSpec): Set<string> {
  return new Set(spec.skills.map(leafSkillName))
}

/** Apply a preset's skill curation to a staged catalog: suggested leaf names
 *  enabled, everything else disabled. Returns the input untouched when the
 *  preset curates nothing (Custom). */
export function stagedSkillsForTemplate<T extends { enabled?: boolean; name: string }>(
  skills: T[],
  spec: BotTemplateSpec
): T[] {
  if (!spec.skills.length) {
    return skills
  }

  const wanted = suggestedSkillSet(spec)

  return skills.map(skill => ({ ...skill, enabled: wanted.has(leafSkillName(skill.name)) }))
}

/** The `disabled_skills` payload for a preset: every installed skill NOT in
 *  the suggested set. `null` when the preset curates nothing. */
export function disabledSkillNames(
  installed: Array<{ name: string }>,
  spec: BotTemplateSpec
): null | string[] {
  if (!spec.skills.length) {
    return null
  }

  const wanted = suggestedSkillSet(spec)

  return installed.filter(skill => !wanted.has(leafSkillName(skill.name))).map(skill => skill.name)
}
