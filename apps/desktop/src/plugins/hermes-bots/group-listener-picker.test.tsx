import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createGroupGateway } from './group-test-utils'
import type { ScriptedGateway } from './group-test-utils'
import { translateBots } from './i18n-test-helper'

// The room's listener picker must REVEAL its resolution, not promise it:
// "Auto — the team lead, or everyone" told the user nothing about who Auto
// actually picked. The settings dialog now appends the resolved lead's role
// and name to the Auto option and each member's seat to their own — these
// tests pin that, so a refactor can't quietly go back to a mystery picker.

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))
const state = { gateway: null as null | ScriptedGateway }

vi.mock('@hermes/plugin-sdk', async () => {
  const { useEffect, useState } = await import('react')
  const { pluginSdkMock } = await import('./group-test-utils')
  const base = await pluginSdkMock(host)
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>

  const Button = ({
    children,
    disabled,
    onClick,
    'aria-label': label
  }: {
    'aria-label'?: string
    children?: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )

  return {
    ...base,
    Button,
    RowButton: Button,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Codicon: () => null,
    CopyButton: () => null,
    ToggleRow: () => null,
    ConfirmDialog: () => null,
    Dialog: Passthrough,
    DialogContent: Passthrough,
    DialogDescription: Passthrough,
    DialogFooter: Passthrough,
    DialogHeader: Passthrough,
    DialogTitle: Passthrough,
    Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
    Tip: Passthrough,
    relativeTime: () => 'now',
    // The shared stub returns `data: []`, which can never carry a resolved
    // lead — the picker would show no seat for anyone. Run the real queryFn
    // and land its promise in state, like the live app's react-query does.
    useQuery: (query: { queryFn?: () => Promise<unknown> }) => {
      const [data, setData] = useState<unknown>(undefined)

      useEffect(() => {
        let alive = true

        if (typeof query?.queryFn === 'function') {
          void Promise.resolve(query.queryFn()).then(result => {
            if (alive) {
              setData(result)
            }
          })
        }

        return () => {
          alive = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      return { data, isLoading: false }
    },
    useI18n: () => ({ t: { common: { cancel: 'Cancel', save: 'Save' } } }),
    usePluginI18n: () => translateBots
  }
})
vi.mock('./avatar', () => ({ avatarColor: () => '#888', botAppearance: () => ({}), BotFace: () => null }))
vi.mock('./group-chat-parts', () => ({
  GroupClarifyCard: () => null,
  GroupImageControls: () => null,
  GroupMentionInput: () => null
}))

beforeEach(() => {
  vi.resetModules()
  // The workspace scroll-anchors its log on mount; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

/** The listener picker's <select>, opened through the real settings dialog. */
async function openPicker(options: {
  meta?: Record<string, { title: string }>
  teamLead: { lead: string; lead_title?: string } | null
}) {
  state.gateway = createGroupGateway({ teamLead: options.teamLead })

  for (const key of Object.keys(host)) {
    delete host[key]
  }

  Object.assign(host, state.gateway.host)

  const [{ $botMeta }, { $groupChats }, { GroupChatWorkspace }] = await Promise.all([
    import('./data'),
    import('./group-chat'),
    import('./group-chat-view')
  ])

  if (options.meta) {
    $botMeta.set(options.meta as never)
  }

  $groupChats.set({ Build: { log: [], watermarks: {}, sessions: {} } })
  render(<GroupChatWorkspace group="Build" members={[{ name: 'builder' }, { name: 'reviewer' }] as never} />)
  fireEvent.click(screen.getByLabelText('Group settings for Build'))

  return await waitFor(() => {
    const select = document.getElementById('group-listener-select') as HTMLSelectElement | null

    expect(select).toBeTruthy()

    return select!
  })
}

it('names the resolved lead in the Auto option instead of promising "the team lead, or everyone"', async () => {
  const select = await openPicker({ teamLead: { lead: 'builder', lead_title: 'Frontend Lead' } })
  const auto = select.querySelector('option[value=""]')!

  // The lead's role AND name ride the option: (role · name).
  expect(auto.textContent).toContain('Auto')
  expect(auto.textContent).toContain('Frontend Lead')
  expect(auto.textContent).toContain('Builder')
})

it('shows each member their seat, and stays plain when no team covers the room', async () => {
  const select = await openPicker({
    meta: { builder: { title: 'Frontend Lead' } },
    teamLead: null
  })

  // builder carries a title in bot meta — the seat reads as `Name (Role)`.
  expect(select.querySelector('option[value="builder"]')!.textContent).toContain('Frontend Lead')
  // reviewer has no seat — the listener-only label still names them.
  expect(select.querySelector('option[value="reviewer"]')!.textContent).toContain('Reviewer')
  // No covering team: Auto is the base label, no lead appended.
  expect(select.querySelector('option[value=""]')!.textContent).not.toContain('·')
  // Everyone stays a real, selectable option.
  expect(select.querySelector('option[value="everyone"]')!.textContent.length).toBeGreaterThan(0)
  // The room really asked the backend who leads.
  expect(state.gateway!.rpcFor('bots_team.room_lead').length).toBeGreaterThan(0)
})
