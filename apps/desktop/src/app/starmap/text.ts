import { fmtDate } from '@/lib/time'
import type { StarmapNode } from '@/types/hermes'

export function formatDate(ts?: null | number): string {
  if (!ts) {
    return 'unknown'
  }

  try {
    return fmtDate.format(new Date(ts * 1000))
  } catch {
    return 'unknown'
  }
}

// Tag-style badge items for the hover tooltip — date first. Use-count is NOT a
// badge (rendered separately, right-aligned) so it's excluded here.
export function metaBadges(n: StarmapNode): string[] {
  const out: string[] = [formatDate(n.timestamp)]

  if (n.kind === 'memory') {
    out.push(n.memorySource === 'profile' ? 'profile memory' : 'memory')
  } else {
    out.push(n.category)

    if (n.createdBy === 'agent' || n.createdBy === 'learn') {
      out.push('learned')
    }

    if (n.pinned) {
      out.push('pinned')
    }
  }

  return out.filter(Boolean)
}

// Bare "xN" use-count, last in the badge row. Null when never used.
export function countLabel(n: StarmapNode): null | string {
  return n.kind === 'skill' && n.useCount > 0 ? `x${n.useCount}` : null
}

// Footer-row content for the tooltip. Reserved primitive — returns nothing for
// now (skills have no UUID; their id is just the name). Wire real detail here
// later and the tooltip lays it out automatically.
export function nodeFooter(node: StarmapNode): null | string {
  void node

  return null
}

// Shared grapheme segmenter for oversized-token wrapping — the same Intl
// singleton convention as lib/time. Array.from is the fallback: it keeps code
// points intact, so BMP CJK and most emoji still split safely.
const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

function graphemes(text: string): string[] {
  if (graphemeSegmenter) {
    return [...graphemeSegmenter.segment(text)].map(s => s.segment)
  }

  return Array.from(text)
}

// Greedy word-wrap for the tooltip title so long memory lines don't blow out.
// A single whitespace-delimited word wider than maxW (continuous CJK, a long
// URL) wraps at grapheme boundaries instead of overflowing the card; normal
// words keep the original whitespace-wrap behaviour.
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''

  const fits = (s: string) => ctx.measureText(s).width <= maxW

  for (const word of words) {
    if (!fits(word)) {
      // Oversized token: close the current line, then pack its grapheme
      // clusters within the width budget. A lone cluster wider than maxW gets
      // its own line rather than splitting mid-grapheme.
      if (line) {
        lines.push(line)
        line = ''
      }

      for (const seg of graphemes(word)) {
        const next = line + seg

        if (!line || fits(next)) {
          line = next
        } else {
          lines.push(line)
          line = seg
        }
      }

      continue
    }

    const next = line ? `${line} ${word}` : word

    if (!line || fits(next)) {
      line = next
    } else {
      lines.push(line)
      line = word
    }
  }

  if (line) {
    lines.push(line)
  }

  return lines
}

// Trim to fit maxW, appending an ellipsis (keeps floating labels compact so they
// don't span the overlay).
export function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) {
    return text
  }

  let s = text

  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) {
    s = s.slice(0, -1)
  }

  return `${s.trimEnd()}…`
}
