import { expect, type Page, test } from '@playwright/test'

import { bootReal, reloadWindow, rpc, shot } from './reload-harness'

const PROFILE = 'pane-scout'
const DISPLAY_NAME = 'Field Scout'
const ROLE = 'Research lead'
const INSTRUCTIONS = 'Use concise, sourced answers.'
const MEMORY_INITIAL = 'The project ships on a monthly cadence.'
const MEMORY_EDITED = 'The project ships on a two-week cadence.'

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
    .poll(async () => {
      const result = await rpc<{ profiles: { name: string }[] }>(page, 'profiles.list')

      return result.profiles.some(profile => profile.name === PROFILE)
    }, { timeout: 60_000 })
    .toBe(true)
}

async function openBotTab(page: Page): Promise<void> {
  await page.locator(`[data-slot="bots-roster"] [data-roster-key="local::${PROFILE}"]`).click()

  const botTab = page.getByTestId('rail-tab:bot')

  if (!(await botTab.isVisible())) {
    const botContext = page.locator('[data-slot="pane-tab"][data-vertical="true"]').filter({ hasText: 'Bot context' })
    await expect(botContext).toBeVisible()
    await botContext.click()
  }

  await botTab.click()
  await expect(page.getByTestId('bot-identity-section')).toBeVisible()
  await expect(page.getByTestId('bot-memory-section')).toBeVisible()
}

async function editIdentity(page: Page): Promise<void> {
  const profile = page.getByTestId('bot-identity-section')

  await profile.getByRole('button', { name: /^Name:/ }).click()
  await profile.getByRole('textbox', { name: 'Name' }).fill(DISPLAY_NAME)
  await profile.getByRole('textbox', { name: 'Name' }).press('Enter')
  await expect(profile.getByRole('button', { name: `Name: ${DISPLAY_NAME}` })).toBeVisible()

  await profile.getByRole('button', { name: /^Role:/ }).click()
  await profile.getByRole('textbox', { name: 'Role' }).fill(ROLE)
  await profile.getByRole('textbox', { name: 'Role' }).press('Enter')
  await expect(profile.getByRole('button', { name: `Role: ${ROLE}` })).toBeVisible()

  await profile.getByRole('button', { name: 'Edit', exact: true }).click()
  await profile.getByRole('textbox', { name: 'Instructions' }).fill(INSTRUCTIONS)
  await profile.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(profile.getByText(INSTRUCTIONS)).toBeVisible()
}

async function addAndEditMemory(page: Page): Promise<void> {
  const memory = page.getByTestId('bot-memory-section')
  const group = memory.getByRole('heading', { name: 'What it remembers' }).locator('xpath=ancestor::section[1]')

  await group.getByRole('button', { name: 'Add', exact: true }).click()
  await group.getByRole('textbox', { name: 'Add What it remembers' }).fill(MEMORY_INITIAL)
  await group.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(group.getByText(MEMORY_INITIAL)).toBeVisible()

  await group.getByRole('button', { name: 'Edit What it remembers' }).click()
  await group.getByRole('textbox', { name: 'What it remembers' }).fill(MEMORY_EDITED)
  await group.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(group.getByText(MEMORY_EDITED)).toBeVisible()
}

test('bot identity and memory persist through a full window reload', async () => {
  test.setTimeout(360_000)
  const real = await bootReal('botpane-identity-reload')

  try {
    const { app, page } = real

    await test.step('create a bot and edit identity and memory in its Bot tab', async () => {
      await openBots(page)
      await createBot(page)
      await openBotTab(page)
      await editIdentity(page)
      await addAndEditMemory(page)
      await shot(page, '4-botpane', '01-identity')
    })

    await test.step('reload the window', async () => {
      const method = await reloadWindow(app, page)
      test.info().annotations.push({ type: 'reload', description: method })
    })

    await test.step('the pane and backend both return the edited values', async () => {
      await openBotTab(page)
      const profile = page.getByTestId('bot-identity-section')
      const memory = page.getByTestId('bot-memory-section')

      await expect(profile.getByRole('button', { name: `Name: ${DISPLAY_NAME}` })).toBeVisible()
      await expect(profile.getByRole('button', { name: `Role: ${ROLE}` })).toBeVisible()
      await expect(profile.getByText(INSTRUCTIONS)).toBeVisible()
      await expect(memory.getByText(MEMORY_EDITED)).toBeVisible()

      const identity = await rpc<{
        display_name: string
        instructions: string
        role: string
      }>(page, 'fork.bot.identity.get', { profile: PROFILE })

      expect(identity.display_name).toBe(DISPLAY_NAME)
      expect(identity.role).toBe(ROLE)
      expect(identity.instructions).toBe(INSTRUCTIONS)

      const memories = await rpc<{
        entries: { id: string; target: string; text: string }[]
      }>(page, 'fork.memory.list', { profile: PROFILE })

      expect(memories.entries).toContainEqual(expect.objectContaining({ target: 'memory', text: MEMORY_EDITED }))
      await shot(page, '4-botpane', '02-after-reload')
    })
  } finally {
    await real.close()
  }
})
