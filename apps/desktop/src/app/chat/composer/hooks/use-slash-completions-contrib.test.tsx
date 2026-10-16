/**
 * `composer.slashCommands` contributions merge into the composer's `/` popover
 * (use-slash-completions) — a plugin-owned client command has to be
 * discoverable in the list, not only runnable when typed out. Covers: a
 * registered command is listed with the payload's label and description,
 * prefix filtering, the pick → dispatch journey reaching the registered
 * handler, the backend twin of a claimed name being dropped, and the list
 * staying untouched when nothing is registered.
 *
 * Rows come from the real registry, the dispatch goes through the real
 * `useSlashCommand`, and the pick path serializes with the real formatter; the
 * gateway transport is the only stub.
 */

import type { Unstable_TriggerItem } from '@assistant-ui/core'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { COMPOSER_AREAS, type ComposerSlashCommand } from '@/app/chat/composer/contrib'
import { useSlashCommand } from '@/app/session/hooks/use-prompt-actions/slash'
import { hermesDirectiveFormatter } from '@/components/assistant-ui/directive-text'
import { registry } from '@/contrib/registry'
import type { HermesGateway } from '@/hermes'
import { TRANSLATIONS } from '@/i18n/catalog'
import { rememberDesktopCommandsCatalog } from '@/lib/desktop-slash-commands'
import { queryClient } from '@/lib/query-client'

import { useSlashCompletions } from './use-slash-completions'

const CATALOG = {
  categories: [{ name: 'Session', pairs: [['/new', 'Start a new session']] }],
  pairs: [
    ['/new', 'Start a new session'],
    ['/demo-skill', 'Summarize the demo logs']
  ]
}

/** The same install, plus the backend's own row for the name the plugin below
 *  claims — both the catalog and a typed lookup name it. */
const TWIN_CATALOG = {
  categories: [
    {
      name: 'Session',
      pairs: [
        ['/new', 'Start a new session'],
        ['/demo-report', 'Backend copy of the demo report']
      ]
    }
  ],
  pairs: [
    ['/new', 'Start a new session'],
    ['/demo-report', 'Backend copy of the demo report']
  ]
}

const SESSION = '20260101_090000_demo01'

const disposers: Array<() => void> = []

function registerCommand(data: ComposerSlashCommand) {
  disposers.push(registry.register({ id: 'demo-plugin:slash', area: COMPOSER_AREAS.slashCommands, data }))
}

function gatewayStub(options: { catalog?: typeof CATALOG; items?: unknown[] } = {}) {
  const items = options.items ?? [
    { text: '/demo-skill', display: '/demo-skill', kind: 'skill', meta: 'Summarize the demo logs' }
  ]

  return {
    request: vi.fn(async (method: string) =>
      method === 'commands.catalog' ? (options.catalog ?? CATALOG) : { items, replace_from: 1 }
    )
  }
}

const commandsOf = (items: readonly Unstable_TriggerItem[]) =>
  items.map(item => (item.metadata as { command?: string })?.command)

function harness(gateway: HermesGateway) {
  const api: { search?: (query: string) => readonly Unstable_TriggerItem[] } = {}

  function Probe() {
    const { adapter } = useSlashCompletions({ gateway })
    api.search = adapter.search

    return null
  }

  render(<Probe />)

  return api as { search: (query: string) => readonly Unstable_TriggerItem[] }
}

/** Drive the adapter until its async fetch has settled into `search`'s result. */
async function completions(api: { search: (query: string) => readonly Unstable_TriggerItem[] }, query: string) {
  await act(async () => {
    api.search(query)
    await Promise.resolve()
  })

  // The debounce is skipped only for cached queries; give the timer a beat.
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 120))
  })

  return api.search(query)
}

/** The real dispatcher, with only the plumbing a slash command needs. */
function mountDispatch(request: ReturnType<typeof vi.fn>) {
  return renderHook(() =>
    useSlashCommand({
      activeSessionIdRef: { current: 'rt-demo' },
      appendSessionTextMessage: vi.fn(),
      branchCurrentSession: async () => false,
      busyRef: { current: false },
      copy: TRANSLATIONS.en.desktop,
      createBackendSessionForSend: async () => 'rt-created',
      getRoutedStoredSessionId: () => null,
      getRuntimeIdForStoredSession: () => null,
      handleSkinCommand: () => '',
      handoffSession: async () => ({ ok: true }),
      openMemoryGraph: vi.fn(),
      refreshSessions: async () => undefined,
      requestGateway: request,
      resumeStoredSession: vi.fn(),
      selectedStoredSessionIdRef: { current: SESSION },
      startFreshSessionDraft: vi.fn(),
      submitPromptText: async () => true,
      updateSessionState: vi.fn()
    } as never)
  )
}

