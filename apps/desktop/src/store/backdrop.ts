import { atom, computed } from 'nanostores'

import {
  type BackdropScene,
  type BackdropStrength,
  isBackdropScene,
  isBackdropStrength,
  sceneFromLegacy
} from '@/lib/backdrop-scenes'
import { persistBoolean, persistString, readKey, storedString } from '@/lib/storage'

import { recordFeatureToggle } from './desktop-metrics'

// v1 was one boolean (on = the faint statue). It stays the public SDK key
// (`backdrop.v1`) and its storage schema is kept in step with the scene.
const LEGACY_KEY = 'hermes.desktop.backdrop.v1'
const SCENE_KEY = 'hermes.desktop.backdrop.scene.v2'
const STRENGTH_KEY = 'hermes.desktop.backdrop.strength.v1'
const IMAGE_KEY = 'hermes.desktop.backdrop.image.v1'

function initialScene(): BackdropScene {
  const stored = storedString(SCENE_KEY)

  return isBackdropScene(stored) ? stored : sceneFromLegacy(readKey(LEGACY_KEY))
}

function initialStrength(): BackdropStrength {
  const stored = storedString(STRENGTH_KEY)

  return isBackdropStrength(stored) ? stored : 'balanced'
}

/** Which scene paints behind the conversation. */
export const $backdropScene = atom<BackdropScene>(initialScene())
export const $backdropStrength = atom<BackdropStrength>(initialStrength())
/** The user's own background, as a downscaled data URL (null = none chosen). */
export const $backdropImage = atom<null | string>(storedString(IMAGE_KEY))

/** Tick atom bumped periodically when auto scene is active to re-evaluate local hour. */
export const $backdropAutoTick = atom<number>(0)

let autoTickTimer: ReturnType<typeof setInterval> | null = null

export function clearBackdropAutoTimer(): void {
  if (autoTickTimer !== null) {
    clearInterval(autoTickTimer)
    autoTickTimer = null
  }
}

export function startBackdropAutoTimer(): () => void {
  clearBackdropAutoTimer()
  autoTickTimer = setInterval(() => {
    $backdropAutoTick.set($backdropAutoTick.get() + 1)
  }, 60_000)

  return clearBackdropAutoTimer
}

export function isBackdropAutoTimerActive(): boolean {
  return autoTickTimer !== null
}

/** v1 view: is any backdrop on. */
export const $backdrop = computed($backdropScene, scene => scene !== 'off')

export function setBackdropScene(scene: BackdropScene) {
  const previous = $backdropScene.get()

  if (previous === scene) {
    return
  }

  if (scene !== 'auto') {
    clearBackdropAutoTimer()
  }

  recordFeatureToggle('backdrop', previous !== 'off', scene !== 'off')
  $backdropScene.set(scene)
  persistString(SCENE_KEY, scene)
  persistBoolean(LEGACY_KEY, scene !== 'off')
}

/** v1 setter: on keeps the current scene (or restores the statue, v1's only scene). */
export function setBackdrop(on: boolean) {
  if (!on) {
    setBackdropScene('off')
  } else if ($backdropScene.get() === 'off') {
    setBackdropScene('statue')
  }
}

export function setBackdropStrength(strength: BackdropStrength) {
  $backdropStrength.set(strength)
  persistString(STRENGTH_KEY, strength)
}

/** Store the user's image and switch to it; null forgets it (and leaves the custom scene). */
export function setBackdropImage(dataUrl: null | string) {
  $backdropImage.set(dataUrl)
  persistString(IMAGE_KEY, dataUrl)

  if (dataUrl) {
    setBackdropScene('custom')
  } else if ($backdropScene.get() === 'custom') {
    setBackdropScene('off')
  }
}
