/**
 * Command-palette contribution surface — `palette` data contributions become
 * rows in the ⌘K root list, same schema as every other area. Contributions
 * with an `action` id render that action's live keybind as their hotkey hint.
 */

import { useContributions } from '@/contrib/react/use-contributions'
import type { IconComponent } from '@/lib/icons'

export const PALETTE_AREA = 'palette'

/** Payload of a `palette` data contribution. */
export interface PaletteContribution {
  id: string
  label: string
  /** Keybind action id — its live combo renders as the hotkey hint. */
  action?: string
  icon?: IconComponent
  keywords?: string[]
  run: () => void
  /**
   * Short note after the label — the live state the row acts on. A function
   * because contributions register once at boot while that state keeps moving;
   * the palette re-reads it on open.
   */
  detail?: () => string
  /** `state` when running the row CHANGES what `detail` says. */
  detailVariant?: 'muted' | 'state'
  /** Leave the palette open after running — for rows you may run repeatedly. */
  keepOpen?: boolean
  /**
   * Dynamic child rows expanded into the list on every palette mount — the
   * roster door that contributes one row per live bot. A function because
   * contributions register once at boot while membership keeps changing; the
   * palette re-reads it like `detail`. Children follow the same schema; a
   * missing `label`/`run` drops the child, not the parent row.
   */
  items?: () => PaletteContribution[]
}

/** Contributed palette rows, with stable render keys. */
export function usePaletteContributions(): Array<PaletteContribution & { key: string }> {
  const out: Array<PaletteContribution & { key: string }> = []

  for (const c of useContributions(PALETTE_AREA)) {
    const data = c.data as PaletteContribution
    const keyOf = (id: string) => `${c.source ?? 'core'}:${id}`

    if (data?.label && typeof data.run === 'function') {
      out.push({ key: keyOf(c.id), ...data })
    }

    // A contribution's `items()` is re-read here — same open-time contract as
    // `detail()` — so dynamic memberships (the bot roster) are fresh per open.
    const items = typeof data?.items === 'function' ? data.items() : undefined

    for (const item of items ?? []) {
      if (item?.label && typeof item.run === 'function') {
        out.push({ key: keyOf(`${c.id}/${item.id}`), ...item })
      }
    }
  }

  return out
}

/**
 * A binary setting as one palette row: `Toggle status bar` trailed by the live
 * state. The verb says what the row does, the note says where it stands —
 * neither alone is enough to act on.
 *
 * Rows keep the palette open: flipping a setting is the kind of thing you do
 * two or three of in a row, and the note updating in place is the receipt.
 */
export function paletteToggle(
  spec: Omit<PaletteContribution, 'detail' | 'detailVariant' | 'keepOpen' | 'run'> & {
    get: () => boolean
    set: (enabled: boolean) => void
  }
) {
  const { get, keywords = [], set, ...rest } = spec

  const data: PaletteContribution = {
    ...rest,
    detail: () => (get() ? 'on' : 'off'),
    detailVariant: 'state',
    keepOpen: true,
    keywords: [...keywords, 'on', 'off', 'enable', 'disable'],
    run: () => set(!get())
  }

  return { id: data.id, area: PALETTE_AREA, data }
}
