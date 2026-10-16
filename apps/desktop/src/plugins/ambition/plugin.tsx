/**
 * Ambition — the desktop surface for the `ambition` agent plugin (a separate
 * install under the Hermes plugins directory). Everything here reads and
 * writes the plugin's own backend REST namespace (`/api/plugins/ambition/*`):
 * the composer chip toggles the session's mode, typed `/ambition` does the
 * same through the session-scoped door, and the transcript renders the
 * plugin's `ambition_card` / `ambition_judge` calls inline. Without the
 * backend plugin the chip hides and the card parts say so — nothing is faked.
 */

import {
  COMPOSER_AREAS,
  type ComposerSlashCommandContext,
  type HermesPlugin,
  host,
  PALETTE_AREA,
  type PaletteContribution,
  type PluginContext,
  queryClient,
  TRANSCRIPT_TOOL_PART_AREA,
  type TranscriptToolPartRenderer
} from '@hermes/plugin-sdk'

import { AMBITION_KEY, bindAmbitionApi, errorText, putMode } from './api'
import { AmbitionCardPart } from './card'
import { AmbitionChip } from './chip'
import { AMBITION_LOCALES, PLUGIN_ID } from './i18n'
import { AmbitionJudgePart } from './judge'

// broadcast_plugin_event("ambition", "card.updated", ...) arrives on the
// gateway stream under this wire name.
const CARD_UPDATED = 'plugin.ambition.card.updated'

/** Typed `/ambition [off]` — the desktop owns it (the backend's public
 *  command surface passes no session id), routed through the same REST call
 *  the chip uses so the mode lands on THIS chat. */
function runAmbitionCommand(arg: string, storedSessionId: null | string, render: (text: string) => void): void {
  if (!storedSessionId) {
    render('Ambition needs a chat to scope to — send a message first.')

    return
  }

  const enabled = arg.trim().toLowerCase() !== 'off'

  void putMode(storedSessionId, enabled)
    .then(() => {
      void queryClient.invalidateQueries({ queryKey: [AMBITION_KEY] })
      render(enabled ? 'Ambition on for this chat.' : 'Ambition off for this chat.')
    })
    .catch((error: unknown) => {
      render(`Ambition: ${errorText(error)}`)
    })
}

const paletteRows = (t: (key: string) => string): PaletteContribution[] => {
  const setMode = (enabled: boolean, missing: string) => {
    const sessionId = host.state.focusedStoredSessionId.get()

    if (!sessionId) {
      host.notify({ kind: 'error', message: missing })

      return
    }

    void putMode(sessionId, enabled)
      .then(() => void queryClient.invalidateQueries({ queryKey: [AMBITION_KEY] }))
      .catch((error: unknown) => host.notifyError(error, errorText(error)))
  }

  const missing = 'Ambition needs a chat to scope to — open or send a message first.'

  return [
    {
      id: 'ambition.on',
      keywords: ['ambition', 'mode', 'card'],
      label: t('onCommand'),
      run: () => setMode(true, missing)
    },
    {
      id: 'ambition.off',
      keywords: ['ambition', 'mode', 'off'],
      label: t('offCommand'),
      run: () => setMode(false, missing)
    }
  ]
}

const plugin: HermesPlugin = {
  id: PLUGIN_ID,
  name: 'Ambition',
  description:
    'Ambition mode: substantial asks get an editable card (Altitude, Depth, Range, Target, Judge) before the work starts, with an outside judge reporting Target vs Measured. Needs the ambition plugin on the Hermes backend.',
  defaultEnabled: true,
  register(ctx: PluginContext) {
    ctx.i18n.register(AMBITION_LOCALES)
    ctx.onDispose(bindAmbitionApi(ctx.rest))
    ctx.onDispose(() => queryClient.removeQueries({ queryKey: [AMBITION_KEY] }))

    // Any card/mode change the plugin announces refetches the session
    // summaries; every surface (chip, cards, judge rows) reads one query.
    ctx.onEvent(CARD_UPDATED, () => void queryClient.invalidateQueries({ queryKey: [AMBITION_KEY] }))

    ctx.registerMany([
      {
        id: 'chip',
        area: COMPOSER_AREAS.actions,
        render: () => <AmbitionChip />
      },
      {
        id: 'card-part',
        area: TRANSCRIPT_TOOL_PART_AREA,
        data: {
          toolName: 'ambition_card',
          render: props => <AmbitionCardPart {...props} />
        } satisfies TranscriptToolPartRenderer
      },
      {
        id: 'judge-part',
        area: TRANSCRIPT_TOOL_PART_AREA,
        data: {
          toolName: 'ambition_judge',
          render: props => <AmbitionJudgePart {...props} />
        } satisfies TranscriptToolPartRenderer
      },
      {
        id: 'slash',
        area: COMPOSER_AREAS.slashCommands,
        data: {
          name: 'ambition',
          run: ({ arg, render, storedSessionId }: ComposerSlashCommandContext) =>
            runAmbitionCommand(arg, storedSessionId, render)
        }
      }
    ])

    const registerPalette = () =>
      ctx.registerMany(
        paletteRows(ctx.i18n.t).map(row => ({
          id: `palette-${row.id}`,
          area: PALETTE_AREA,
          data: {
            id: `ambition.${row.id}`,
            keywords: row.keywords,
            label: row.label,
            run: row.run
          } satisfies PaletteContribution
        }))
      )

    let disposePalette = registerPalette()
    ctx.i18n.onLocaleChange(() => {
      disposePalette()
      disposePalette = registerPalette()
    })
  }
}

export default plugin
