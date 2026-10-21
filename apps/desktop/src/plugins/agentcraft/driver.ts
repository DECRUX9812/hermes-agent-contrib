/**
 * SimDriver: runs the scenario beats against the SimStore at a tunable speed,
 * with auto-answer for hands-off demo mode.
 */

import { SimDirector } from './director'
import type { CastMember, SimStore } from './model'
import { SimStore as Store } from './model'
import { BEATS } from './scenario'

export interface SimHandle {
  store: SimStore
  director: SimDirector
  running: boolean
  beat: string | null
  beatIndex: number
  promise: Promise<void>
  setSpeed(mult: number): void
  setAutoAnswer(ms: number): void
  stop(): void
}

export function startSim(cast: CastMember[], opts: { speed?: number; autoAnswer?: number; onBeat?: (name: string, i: number) => void } = {}): SimHandle {
  const store: SimStore = new Store(cast)
  const d = new SimDirector(store)
  d.speed = opts.speed ?? 1.6
  d.autoAnswer = opts.autoAnswer ?? 0

  const handle: SimHandle = {
    store,
    director: d,
    running: true,
    beat: null,
    beatIndex: -1,
    promise: Promise.resolve(),
    setSpeed(m) {
      d.speed = m
    },
    setAutoAnswer(ms) {
      d.autoAnswer = ms
    },
    stop() {
      handle.running = false
      d.stop()

      // release any pending decision waiters so the loop can exit
      for (const [key, dec] of store.decisions) {
        if (dec.status === 'open') {store.answerDecision(key, { option: dec.options[0] })}
      }
    },
  }

  handle.promise = (async () => {
    for (let i = 0; i < BEATS.length && handle.running; i++) {
      handle.beat = BEATS[i].name
      handle.beatIndex = i
      opts.onBeat?.(BEATS[i].name, i)

      try {
        await BEATS[i].run(d)
      } catch (err) {
        // a stopped sim rejects sleeps; only surface real errors
        if (!handle.running) {break}
        console.error(`[agentcraft sim] beat ${BEATS[i].name} failed:`, err)
        d.log('marlow', 'error', `sim beat ${BEATS[i].name} failed: ${String(err)}`)
      }
    }

    handle.beat = 'ended'
  })()

  return handle
}
