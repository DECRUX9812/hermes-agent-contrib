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

/** The ONE session-scoped mode write. Both entry points land here — the
 *  composer command and the palette rows — so both hit the plugin's REST door
 *  with an explicit session id: the backend's public command surface carries
 *  none, and the mode belongs to the chat the user is in, not to the process. */
function setModeFor(sessionId: string, enabled: boolean): Promise<void> {
  return putMode(sessionId, enabled).then(() => {
    void queryClient.invalidateQueries({ queryKey: [AMBITION_KEY] })
  })
}

/** Typed `/ambition [off]` — the desktop owns it, routed through the same
 *  session-scoped write the palette rows use so the mode lands on THIS chat.
 *  Resolves once the write and its inline line are done. */
async function runAmbitionCommand(
  arg: string,
  storedSessionId: null | string,
  render: (text: string) => void,
  t: (key: string) => string
): Promise<void> {
  if (!storedSessionId) {
    render(t('needsChat'))

    return
  }

  const enabled = arg.trim().toLowerCase() !== 'off'

  try {
    await setModeFor(storedSessionId, enabled)
    render(enabled ? t('commandOn') : t('commandOff'))
  } catch (error: unknown) {
    render(`${enabled ? t('modeOnFailed') : t('modeOffFailed')} ${errorText(error)}`)
  }
}

const paletteRows = (t: (key: string) => string): PaletteContribution[] => {
  const setMode = (enabled: boolean): Promise<void> => {
    const sessionId = host.state.focusedStoredSessionId.get()

    if (!sessionId) {
      host.notify({ kind: 'error', message: t('needsChat') })

      return Promise.resolve()
    }

    return setModeFor(sessionId, enabled).catch((error: unknown) => {
      host.notifyError(error, errorText(error))
    })
  }

  return [
    {
      id: 'ambition.on',
      keywords: ['ambition', 'mode', 'card', '/ambition'],
      label: t('onCommand'),
      run: () => void setMode(true)
    },
    {
      id: 'ambition.off',
      keywords: ['ambition', 'mode', 'off', '/ambition'],
      label: t('offCommand'),
      run: () => void setMode(false)
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
          description: ctx.i18n.t('commandDesc'),
          run: ({ arg, render, storedSessionId }: ComposerSlashCommandContext) =>
            runAmbitionCommand(arg, storedSessionId, render, ctx.i18n.t)
        }
      }
    ])

    const registerPalette = () =>
      ctx.registerMany(
        paletteRows(ctx.i18n.t).map(row => ({
          id: `palette-${row.id}`,
          area: PALETTE_AREA,
          data: row
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
