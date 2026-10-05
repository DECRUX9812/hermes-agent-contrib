import type { AvatarId } from '../protocol'

import type { AvatarDefinition } from './types'

/**
 * The avatar registry (architecture §8.2). Adding an avatar is one file plus
 * one `registerAvatar` call; the dock and the director read this list, so an
 * unregistered avatar can never appear in the UI.
 */
const registry = new Map<AvatarId, AvatarDefinition>()

/** Idempotent by id so Vite HMR re-running a module never duplicates a body. */
export function registerAvatar(definition: AvatarDefinition): void {
  registry.set(definition.id, definition)
}

export function getAvatar(id: AvatarId): AvatarDefinition {
  const definition = registry.get(id)

  if (!definition) {
    throw new Error(`No avatar registered for "${id}"`)
  }

  return definition
}

export function listAvatars(): AvatarDefinition[] {
  return [...registry.values()]
}

export function hasAvatar(id: AvatarId): boolean {
  return registry.has(id)
}
