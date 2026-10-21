import { atom } from 'nanostores'

import type { AvatarId, DemoScript, NotifyRequest, PageContext, PaneControl } from '@/app/pane3d/protocol'

/**
 * Main-renderer controller for the 3D Pane (architecture §10).
 *
 * The pane is its own window owned by the main process; this store is the
 * client — it opens/closes it, launches the dev demo and hands notifications to
 * the real `AvatarDirector` entry point. Main echoes the pane's `close` back on
 * `hermes:pane3d:control`, so the palette label can never go stale even when the
 * window dies on its own.
 */

/** Whether the 3D Pane window is open. */
export const $pane3dOpen = atom(false)

const pane3dApi = () => window.hermesDesktop?.pane3d

export async function openPane3d(): Promise<boolean> {
  const result = await pane3dApi()?.open()
  const ok = Boolean(result?.ok)

  if (ok) {
    $pane3dOpen.set(true)
  }

  return ok
}

export async function closePane3d(): Promise<boolean> {
  const result = await pane3dApi()?.close()

  $pane3dOpen.set(false)

  return Boolean(result?.ok)
}

export async function togglePane3d(): Promise<void> {
  if ($pane3dOpen.get()) {
    await closePane3d()
  } else {
    await openPane3d()
  }
}

export async function playPane3dDemo(script: DemoScript = 'launch'): Promise<boolean> {
  const result = await pane3dApi()?.playDemo(script)
  const ok = Boolean(result?.ok)

  if (ok) {
    $pane3dOpen.set(true)
  }

  return ok
}

/** Returns the notification id, or null when the pane could not be reached. */
export async function notifyPane3d(request: NotifyRequest): Promise<null | string> {
  const result = await pane3dApi()?.notify(request)

  if (!result?.ok) {
    return null
  }

  $pane3dOpen.set(true)

  return result.id
}

export async function summonPane3d(avatar: AvatarId): Promise<void> {
  await pane3dApi()?.summon(avatar)
}

export async function dismissPane3d(avatar: AvatarId): Promise<void> {
  await pane3dApi()?.dismiss(avatar)
}

export async function capturePane3dContext(): Promise<null | PageContext> {
  return (await pane3dApi()?.captureContext()) ?? null
}

export function handlePane3dControl(control: PaneControl): void {
  if (control?.type === 'close') {
    $pane3dOpen.set(false)
  }
}

if (typeof window !== 'undefined') {
  window.hermesDesktop?.pane3d?.onControl(handlePane3dControl)
  // Seed once from main's authoritative state: reloading the main window while
  // the pane is still open would otherwise leave the palette reading
  // "Open 3D Pane" until the next toggle. Guarded exactly like the
  // subscription above; a closed channel is a no-op, not a boot failure.
  void window.hermesDesktop?.pane3d
    ?.isOpen()
    .then(open => {
      if (open) {
        $pane3dOpen.set(true)
      }
    })
    .catch(() => undefined)
}
