/**
 * Geometry probes for the screenshot harness.
 *
 * The audit's E3 is blunt: every UI test asserts presence and text, never
 * bounds, so clipped buttons and mid-word truncation ship green. The screenshot
 * catches those by eye — but "by eye" is how the last nine rounds ended up
 * arguing with themselves, and it is how I mis-read two non-bugs on the first
 * pass of this harness.
 *
 * These probes answer the same question with numbers, so a defect can be
 * claimed and then reproduced.
 */

import type { Page } from '@playwright/test'

export interface GeometryProblem {
  kind: 'offscreen' | 'truncated-label'
  /** The control's accessible name, or its text, trimmed for the report. */
  target: string
  detail: string
}

/** Visible interactive controls whose box leaves the window, or whose own label
 *  is ellipsized inside the box that holds it. */
export async function measureClipping(page: Page): Promise<GeometryProblem[]> {
  return page.evaluate(() => {
    const problems: Array<{ kind: 'offscreen' | 'truncated-label'; target: string; detail: string }> = []
    const vw = window.innerWidth
    const vh = window.innerHeight

    // A control that scrolls away is not clipped; one inside a fixed shell is.
    const scrollAxesOf = (el: HTMLElement) => {
      let node: HTMLElement | null = el.parentElement

      while (node) {
        const style = getComputedStyle(node)

        if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
          return { x: true, y: style.overflowY === 'auto' || style.overflowY === 'scroll' }
        }

        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return { x: false, y: true }
        }

        node = node.parentElement
      }

      return { x: false, y: false }
    }

    const selector = 'button, [role="button"], a, [role="tab"], [role="menuitem"]'

    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)

      if (rect.width < 1 || rect.height < 1) {
        continue
      }

      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
        continue
      }

      const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48)
      const scroll = scrollAxesOf(el)

      // All four edges: an element clipped at the left or top is as lost as one
      // clipped at the right or bottom, and an off-canvas panel is only excused
      // on an axis its own container can scroll.
      const edges: string[] = []

      if (rect.left < -1 && !scroll.x) {
        edges.push('left')
      }

      if (rect.right > vw + 1 && !scroll.x) {
        edges.push('right')
      }

      if (rect.top < -1 && !scroll.y) {
        edges.push('top')
      }

      if (rect.bottom > vh + 1 && !scroll.y) {
        edges.push('bottom')
      }

      if (edges.length) {
        problems.push({
          kind: 'offscreen',
          target: label || '(unlabelled)',
          detail: `leaves the window at ${edges.join('+')}: box ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)} in ${vw}x${vh}`
        })

        continue
      }

      // Truncation without an ellipsis (overflow: hidden + nowrap) clips the
      // label mid-word; both are the defect this probe is for, so accept
      // either clipping mode as evidence — the text really is wider than the
      // box that draws it.
      const clipsHorizontally =
        style.overflowX === 'hidden' || style.overflowX === 'clip' || style.textOverflow === 'ellipsis'

      const overflows = el.scrollWidth > el.clientWidth + 1

      if (overflows && clipsHorizontally && label && el.textContent?.trim()) {
        problems.push({
          kind: 'truncated-label',
          target: label,
          detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`
        })
      }
    }

    return Array.from(new Map(problems.map(p => [`${p.kind}|${p.target}|${p.detail}`, p])).values())
  })
}

/** Human-readable one-per-line form, for a failure message. */
export function describeGeometry(problems: GeometryProblem[]): string {
  return problems.map(p => `${p.kind}: ${p.target} — ${p.detail}`).join('\n')
}
