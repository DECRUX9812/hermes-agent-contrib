/**
 * Hire-gallery starters and the "describe your bot" draft generator.
 *
 * The gallery is a pick-first surface: a starter card (or a free-text
 * description) pre-fills the whole create form — name, role, personality,
 * face, and first-prompt starters — so a working bot is one click away and
 * nothing technical is ever required. Each starter also names the C1 preset
 * (`bot-templates.ts`) whose curated skills and model it hires with, so a
 * card and the in-form preset picker never disagree about what a
 * "Researcher" gets.
 *
 * Everything here is deterministic and offline: a draft is presentation
 * data the dialog can still edit, not a committed profile.
 */

import { blobShapeString } from './avatar'
import type { BotTemplateId } from './bot-templates'
import { slugifyProfileName } from './labels'
import type { BotMeta } from './types'

export interface BotStarter {
  /** Stable id — recorded on the bot's meta as `template` so the empty chat
   *  can offer the same starters after creation. */
  id: string
  /** The C1 preset whose skill curation and model default this card hires
   *  with; 'custom' leaves the clone source's capabilities untouched. */
  preset: BotTemplateId
  /** Display name pre-filled into the form. */
  name: string
  /** Role line ("Research assistant") — becomes the bot's title. */
  title: string
  /** One-line card description. */
  tagline: string
  /** Free-text persona inserted as the SOUL's "## Style" section. */
  persona: string
  /** Clickable first-message suggestions shown in the empty chat. */
  starters: [string, string, string]
  /** Blobatar silhouette pinned on the card and the created bot. */
  blob: string
}

export const BOT_STARTERS: readonly BotStarter[] = [
  {
    id: 'scout',
    preset: 'researcher',
    name: 'Scout',
    title: 'Research assistant',
    tagline: 'Finds, reads, and summarizes anything you point it at.',
    persona:
      'You are thorough and source-driven: look things up rather than guessing, cite what you find, ' +
      'and lead with the answer. Keep summaries tight — bullets over paragraphs.',
    starters: [
      'What can you help me research?',
      'Summarize the state of a topic I care about',
      'Compare the top options for a decision I need to make'
    ],
    blob: 'droplet'
  },
  {
    id: 'forge',
    preset: 'engineer',
    name: 'Forge',
    title: 'Coding partner',
    tagline: 'Writes, reviews, and debugs code alongside you.',
    persona:
      'You are a pragmatic pair-programmer: small clean diffs over rewrites, brief trade-off notes ' +
      'over lectures, and you run the code before claiming it works.',
    starters: [
      'Help me design a small feature',
      'Review some code for edge cases',
      'Walk me through debugging an error'
    ],
    blob: 'hexagon'
  },
  {
    id: 'quill',
    preset: 'custom',
    name: 'Quill',
    title: 'Writer',
    tagline: 'Drafts, edits, and sharpens prose in your voice.',
    persona:
      'You write with a strong voice and an editor’s eye: clear over clever, concrete over ' +
      'abstract. Offer rewrites, not just critique.',
    starters: [
      'Draft an outline for something I need to write',
      'Tighten a paragraph I’ll paste in',
      'Give me five title options for a piece'
    ],
    blob: 'nub'
  },
  {
    id: 'muse',
    preset: 'custom',
    name: 'Muse',
    title: 'Creative companion',
    tagline: 'Brainstorms ideas, names, and directions with you.',
    persona:
      'You are a generative thinking partner: riff freely, offer unexpected angles, and never ' +
      'settle for the first idea. Quantity first — then sharpen the best ones together.',
    starters: [
      'Brainstorm names for a project',
      'Give me three unexpected angles on an idea',
      'Riff on a half-formed thought I have'
    ],
    blob: 'sun'
  },
  {
    id: 'pilot',
    preset: 'ops',
    name: 'Pilot',
    title: 'Ops & routines',
    tagline: 'Runs scheduled jobs and keeps an eye on things.',
    persona:
      'You are calm and operational: confirm schedules plainly, report status without fluff, and ' +
      'flag only what genuinely needs attention.',
    starters: [
      'Set up a recurring check-in for me',
      'Watch something and flag when it changes',
      'Help me plan my week'
    ],
    blob: 'capsule'
  },
  {
    id: 'critique',
    preset: 'custom',
    name: 'Critique',
    title: 'Skeptical reviewer',
    tagline: 'Pokes holes in plans, code, and drafts before they ship.',
    persona:
      'You are a friendly skeptic: you attack ideas, not people. Lead with the strongest ' +
      'objection, rank risks honestly, and always suggest a fix.',
    starters: [
      'What’s wrong with this plan?',
      'Steel-man the other side of a decision',
      'Review a draft before I send it'
    ],
    blob: 'triangle'
  }
]

