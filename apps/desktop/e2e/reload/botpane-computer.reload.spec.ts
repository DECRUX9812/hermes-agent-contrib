import { expect, type Page, test } from '@playwright/test'

import { currentSessionId, recordWebSockets, send } from '../core/harness'

import { bootReal, reloadWindow, rpc, shot } from './reload-harness'

const PROFILE = 'computer-bot'
const MARKER = `U2-${Math.random().toString(36).slice(2, 8)}`
const TODO_A = 'Inspect the release notes'
const TODO_B = 'Summarize the changes'

async function openBots(page: Page): Promise<void> {
  const botsRailEntry = page.locator('[data-slot="activity-rail"] [data-rail-entry="hermes-bots:pane"]')
  await botsRailEntry.click()

  if (await page.getByRole('button', { name: 'Show sidebar', exact: true }).isVisible()) {
    await botsRailEntry.click()
  }

  await expect(page.getByRole('button', { name: 'New bot or group chat' })).toBeVisible()
}

async function createBot(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New bot or group chat' }).click()
  await page.getByRole('menuitem', { name: /^New bot$/i }).click()

  const dialog = page.getByRole('dialog', { name: /^New bot$/i })
  await dialog.getByRole('textbox', { name: 'Bot name' }).fill(PROFILE)
  await dialog.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect
    .poll(
      async () => {
        const result = await rpc<{ profiles: { name: string }[] }>(page, 'profiles.list')

        return result.profiles.some(profile => profile.name === PROFILE)
      },
      { timeout: 60_000 }
    )
    .toBe(true)
}

async function openBotChat(page: Page): Promise<string> {
  await page.locator(`[data-slot="bots-roster"] [data-roster-key="local::${PROFILE}"]`).click()

  const profile = await rpc<{
    profiles: { canonical_session?: { id?: string; resolved_id?: string } | null; name: string }[]
  }>(page, 'profiles.list')

  const canonical = profile.profiles.find(item => item.name === PROFILE)?.canonical_session
  const sessionId = canonical?.resolved_id || canonical?.id || ''
  expect(sessionId).not.toBe('')

  await expect.poll(() => currentSessionId(page)).toBe(sessionId)

  return sessionId
}

async function openBotPaneTab(page: Page, tab: 'activity' | 'bot' | 'scheduled'): Promise<void> {
  const tabButton = page.getByTestId(`rail-tab:${tab}`)

  if (!(await tabButton.isVisible())) {
    const context = page.locator('[data-slot="pane-tab"][data-vertical="true"]').filter({ hasText: 'Bot context' })
    await context.click()
  }

  await tabButton.click()
}

async function createRoutine(page: Page, kind: 'schedule' | 'watch'): Promise<void> {
  const routines = page.getByTestId('rail-section:routines')
  const heading = routines.getByRole('button').first()

  if ((await heading.getAttribute('aria-expanded')) !== 'true') {
    await heading.click()
  }

  await routines.getByRole('button', { name: 'New cron' }).click()
  const dialog = page.getByRole('dialog', { name: 'New cron job' })

  if (kind === 'schedule') {
    await dialog.getByPlaceholder('Morning briefing').fill('Morning routine')
    await dialog.getByPlaceholder(/Summarize my unread Slack threads/).fill('Prepare a morning summary.')
  } else {
    await dialog.getByPlaceholder('Morning briefing').fill('Release watch')
    await dialog.getByRole('button', { name: 'Tell me when' }).click()
    await dialog.getByPlaceholder('Tell the bot what change or event to watch for…').fill('A new release appears.')
  }

  await dialog.getByRole('button', { name: 'Create cron' }).click()
  await expect(dialog).toBeHidden()
}

