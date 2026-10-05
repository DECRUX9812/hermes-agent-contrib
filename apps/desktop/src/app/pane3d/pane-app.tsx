import { useStore } from '@nanostores/react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useState } from 'react'

import { installPane3dDefaults } from './director/defaults'
import { startRoom } from './director/room-live'
import { $avatars, applyPaneState, pane3dRuntime } from './director/store'
import { HitRegionPublisher } from './hit/publisher'
import { PaneCamera } from './scene/camera'
import { PaneLights } from './scene/lights'
import { prewarmCompletion } from './scene/prewarm'
import { Projector } from './scene/projector'
import { ShaderPrewarm } from './scene/shader-prewarm'
import { Stage } from './scene/stage'
import { PaneOverlay } from './ui/pane-overlay'

/**
 * Counts frames actually rendered and mirrors the live pixel ratio into the
 * runtime object. `useFrame` only fires when the loop draws, so with nothing
 * visible `renderCount` correctly stops rising (VAL-PANE-005).
 */
function FrameCounter(): null {
  useFrame(({ gl }) => {
    pane3dRuntime.renderCount += 1
    pane3dRuntime.pixelRatio = gl.getPixelRatio()
  })

  return null
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden)

  useEffect(() => {
    const onChange = () => setHidden(document.hidden)

    document.addEventListener('visibilitychange', onChange)

    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  return hidden
}

/**
 * The pane's only React surface: one alpha WebGL canvas plus the DOM layer
 * above it. With no avatar summoned the scene paints nothing, which is the
 * correct state when the pane is idle.
 */
export function PaneApp() {
  const avatars = useStore($avatars)
  const documentHidden = useDocumentHidden()
  const anyAvatarVisible = Object.values(avatars).some(avatar => avatar.visible && avatar.state !== 'hidden')
  // Never render continuously unless something is actually on screen (architecture §8.4).
  const frameloop = documentHidden ? 'never' : anyAvatarVisible ? 'always' : 'demand'

  useEffect(() => {
    pane3dRuntime.frameloop = frameloop
  }, [frameloop])

  useEffect(() => {
    installPane3dDefaults()

    const api = window.hermesDesktop?.pane3d

    if (!api) {
      return undefined
    }

    let cancelled = false

    // Subscribe BEFORE announcing readiness: a notification that opened this
    // pane is queued in main until our `ready` arrives, and it must land on a
    // listener that already exists.
    const off = api.onState(applyPaneState)

    // `ready` also waits for the shader pre-warm. Main holds every state until
    // it arrives, so a summon can never reach an avatar whose programs are not
    // linked yet — the first emergence never pays the link (§8.4).
    void prewarmCompletion().then(() => {
      if (!cancelled) {
        api.control({ type: 'ready' })
      }
    })

    return () => {
      cancelled = true
      off()
    }
  }, [])

  // The AvatarRoom (§8.6): facing + rate-limited greetings. It installs the
  // defaults' ConversationSource, so it starts after the effect above.
  useEffect(() => startRoom(), [])

  return (
    <>
      <Canvas
        camera={{ fov: 30, position: [0, 0, 18] }}
        dpr={[1, 1.75]}
        frameloop={frameloop}
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
        onCreated={({ gl }) => {
          // Clip the emergence plane at the anchor edge and clear to full
          // transparency so the desktop shows through.
          gl.localClippingEnabled = true
          gl.setClearAlpha(0)
        }}
        style={{ inset: 0, position: 'absolute' }}
      >
        <PaneCamera />
        <FrameCounter />
        <PaneLights />
        {/* Off-screen, warmed by one draw and kept — see scene/prewarm.ts. */}
        <ShaderPrewarm />
        <Stage />
        <Projector />
      </Canvas>
      <PaneOverlay />
      {/* Click-through: publishes what is interactive, the focus request the
          composer needs, and the darwin/win32 per-pixel ignore toggle (§6). */}
      <HitRegionPublisher />
    </>
  )
}