afterEach(() => {
  // Unmount before disposing: a registry mutation notifies the mounted probe.
  cleanup()
  disposers.splice(0).forEach(dispose => dispose())
  queryClient.clear()
  rememberDesktopCommandsCatalog(undefined)
})

describe('plugin slash commands in the `/` popover', () => {
  it('lists a registered command with the label from the payload and the `/name` it inserts', async () => {
    registerCommand({
      name: 'demo-report',
      label: 'Demo report',
      description: 'Write the demo report',
      run: vi.fn()
    })

    const api = harness(gatewayStub() as unknown as HermesGateway)

    const row = (await completions(api, 'demo')).find(
      item => (item.metadata as { command?: string })?.command === '/demo-report'
    )

    expect(row?.label).toBe('Demo report')
    expect(row?.description).toBe('Write the demo report')
    // The title is a label; the chip and the dispatcher carry the spelling.
    expect(hermesDirectiveFormatter.serialize(row as Unstable_TriggerItem)).toBe('/demo-report')
  })

  it('falls back to the command spelling as the row title', async () => {
    registerCommand({ name: 'demo-report', description: 'Write the demo report', run: vi.fn() })

    const api = harness(gatewayStub() as unknown as HermesGateway)
    const rows = await completions(api, 'demo')

    expect(rows.find(item => (item.metadata as { command?: string })?.command === '/demo-report')?.label).toBe(
      'demo-report'
    )
  })

  it('filters plugin commands by prefix, and offers none past the name', async () => {
    registerCommand({ name: 'demo-report', run: vi.fn() })

    const api = harness(gatewayStub() as unknown as HermesGateway)

    expect(commandsOf(await completions(api, 'demo'))).toContain('/demo-report')
    expect(commandsOf(await completions(api, 'zzz'))).not.toContain('/demo-report')
    expect(commandsOf(await completions(api, 'demo-report off'))).not.toContain('/demo-report')
  })

  it('runs the registered handler when its row is picked, without reaching the backend', async () => {
    const run = vi.fn()

    registerCommand({ name: 'demo-report', description: 'Write the demo report', run })

    const gateway = gatewayStub()
    const api = harness(gateway as unknown as HermesGateway)

    const row = (await completions(api, 'demo')).find(
      item => (item.metadata as { command?: string })?.command === '/demo-report'
    )

    expect(row).toBeTruthy()

    // Picking serializes the row into the chip's text; submitting that text is
    // the journey a typed `/demo-report` takes.
    const typed = hermesDirectiveFormatter.serialize(row as Unstable_TriggerItem)
    const { result } = mountDispatch(gateway.request)

    await act(() => result.current(typed))

    expect(run).toHaveBeenCalledWith({ arg: '', render: expect.any(Function), storedSessionId: SESSION })

    const methods = gateway.request.mock.calls.map(call => call[0])

    expect(methods).not.toContain('slash.exec')
    expect(methods).not.toContain('command.dispatch')
  })

  it('drops the backend rows naming a command the plugin claims, in both list paths', async () => {
    registerCommand({
      name: 'demo-report',
      label: 'Demo report',
      description: 'Write the demo report',
      run: vi.fn()
    })

    const typed = await completions(
      harness(
        gatewayStub({
          catalog: TWIN_CATALOG,
          items: [
            {
              text: '/demo-report',
              display: '/demo-report',
              kind: 'command',
              meta: 'Backend copy of the demo report'
            }
          ]
        }) as unknown as HermesGateway
      ),
      'demo'
    )

    // `runSlash` resolves the plugin before any backend surface, so the
    // backend's twin is a row the user could never run — it goes, and the
    // plugin's own row is what remains.
    expect(commandsOf(typed)).toEqual(['/demo-report'])
    expect(typed[0]?.label).toBe('Demo report')

    const browsed = commandsOf(await completions(harness(gatewayStub({ catalog: TWIN_CATALOG }) as unknown as HermesGateway), ''))

    expect(browsed.filter(command => command === '/demo-report')).toEqual(['/demo-report'])
    expect(browsed[0]).toBe('/demo-report')
  })

  it('leaves the list alone when nothing is registered', async () => {
    const api = harness(gatewayStub() as unknown as HermesGateway)

    expect(commandsOf(await completions(api, ''))).toEqual(['/new', '/demo-skill'])
    expect(commandsOf(await completions(api, 'demo'))).toEqual(['/demo-skill'])
  })
})