test('computer timeline, checklist, and routines survive a window reload', async () => {
  test.setTimeout(360_000)
  const real = await bootReal('botpane-computer-reload')

  try {
    const { app, page, provider } = real
    const sockets = recordWebSockets(page)
    let canonicalSessionId = ''

    await test.step('create a bot, open its canonical chat, and run tools', async () => {
      await openBots(page)
      await createBot(page)
      canonicalSessionId = await openBotChat(page)

      provider.script(MARKER, [
        { toolCalls: [{ name: 'terminal', args: { command: 'echo ready' } }] },
        {
          toolCalls: [
            {
              name: 'tool_call',
              args: {
                calls: [
                  {
                    name: 'todo_list',
                    arguments: {
                      todos: [
                        { id: 'task-a', content: TODO_A, status: 'pending' },
                        { id: 'task-b', content: TODO_B, status: 'in_progress' }
                      ]
                    }
                  }
                ]
              }
            }
          ]
        },
        { text: ['The terminal is ready and the checklist is set.'] }
      ])
      await send(page, `${MARKER} Run echo ready and track the two tasks.`, 'Enter', sockets)
      await expect(page.getByText('The terminal is ready and the checklist is set.', { exact: true })).toBeVisible({
        timeout: 120_000
      })
      await expect.poll(() => provider.completions.filter(completion => completion.marker === MARKER).length).toBe(3)

      const timeline = await rpc<{
        steps: {
          detail: { command?: string; output_tail?: string }
          kind: string
          status: string
          title: string
          tool: string
        }[]
        todos: { content: string; status: string }[]
      }>(page, 'fork.computer.timeline', { profile: PROFILE, session_id: canonicalSessionId })

      expect(timeline.steps.some(step => step.kind === 'terminal' && step.detail.command === 'echo ready')).toBe(true)
      expect(timeline.steps.some(step => step.tool === 'tool_call')).toBe(true)
      expect(timeline.todos.map(({ content, status }) => ({ content, status }))).toEqual([
        { content: TODO_B, status: 'in_progress' },
        { content: TODO_A, status: 'pending' }
      ])
    })

    await test.step('inspect the computer timeline and checklist', async () => {
      await openBotPaneTab(page, 'bot')
      const timeline = page.getByTestId('bot-computer-timeline')
      await expect(timeline).toContainText('Ran echo ready')
      await timeline.scrollIntoViewIfNeeded()
      await shot(page, '4-botpane', '03-computer')

      await openBotPaneTab(page, 'activity')
      const checklist = page.getByTestId('bot-todo-checklist')
      await expect(checklist).toContainText(TODO_A)
      await expect(checklist).toContainText(TODO_B)
    })

    await test.step('create a schedule routine and a watch routine', async () => {
      await openBotPaneTab(page, 'scheduled')
      await createRoutine(page, 'schedule')
      await expect(page.getByTestId('routine-list')).toContainText('Morning routine')
      await createRoutine(page, 'watch')
      await expect(page.getByTestId('routine-list')).toContainText('Release watch')
      await shot(page, '4-botpane', '04-routines')
    })

    await test.step('reload the window and read the persisted state from UI and backend', async () => {
      const method = await reloadWindow(app, page)
      test.info().annotations.push({ type: 'reload', description: method })

      const timeline = await rpc<{
        steps: { detail: { command?: string }; id: string; kind: string; title: string }[]
        todos: { content: string; status: string }[]
      }>(page, 'fork.computer.timeline', { profile: PROFILE, session_id: canonicalSessionId })

      expect(timeline.steps.some(step => step.kind === 'terminal' && step.detail.command === 'echo ready')).toBe(true)
      expect(timeline.todos.map(({ content, status }) => ({ content, status }))).toEqual([
        { content: TODO_B, status: 'in_progress' },
        { content: TODO_A, status: 'pending' }
      ])

      const routines = await rpc<{
        routines: { condition?: string | null; kind: string; name: string }[]
      }>(page, 'fork.routines.list', { profile: PROFILE })

      expect(routines.routines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'schedule', name: 'Morning routine' }),
          expect.objectContaining({ condition: 'A new release appears.', kind: 'watch', name: 'Release watch' })
        ])
      )

      await openBots(page)
      await openBotPaneTab(page, 'bot')
      await expect(page.getByTestId('bot-computer-timeline')).toContainText('Ran echo ready')
      await page.getByRole('slider', { name: 'Replay history' }).press('ArrowLeft')
      await expect(
        page.getByTestId('computer-step-list').getByRole('button', { name: /Ran echo ready/ })
      ).toHaveAttribute('aria-current', 'step')

      await openBotPaneTab(page, 'activity')
      await expect(page.getByTestId('bot-todo-checklist')).toContainText(TODO_A)
      await expect(page.getByTestId('bot-todo-checklist')).toContainText(TODO_B)
      await openBotPaneTab(page, 'scheduled')
      await expect(page.getByTestId('routine-list')).toContainText('Morning routine')
      await expect(page.getByTestId('routine-list')).toContainText('Release watch')
      await shot(page, '4-botpane', '05-after-reload')
    })
  } finally {
    await real.close()
  }
})
