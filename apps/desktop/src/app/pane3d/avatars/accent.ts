/**
 * Shared math for the avatars' own accent cues (architecture §8.4).
 *
 * Accent cues are ambient: they never gate a state transition, so they may be
 * damped (unlike the choreographed poses in `scene/choreography.ts`, which must
 * be pure functions of elapsed ms because a deadline reports their completion).
 */

/**
 * Framerate-independent exponential approach. `dt` is the rig's clamped frame
 * delta; `smoothTime` is the time constant in seconds (larger = slower).
 */
export function approach(current: number, target: number, dt: number, smoothTime: number): number {
  if (smoothTime <= 0) {
    return target
  }

  return current + (target - current) * (1 - Math.exp(-dt / smoothTime))
}
