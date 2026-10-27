/**
 * Receipt copy — the Part A half of the instant ack.
 *
 * A model that takes three seconds to its first token cannot truthfully name
 * its first step in one. What CAN be said instantly is what the user just
 * asked: restating their own message claims nothing about progress, tools or
 * timing, so it is still true while the turn has not started.
 *
 * Pure and i18n-free on purpose: the caller wraps this in its own copy
 * (`Got it — …`), so the derivation stays testable without a React tree.
 */

/** Longest restatement we will show. Beyond this it stops being a glance. */
export const RECEIPT_MAX_WORDS = 8

export interface ReceiptDraft {
  /** `command` is a slash command, which runs inline rather than in a turn. */
  kind: 'command' | 'prompt'
  /** The restated ask, without the `Got it —` wrapper. */
  text: string
}

/** Fenced blocks carry the least useful words for a restatement (code, logs). */
const FENCE = /```[\s\S]*?```/g
/** Markdown links keep their label; the URL is noise in a one-line receipt. */
const MD_LINK = /\[([^\]]*)\]\([^)]*\)/g
/** Bare URLs, absolute paths and @file refs: never the point of the ask. */
const NOISE_TOKEN = /^(?:https?:\/\/\S+|www\.\S+|\/[\w./-]+|~\/\S+|@\S+|#\S+)$/i
/** Leading list/quote/heading/task markers, so the restatement starts on a word. */
const LEADING_MARKER = /^(?:[\s>*#–—•\])]+|[-–—]\s+|\d+[.)]\s*|\[[ xX]?\]\s*)/u

/**
 * Peel leading markdown furniture off a prompt — `### - [ ] fix the sidebar`
 * is the ask `fix the sidebar`. Looped because the forms stack: a heading holds
 * a bullet holds a task box, and one pass only ever removes the outermost.
 */
function stripLeadingMarkers(text: string): string {
  let out = text

  for (let pass = 0; pass < 6; pass += 1) {
    const next = out.replace(LEADING_MARKER, '')

    if (next === out) {
      break
    }

    out = next
  }

  return out
}

/**
 * Collapse a prompt to the words worth repeating: no fences, link URLs, bare
 * URLs, paths, or markdown furniture. Whitespace normalises so a pasted table
 * cannot smuggle newlines into the status line.
 */
function restatable(text: string): string {
  return text
    .replace(FENCE, ' ')
    .replace(MD_LINK, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The words a receipt repeats, capped at {@link RECEIPT_MAX_WORDS}. When the
 * ask survives the noise filter as nothing at all (an attachment-only send, a
 * bare URL), there is no honest restatement and the caller gets `null` — the
 * spinner stays rather than a receipt that says "Got it — ".
 */
export function receiptFromPrompt(text: string): ReceiptDraft | null {
  const cleaned = restatable(text)

  if (!cleaned) {
    return null
  }

  const command = /^\/([a-z0-9][\w-]*)/i.exec(cleaned)

  if (command) {
    return { kind: 'command', text: `/${command[1].toLowerCase()}` }
  }

  const words = stripLeadingMarkers(cleaned)
    .split(' ')
    .filter(word => word && !NOISE_TOKEN.test(word))

  if (words.length === 0) {
    return null
  }

  const kept = words.slice(0, RECEIPT_MAX_WORDS).join(' ').replace(/[\s,;:.!?…-]+$/u, '')

  return kept ? { kind: 'prompt', text: kept } : null
}
