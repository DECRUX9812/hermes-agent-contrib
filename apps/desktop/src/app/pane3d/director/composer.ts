/**
 * The composer's session logic (architecture §8.8).
 *
 * `openComposer` is the single entry point for every trigger (click on an
 * avatar, Enter on its handle, the "Ask" chip). It captures the page context
 * FIRST and only then opens the composer: `COMPOSER_OPEN` is what makes the pane
 * focusable, and focusing steals the selection out of the page (§9,
 * VAL-CONTEXT-002).
 *
 * The captured context lives in `$composer`; a chip's × records the field in
 * `removed`, so `composerEffectiveContext` is what a task ever receives. The
 * tasks feature installs the submitter through `setTaskSubmitter` at the
 * composition point; without one a submit just closes the composer.
 */

import type { AvatarId, DemoScript, PageContext } from '../protocol'

import { dispatch } from './director'
import { $avatars, $composer, type ComposerState, type ContextField } from './store'

/**
 * The main-process capture is bounded to 800 ms, but a broken preload bridge
 * must still not leave the click hanging with no composer.
 */
const CAPTURE_FALLBACK_MS = 1200

/** Installed by the tasks milestone; owns the `SUBMIT` transition. */
export type TaskSubmitter = (
  avatar: AvatarId,
  text: string,
  context: PageContext,
  /** The scripted demo this composer belongs to, if any (§11). */
  demo?: DemoScript
) => void

let submitter: TaskSubmitter | null = null

export function setTaskSubmitter(next: TaskSubmitter | null): void {
  submitter = next
}

/** Avatars whose capture is in flight — a double click must not double-capture. */
const pending = new Set<AvatarId>()

const emptyContext = (): PageContext => ({ capturedAt: Date.now(), source: 'none' })

async function capture(): Promise<PageContext> {
  const api = typeof window === 'undefined' ? undefined : window.hermesDesktop?.pane3d

  if (!api?.captureContext) {
    return emptyContext()
  }

  let timer: ReturnType<typeof setTimeout> | undefined

  const fallback = new Promise<PageContext>(resolve => {
    timer = setTimeout(() => resolve(emptyContext()), CAPTURE_FALLBACK_MS)
  })

  try {
    const read = api.captureContext().catch(() => emptyContext())

    return await Promise.race([read, fallback])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

/**
 * Capture, then open. Nothing happens when the avatar is not idle: the machine
 * only accepts `COMPOSER_OPEN` from `idle`, and a stale capture (the avatar was
 * dismissed while the read was in flight) must not resurrect a composer.
 *
 * `options` lets the launch demo pre-fill the draft, mark it as harness content
 * and tag the composer with its own script (§11); a plain click passes nothing.
 */
export async function openComposer(
  id: AvatarId,
  options: { draft?: string; source?: 'dev-harness'; demo?: DemoScript } = {}
): Promise<void> {
  const row = $avatars.get()[id]

  if (!row || row.state !== 'idle' || pending.has(id)) {
    return
  }

  pending.add(id)

  try {
    const context = await capture()
    const after = $avatars.get()[id]

    if (!after || after.state !== 'idle') {
      return
    }

    dispatch(id, 'COMPOSER_OPEN')

    if ($avatars.get()[id].state !== 'listening') {
      return
    }

    $composer.set({
      avatar: id,
      context,
      demo: options.demo,
      draft: options.draft,
      removed: [],
      source: options.source
    })
  } finally {
    pending.delete(id)
  }
}

export function closeComposer(id: AvatarId): void {
  dispatch(id, 'COMPOSER_CLOSE')
}

export function removeContextField(field: ContextField): void {
  const state = $composer.get()

  if (!state || state.removed.includes(field)) {
    return
  }

  $composer.set({ ...state, removed: [...state.removed, field] })
}

/** The captured context minus the chips the user removed (§8.8). */
export function composerEffectiveContext(state: ComposerState): PageContext {
  const { context, removed } = state
  const keep = (field: ContextField) => !removed.includes(field)
  const out: PageContext = { capturedAt: context.capturedAt, source: context.source }

  if (context.url !== undefined && keep('url')) {
    out.url = context.url
  }

  if (context.title !== undefined && keep('title')) {
    out.title = context.title
  }

  if (context.selection !== undefined && keep('selection')) {
    out.selection = context.selection
  }

  if (context.app !== undefined) {
    out.app = context.app
  }

  return out
}

/**
 * Enter in the composer. The installed submitter receives the trimmed text, the
 * effective context and the composer's demo tag (if it has one), and the avatar
 * enters `thinking`; without one the composer simply closes, so a stray Enter
 * cannot leave a listening avatar with no task behind it.
 */
export function submitComposer(id: AvatarId, text: string): void {
  const state = $composer.get()

  if (!state || state.avatar !== id) {
    return
  }

  const row = $avatars.get()[id]

  if (!row || row.state !== 'listening') {
    return
  }

  const clean = text.trim()
  const context = composerEffectiveContext(state)

  $composer.set(null)

  if (!submitter) {
    dispatch(id, 'COMPOSER_CLOSE')

    return
  }

  dispatch(id, 'SUBMIT')
  submitter(id, clean, context, state.demo)
}

// Any path that ends `listening` — Esc, Hide, a dismiss — drops the composer
// state, so the pane can never stay focusable with no composer on screen.
$avatars.listen(rows => {
  const state = $composer.get()

  if (state && rows[state.avatar]?.state !== 'listening') {
    $composer.set(null)
  }
})