/** What a gallery pick or the describe box pre-fills into the create form. */
export interface BotDraft {
  /** Friendly display name (the form slugifies it). */
  name: string
  title: string
  description: string
  /** SOUL "## Style" text, '' for none. */
  persona: string
  /** Starters persisted on the bot's meta for the empty-chat chips. */
  starters: string[]
  /** Avatar shape string (blobatar — face follows the final name). */
  shape: string
  /** Starter id the draft came from, when it did. */
  templateId?: string
  /** The C1 preset to curate skills/model with ('custom' = none). */
  preset: BotTemplateId
}

export function findStarter(id: string | null | undefined): BotStarter | undefined {
  return BOT_STARTERS.find(t => t.id === id)
}

export function starterDraft(template: BotStarter): BotDraft {
  return {
    name: template.name,
    title: template.title,
    description: template.tagline,
    persona: template.persona,
    starters: [...template.starters],
    shape: blobShapeString('', template.blob),
    templateId: template.id,
    preset: template.preset
  }
}

/** Starters a bot's empty chat offers: the ones it was created with, else a
 *  generic trio that works for any bot. */
export function chatStarters(meta: BotMeta | null | undefined): string[] {
  const stored = Array.isArray(meta?.starters) ? meta!.starters!.filter(s => typeof s === 'string' && s.trim()) : []

  return stored.length
    ? stored.slice(0, 3)
    : ['What can you do?', 'Tell me about yourself', 'What should we start with?']
}

// ── describe-your-bot ────────────────────────────────────────────────────────

/** An explicit name the user gave the draft ("a reviewer named Ada"). */
const NAME_CLAUSE_RE =
  /\b(?:named|called|name it|name him|name her|call it|call him|call her)\s+["'“”]?([\p{L}\p{N}][\p{L}\p{N}'’_-]{0,30})/iu

const NAME_TRAILER_RE = /[\s,.;:]+(that|who|which|to|for|and|with)\b.*$/i

/** Peel one leading filler layer — run in sequence, each cheap and obvious. */
const LEAD_FILLER_RES = [
  /^please\s+/i,
  /^(?:i\s+(?:want|need|would\s+like|'d\s+like|’d\s+like)\s+(?:to\s+)?|(?:make|create|build|give\s+me)\s+)(?:a\s+|an\s+|me\s+a\s+|me\s+an\s+)?/i,
  /^(?:a|an|the|my)\s+/i,
  /^(?:new\s+)?(?:bot|agent|assistant|companion|helper)\s+(?:that|who|which|to)\s+/i,
  /^(?:new\s+)?(?:bot|agent|assistant|companion|helper)\s+/i
]

function titleCase(words: string): string {
  return words.replace(/\b[\p{L}]/gu, ch => ch.toUpperCase())
}

/** Best-effort display name out of a free-text description. Explicit "named
 *  X" wins; otherwise the first few content words, title-cased. The result is
 *  a SUGGESTION — the user edits it in the form before anything is created. */
export function suggestedName(text: string): string {
  const named = NAME_CLAUSE_RE.exec(text)?.[1]?.replace(NAME_TRAILER_RE, '').trim()

  if (named && slugifyProfileName(named)) {
    return titleCase(named).slice(0, 32).trim()
  }

  let stripped = text

  for (const filler of LEAD_FILLER_RES) {
    stripped = stripped.replace(filler, '')
  }

  const words = stripped.split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
  const candidate = titleCase(words.replace(/[.,;:!?]+$/, ''))
    .slice(0, 32)
    .trim()

  return candidate && slugifyProfileName(candidate) ? candidate : 'Custom Bot'
}

/** The role line under the name — the first clause of the description,
 *  trimmed to one readable line. */
function suggestedTitle(text: string): string {
  const first = text.split(/[.!?\n]/)[0]?.trim() || ''
  const clause = first.length > 72 ? `${first.slice(0, 72).replace(/\s+\S*$/, '')}…` : first

  return clause.slice(0, 72)
}

/** A full draft from the describe box: name guess + role line + the user's
 *  words as the mission, a name-following blob face, and generic starters. */
export function draftFromDescription(raw: string): BotDraft | null {
  const text = raw.trim().replace(/\s+/g, ' ')

  if (!text) {
    return null
  }

  return {
    name: suggestedName(text),
    title: suggestedTitle(text),
    description: text,
    persona: '',
    starters: chatStarters(null),
    shape: 'blobatar',
    preset: 'custom'
  }
}
