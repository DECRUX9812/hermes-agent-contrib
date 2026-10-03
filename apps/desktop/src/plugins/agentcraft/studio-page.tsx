/**
 * StudioPage: full-bleed three.js canvas + HUD. The page owns the scene
 * lifecycle (mount/dispose on unmount) and hosts the modal surfaces.
 */

import { useEffect, useRef, useState } from 'react'

import { AgentCard, AgentChips, Controls, DecisionBanner, DecisionScreen, FeedTicker, GoalChip } from './hud'
import type { SimDecision } from './model'
import { createStudio, type StudioScene } from './scene'

export function StudioPage() {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<StudioScene | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoAnswer, setAutoAnswer] = useState(false)
  const [openDecision, setOpenDecision] = useState<SimDecision | null>(null)
  const [openAgent, setOpenAgent] = useState<string | null>(null)
  const [, forceTick] = useState(0)

  // eslint-disable-next-line no-restricted-syntax -- the three.js scene handle lives in a ref for imperative callbacks, not an atom mirror
  useEffect(() => {
    const host = hostRef.current

    if (!host) {return}
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let dead = false
    let scene: StudioScene | null = null
    let un: (() => void) | null = null
    createStudio({
      container: host,
      reducedMotion: reduced,
      autoAnswer: 0,
      onEvent: kind => {
        if (kind === 'decision') {forceTick(v => v + 1)}
      },
    })
      .then(s => {
        if (dead) {
          s.dispose()

          return
        }

        scene = s
        sceneRef.current = s
        // keep react state fresh on store changes (cheap — components throttle)
        un = s.store.on(() => forceTick(v => v + 1))
        const params = new URLSearchParams(location.search)
        const cam = params.get('cam')

        if (cam) {s.flyTo(cam)}
        const t = params.get('time')

        if (t === 'day' || t === 'golden' || t === 'night') {s.setTime(t)}
        const follow = params.get('follow')

        if (follow) {s.followAgent(follow)}
        const aa = params.get('auto') === '1'

        if (aa) {s.setAutoAnswer(true)}
        setAutoAnswer(aa)
        const spd = Number(params.get('speed'))

        if (spd > 0) {s.setSpeed(spd)}
        // demo/test hook: lets harnesses drive the scene (flyTo/setTime/follow)
        ;(window as unknown as Record<string, unknown>).__studio = s
        setReady(true)
      })
      .catch(err => setError(String(err)))

    return () => {
      dead = true
      un?.()
      scene?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setAutoAnswer(autoAnswer)
  }, [autoAnswer])

  // pause when the tab/window is hidden
  useEffect(() => {
    const onVis = () => sceneRef.current?.setRunning(!document.hidden)
    document.addEventListener('visibilitychange', onVis)

    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const store = sceneRef.current?.store ?? null

  return (
    <div className="ac-page">
      <div className="ac-canvas-host" ref={hostRef} />
      {error && <div className="ac-error">studio failed to start: {error}</div>}
      {!ready && !error && <div className="ac-boot">building the studio…</div>}
      {ready && store && sceneRef.current && (
        <>
          <div className="ac-top-left">
            <GoalChip onClick={() => sceneRef.current?.flyTo('entrance_atrium')} store={store} />
          </div>
          <div className="ac-top-right">
            <Controls
              autoAnswer={autoAnswer}
              initialSpeed={Number(new URLSearchParams(location.search).get('speed')) || 1.6}
              initialTime={(() => {
                const t = new URLSearchParams(location.search).get('time')

                return t === 'day' || t === 'night' ? t : 'golden'
              })()}
              scene={sceneRef.current}
              setAutoAnswer={setAutoAnswer}
            />
          </div>
          <div className="ac-right">
            <AgentChips
              onFocus={id => sceneRef.current?.followAgent(id)}
              onOpen={id => setOpenAgent(id)}
              store={store}
            />
          </div>
          <div className="ac-bottom-left">
            <FeedTicker store={store} />
          </div>
          <div className="ac-top-center">
            <DecisionBanner
              onOpen={d => {
                setOpenDecision(d)
                sceneRef.current?.openDecisionFocus()
              }}
              store={store}
            />
          </div>
          {openDecision && store.decisions.get(openDecision.key)?.status === 'open' && (
            <DecisionScreen decision={openDecision} onClose={() => setOpenDecision(null)} store={store} />
          )}
          {openAgent && <AgentCard agentId={openAgent} onClose={() => setOpenAgent(null)} store={store} />}
        </>
      )}
    </div>
  )
}

export default StudioPage
