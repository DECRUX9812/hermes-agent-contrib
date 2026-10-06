/**
 * The composer's context chips (architecture §8.8) — pure derivation from a
 * captured `PageContext` plus the fields the user removed.
 *
 * `hermes-browser` shows the domain, the page title and the quoted selection;
 * an OS window shows a single "title only" chip; nothing (or everything
 * removed) shows one non-removable "No page context" chip. VAL-CONTEXT-003.
 */

import type { ContextField } from '../director/store'
import type { PageContext } from '../protocol'

export type ComposerChipKind = 'url' | 'title' | 'selection' | 'none' | 'title-only'

export interface ComposerChip {
  kind: ComposerChipKind
  label: string
  /** The context field the × removes; absent on the non-removable empty chip. */
  field?: ContextField
}

/** The selection chip quotes this many characters, then ellipsises (§8.8). */
export const SELECTION_CHIP_CHARS = 140

export function selectionExcerpt(text: string, max: number = SELECTION_CHIP_CHARS): string {
  const trimmed = text.trim()

  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/**
 * The domain chip's label: host and port (`127.0.0.1:5181`), falling back to
 * the raw string when it does not parse as a URL.
 */
export function domainLabel(url: string): string {
  try {
    const host = new URL(url).host

    if (host) {
      return host
    }
  } catch {
    // Not an absolute URL — strip a scheme below and show what is left.
  }

  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0] || url
}

export function contextChips(context: PageContext, removed: readonly ContextField[] = []): ComposerChip[] {
  const chips: ComposerChip[] = []
  const keep = (field: ContextField) => !removed.includes(field)

  if (context.source === 'hermes-browser') {
    if (context.url && keep('url')) {
      chips.push({ field: 'url', kind: 'url', label: domainLabel(context.url) })
    }

    if (context.title && keep('title')) {
      chips.push({ field: 'title', kind: 'title', label: context.title })
    }

    if (context.selection && keep('selection')) {
      chips.push({ field: 'selection', kind: 'selection', label: `“${selectionExcerpt(context.selection)}”` })
    }
  } else if (context.source === 'os-window') {
    const label = context.title || context.app || ''

    if (label && keep('title')) {
      chips.push({ field: 'title', kind: 'title-only', label })
    }
  }

  if (chips.length === 0) {
    chips.push({ kind: 'none', label: 'No page context' })
  }

  return chips
}
