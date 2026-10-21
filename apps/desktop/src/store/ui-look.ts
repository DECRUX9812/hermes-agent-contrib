/**
 * The app's look — one presentation choice painted as root attributes that
 * styles.css keys its shape and label tokens off:
 *
 *   `data-look="soft"`     rounded, roomy, sentence-case labels (default)
 *   `data-look="classic"`  the original crisp, square, dense chrome
 *
 * plus `data-interface-mode="simple|advanced"`, so Simple can read a size up
 * without every component asking the mode store. Components never branch on
 * either: they read tokens (`--radius-scalar`, `--control-radius`, `--label-*`,
 * `--tab-label-*`) and the attributes pick the values. Renderer-owned, like
 * bubble transparency (desktop AGENTS.md: state lives with its authority).
 */

import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

import { $interfaceMode } from './interface-mode'

export type UiLook = 'classic' | 'soft'

export const UI_LOOKS: readonly UiLook[] = ['soft', 'classic']

const KEY = 'hermes.desktop.look.v1'

/** Soft is the default: a stored 'classic' is the only other value honored. */
export function parseUiLook(raw: unknown): UiLook {
  return raw === 'classic' ? 'classic' : 'soft'
}

export const $uiLook = atom<UiLook>(typeof window === 'undefined' ? 'soft' : parseUiLook(storedString(KEY)))

export function setUiLook(look: UiLook): void {
  $uiLook.set(parseUiLook(look))
}

if (typeof window !== 'undefined') {
  $uiLook.subscribe(look => {
    document.documentElement.dataset.look = look
    persistString(KEY, look === 'soft' ? null : look)
  })

  $interfaceMode.subscribe(mode => {
    document.documentElement.dataset.interfaceMode = mode
  })
}
