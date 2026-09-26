import { LAYOUT_KEYS } from '@/lib/layout-persistence'
import { Codecs } from '@/lib/persisted'
import { modeLayout } from '@/store/interface-mode'

import { findGroupOfPane, findParentSplit, type LayoutNode } from './model'

// SPLIT-SHARE MEMORY — a tile pane that leaves the tree (the browser closed,
// a page tile closed) records the share it held against its seam neighbor, so
// re-opening it docks at the size the user left it. Without this every
// re-open split the anchor zone [1, 1] again: each agent-triggered browser
// open re-took half the chat, whatever the user had resized it to.
const validShare = (share: unknown): share is number =>
  typeof share === 'number' && Number.isFinite(share) && share > 0 && share < 1

// The seam partner each recorded share was measured against. A share is only
// meaningful against THAT pane: a reload re-docks tiles in anchor order
// against a differently shaped row, and replaying an even-row 0.5 there is
// how tiles later in the re-dock chain came back at half width (#108679).
const $paneSharePartners = modeLayout.atom<Record<string, string>>(
  LAYOUT_KEYS.sharePartners,
  () => ({}),
  Codecs.json(value =>
    value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).filter(([, partner]) => typeof partner === 'string' && partner))
      : {}
  )
)

// True while the persisted tree is being reconciled at boot (the reload
// prune→re-register cycle). Share recording is suspended for its duration: a
// hydration prune is not a user resize, and remembering its geometry is what
// seeded the stale 0.5 shares #108679 replays.
let layoutHydrating = false

/** Suspend share recording while hydration reconciles the persisted tree. */
export function beginLayoutHydration(): void {
  layoutHydrating = true
}

/** Resume share recording after hydration settles. */
export function endLayoutHydration(): void {
  layoutHydrating = false
}

const $paneShares = modeLayout.atom<Record<string, number>>(
  LAYOUT_KEYS.shares,
  () => ({}),
  Codecs.json(value =>
    value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).filter(([, share]) => validShare(share)))
      : {}
  )
)

export function rememberPaneShare(tree: LayoutNode, paneId: string) {
  // A hydration prune must never write remembered geometry (#108679): the
  // reload cycle removes every persisted tile and re-docks it moments later,
  // and the share it "held" at removal belongs to a row shape that no longer
  // exists by the time it returns.
  if (layoutHydrating) {
    return
  }

  const zone = findGroupOfPane(tree, paneId)

  // Only a pane ALONE in its zone owns the zone's track — a stacked tab's
  // removal doesn't change geometry, so there's no share to remember.
  if (!zone || zone.panes.length !== 1) {
    return
  }

  const parent = findParentSplit(tree, zone.id)

  if (!parent) {
    return
  }

  // The previous sibling is the seam partner a re-dock will split again (a
  // trailing dock lands the tile right of / below its anchor); the pane at
  // index 0 pairs with the sibling after it instead.
  const at = parent.children.findIndex(child => child.id === zone.id)
  const partner = at > 0 ? at - 1 : at + 1
  const pair = (parent.weights[at] ?? 1) + (parent.weights[partner] ?? 1)
  const share = pair > 0 ? (parent.weights[at] ?? 1) / pair : null

  if (validShare(share)) {
    // The seam partner as a PANE id, for partner-validated recall. A zone
    // holding several panes has no single seam pane — its share can never be
    // partner-validated, so it records without a partner and falls back to
    // even on any mismatched recall.
    const partnerGroup = parent.children[partner] as LayoutNode

    const partnerPane = partnerGroup.type === 'group' && partnerGroup.panes.length === 1 ? partnerGroup.panes[0] : null

    $paneShares.set({ ...$paneShares.get(), [paneId]: share })

    // Remember the seam partner only when it is a REAL pane id — a share
    // against a nameless or multi-pane zone can never be partner-validated.
    if (partnerPane) {
      $paneSharePartners.set({ ...$paneSharePartners.get(), [paneId]: partnerPane })
    }
  }
}

/** The [target, added] weight pair a re-inserted pane's edge split should get,
 *  or undefined for the even default. Persisted state is untrusted. */
export function recalledEdgeWeights(paneId: string, anchorPaneId?: string): [number, number] | undefined {
  const share = $paneShares.get()[paneId]

  if (!validShare(share)) {
    return undefined
  }

  // Partner validation (#108679): the share was recorded against a specific
  // seam neighbor. Replaying it against a different partner docks the pane at
  // a share that belonged to another row shape — fall back to even instead.
  const partner = $paneSharePartners.get()[paneId]

  if (partner && anchorPaneId && partner !== anchorPaneId) {
    return undefined
  }

  return [1 - share, share]
}

/** The recorded seam shares, for tests and diagnostics. */
export const $paneShareRecords = $paneShares
