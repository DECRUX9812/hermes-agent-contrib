/**
 * Handoff flight: when a handoff lands while the room is open, a small card
 * carrying its task flies from the sender's face to the receiver's face, and
 * the receiver's face pops. Faces are found by `data-member-face`; the
 * members panel, sheet and strip are preferred over the header pile, whose
 * faces overlap and are too close together to read as movement.
 */

import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'

import type { RoomHandoff } from './group-room-handoffs'
import { flyBetween } from './motion'

const FACE_SCOPES = ['group-room-aside', 'group-room-sheet', 'group-room-strip']
// A burst of handoffs (history catching up after a reconnect) should not turn
// into a swarm of ghosts.
const MAX_FLIGHTS = 3

function visible(node: HTMLElement): boolean {
  const rect = node.getBoundingClientRect()

  return rect.width > 0 && rect.height > 0
}

/** The best on-screen face for a member key under `root`, or null. */
export function findMemberFace(root: ParentNode, key: string): HTMLElement | null {
  const faces = [...root.querySelectorAll<HTMLElement>('[data-member-face]')].filter(
    node => node.dataset.memberFace === key && visible(node)
  )

  for (const scope of FACE_SCOPES) {
    const inScope = faces.find(node => node.closest(`[data-testid="${scope}"]`))

    if (inScope) {
      return inScope
    }
  }

  return faces[0] || null
}

function handoffGhost(task: string): HTMLElement {
  const node = document.createElement('div')
  node.className =
    'flex h-6 max-w-48 items-center gap-1 rounded-pill border border-line bg-surface-raised px-2 text-ui-2xs text-fg-secondary shadow-e2'
  const glyph = document.createElement('span')
  glyph.className = 'codicon codicon-arrow-swap shrink-0 text-brand'
  const label = document.createElement('span')
  label.className = 'truncate'
  label.textContent = task
  node.append(glyph, label)

  return node
}

/**
 * Fly every handoff first seen after the room opened. The first pass (and a
 * room switch, via `reset`) only records the baseline, and handoffs dated
 * before the mount never fly, so history that loads late stays still.
 */
export function useHandoffFlights(
  root: RefObject<HTMLElement | null>,
  handoffs: readonly RoomHandoff[],
  keyOf: (name: string) => null | string,
  reset: string
): void {
  const current = useRef<{ mountedAt: number; reset: string; seen: Set<string> | null }>({
    mountedAt: Date.now(),
    reset,
    seen: null
  }).current

  if (current.reset !== reset) {
    current.mountedAt = Date.now()
    current.reset = reset
    current.seen = null
  }

  useEffect(() => {
    if (current.seen === null) {
      current.seen = new Set(handoffs.map(h => h.id))

      return
    }

    const seen = current.seen
    const fresh = handoffs.filter(h => !seen.has(h.id))
    fresh.forEach(h => seen.add(h.id))
    const el = root.current

    if (!el) {
      return
    }

    for (const handoff of fresh.filter(h => h.at >= current.mountedAt).slice(-MAX_FLIGHTS)) {
      const from = handoff.fromUser ? null : keyOf(handoff.from)
      const to = keyOf(handoff.to)

      if (from && to && from !== to) {
        void flyBetween(findMemberFace(el, from), findMemberFace(el, to), handoffGhost(handoff.task))
      }
    }
  })
}
