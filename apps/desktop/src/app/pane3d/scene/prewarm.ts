/**
 * Avatar shader pre-warm (architecture §8.4).
 *
 * On this host WebGL runs in software: the first draw of a newly mounted body
 * links its material programs on the renderer's main thread — 0–300 ms for
 * Muse's MeshPhysicalMaterial. That stall used to land on the FIRST summon,
 * pushing the 250 ms reduced-motion fade past its 400 ms bound
 * (VAL-EMERGE-005) and hitching full-motion emergence.
 *
 * The pane therefore mounts every registered body once, off-screen, before it
 * announces `ready`, and DRAWS them once to the canvas. three keeps linked
 * programs in one renderer-wide cache keyed by material parameters plus the
 * renderer's clipping state, tone mapping, output color space, the scene's
 * lights and its environment — all of which are written by a draw, so
 * `gl.compile` links the wrong programs (a real draw of a clipped avatar keys
 * them under `NUM_CLIPPING_PLANES 1` and `TONE_MAPPING`, `compile` under `0`)
 * and the first emergence recompiles anyway.
 *
 * The bodies stay mounted (off-screen and frustum-culled, so they never draw)
 * because the cache is refcounted: unmounting them disposes their materials,
 * which releases the programs and puts the stall right back on the first
 * summon. They are the cache's keep-alive, nothing more.
 *
 * The plan is computed at pane init from `listAvatars()`, so an avatar added to
 * the registry (pane3d-avatar-cast) is warmed with no pre-warm code of its own.
 */

import type { AvatarDefinition } from '../avatars/types'
import type { AvatarId } from '../protocol'

export type PrewarmStage = 'pending' | 'compiling' | 'warm'

export interface PrewarmPlan {
  stage: PrewarmStage
  /** Every id the plan warms. Kept after warm-up so the snapshot can report it. */
  ids: AvatarId[]
}

/**
 * Far below the camera frustum: the warm-up pass draws the bodies with culling
 * off, so nothing lands in the visible frame, and every later frame culls them.
 */
export const PREWARM_OFFSCREEN_Y = -100

/** Fallback so a pane whose canvas never mounts can still announce `ready`. */
export const PREWARM_TIMEOUT_MS = 3000

/** Registry-driven: the plan covers exactly the currently registered avatars. */
export function planPrewarm(definitions: readonly AvatarDefinition[]): PrewarmPlan {
  const ids = definitions.map(definition => definition.id)

  // Nothing to warm settles immediately; there is no body to mount.
  return { ids, stage: ids.length === 0 ? 'warm' : 'pending' }
}

/** The bodies are committed to the scene; the warm-up draw is next. */
export function beginPrewarm(plan: PrewarmPlan): PrewarmPlan {
  return plan.stage === 'pending' ? { ids: plan.ids, stage: 'compiling' } : plan
}

/** Programs are linked and kept; warm-up is terminal (the bodies stay mounted). */
export function completePrewarm(plan: PrewarmPlan): PrewarmPlan {
  return plan.stage === 'warm' ? plan : { ids: plan.ids, stage: 'warm' }
}

let completion: Promise<void> | null = null
let settleCompletion: (() => void) | null = null

/**
 * The live plan, mirrored for `__pane3dDebug.snapshot()` (same pattern as
 * `avatarFrames` in `projection.ts`): the pane's debug surface reads scene-owned
 * module state, and nothing here re-renders React.
 */
let current: PrewarmPlan = { ids: [], stage: 'pending' }

export function prewarmPlan(): PrewarmPlan {
  return current
}

export function setPrewarmPlan(plan: PrewarmPlan): PrewarmPlan {
  current = plan

  return current
}

/**
 * Resolves once `<ShaderPrewarm>` has linked the programs (or the bounded
 * fallback elapses). The pane delays its `ready` handshake on this: main holds
 * every state until `ready`, so a summon can never arrive before the programs
 * exist, and the first emergence never pays for the link.
 */
export function prewarmCompletion(): Promise<void> {
  if (!completion) {
    completion = new Promise<void>(resolve => {
      settleCompletion = resolve
      // A pane whose canvas never mounts must still say ready.
      setTimeout(resolve, PREWARM_TIMEOUT_MS)
    })
  }

  return completion
}

/** Called by `<ShaderPrewarm>` once the programs are linked. Idempotent. */
export function settlePrewarm(): void {
  settleCompletion?.()
  settleCompletion = null
}
