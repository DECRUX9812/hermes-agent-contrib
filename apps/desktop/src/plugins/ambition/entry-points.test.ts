/**
 * The `/ambition` entry points and the ONE write they share.
 *
 * The composer claims the command through `composer.slashCommands` (what a
 * typed `/ambition` resolves to) and the ⌘K palette lists two rows for it. Both
 * must write the session's mode through the plugin's REST door —
 * `PUT /sessions/<id>/mode` — with an EXPLICIT session id: the backend's public
 * command surface passes none, so a write that leaned on the process instead of
 * the chat would land on the wrong conversation.
 *
 * Registration runs through the real context + registry, so "the palette lists
 * it" means the rows are really in the palette area the ⌘K menu reads.
 */

import { COMPOSER_AREAS } from '@hermes/plugin-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// eslint-disable-next-line no-restricted-imports
import { type ComposerSlashCommand, composerSlashCommand } from '@/app/chat/composer/contrib'
// eslint-disable-next-line no-restricted-imports
import { PALETTE_AREA, type PaletteContribution } from '@/app/command-palette/contrib'
// eslint-disable-next-line no-restricted-imports
import { createPluginContext } from '@/contrib/plugin'
// eslint-disable-next-line no-restricted-imports
import { registry } from '@/contrib/registry'
// eslint-disable-next-line no-restricted-imports
import { setRuntimeI18nLocale } from '@/i18n/runtime'
// eslint-disable-next-line no-restricted-imports
import { $selectedStoredSessionId } from '@/store/session'

import { type AmbitionRest, bindAmbitionApi } from './api'
import { PLUGIN_ID } from './i18n'
import plugin from './plugin'

const SESSION = '20260101_090000_abc123'

let rest: ReturnType<typeof vi.fn>
const disposers: Array<() => void> = []

beforeEach(() => {
  setRuntimeI18nLocale('en')
  rest = vi.fn().mockResolvedValue({ enabled: true, session_id: SESSION })
  plugin.register(createPluginContext(PLUGIN_ID, dispose => disposers.push(dispose)))
  // The door both entry points must write through (register binds ctx.rest).
  bindAmbitionApi(rest as unknown as AmbitionRest)
})

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
  $selectedStoredSessionId.set(null)
})

const written = (enabled: boolean) => [`/sessions/${SESSION}/mode`, { body: { enabled }, method: 'PUT' }]

const slashCommand = (): ComposerSlashCommand => {
  const command = composerSlashCommand('ambition')

  expect(command).not.toBeNull()

  return command as ComposerSlashCommand
}

const paletteRow = (id: string): PaletteContribution => {
  const contribution = registry.getArea(PALETTE_AREA).find(c => c.id === `${PLUGIN_ID}:palette-${id}`)

  expect(contribution?.data).toBeTruthy()

  return (contribution as { data: PaletteContribution }).data
}

describe('/ambition entry points', () => {
  it('claims the command in the composer seam and turns the mode on for the chat it ran in', async () => {
    const render = vi.fn()

    await slashCommand().run({ arg: '', render, storedSessionId: SESSION })

    expect(rest).toHaveBeenCalledWith(...written(true))
    expect(render).toHaveBeenCalledWith('Ambition on for this chat.')
  })

  it('turns the mode off for `/ambition off`', async () => {
    const render = vi.fn()

    await slashCommand().run({ arg: 'off', render, storedSessionId: SESSION })

    expect(rest).toHaveBeenCalledWith(...written(false))
    expect(render).toHaveBeenCalledWith('Ambition off for this chat.')
  })

  it('says what it needs instead of writing when there is no session to scope to', async () => {
    const render = vi.fn()

    await slashCommand().run({ arg: '', render, storedSessionId: null })

    expect(rest).not.toHaveBeenCalled()
    expect(render).toHaveBeenCalledWith('Ambition needs a chat to scope to — send a message first.')
  })

  it('reports a failed write inline instead of claiming the mode changed', async () => {
    const render = vi.fn()

    rest.mockRejectedValue(new Error('500: {"detail":"mode store is read-only"}'))

    await slashCommand().run({ arg: '', render, storedSessionId: SESSION })

    expect(render).toHaveBeenCalledWith('Could not turn Ambition on. mode store is read-only')
  })

  it('lists both rows in the palette, findable by the command spelling', () => {
    expect(paletteRow('ambition.on').label).toBe('Ambition: Turn on for this chat')
    expect(paletteRow('ambition.off').label).toBe('Ambition: Turn off for this chat')

    for (const id of ['ambition.on', 'ambition.off']) {
      expect(paletteRow(id).keywords).toContain('/ambition')
    }
  })

  it('writes the FOCUSED chat through the palette rows', async () => {
    $selectedStoredSessionId.set(SESSION)

    paletteRow('ambition.on').run()

    await vi.waitFor(() => expect(rest).toHaveBeenCalledWith(...written(true)))

    rest.mockClear()
    paletteRow('ambition.off').run()

    await vi.waitFor(() => expect(rest).toHaveBeenCalledWith(...written(false)))
  })

  it('writes nothing from the palette with no chat open', () => {
    $selectedStoredSessionId.set(null)

    paletteRow('ambition.on').run()

    expect(rest).not.toHaveBeenCalled()
  })

  it('registers the composer command and the palette rows under the plugin source', () => {
    const slash = registry
      .getArea(COMPOSER_AREAS.slashCommands)
      .find(c => c.id === `${PLUGIN_ID}:slash`)

    expect((slash?.data as ComposerSlashCommand | undefined)?.name).toBe('ambition')
    expect(registry.getArea(PALETTE_AREA).filter(c => c.source === `plugin:${PLUGIN_ID}`)).toHaveLength(2)
  })
})
