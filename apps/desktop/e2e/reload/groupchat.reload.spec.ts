/**
 * A group room survives a window reload: its roster and log hydrate from Bot
 * Mode storage, the member replies remain in their own profile sessions, and
 * the room's pinned state and quick filter restore from their real stores.
 */

import { expect, type Page, test } from '@playwright/test'

import { persistedTranscript } from '../core/harness'

import { bootReal, reloadWindow, rpc, shot } from './reload-harness'

const nonce = Math.random()
  .toString(36)
  .slice(2, 8)
  .replace(/[^a-z0-9]/g, 'x')
  .padEnd(4, 'q')

const MARKER = `U1-${nonce}`
const PROMPT = 'Check the launch plan.'
const REPLY = 'Launch checklist is ready for review.'
const GROUP = 'Launch crew'
const MEMBERS = ['atlas', 'nova'] as const

function roomRow(page: Page) {
  return page.getByRole('button', { name: new RegExp(`^${GROUP}, 2 bots`) })
}

function quickFilter(page: Page, label: string) {
  return page
    .locator('[data-slot="bots-roster"] button[aria-pressed]')
    .filter({ hasText: label })
    .filter({ visible: true })
}

async function openBots(page: Page): Promise<void> {
  const botsRailEntry = page.locator('[data-slot="activity-rail"] [data-rail-entry="hermes-bots:pane"]')

  await botsRailEntry.click()

  if (await page.getByRole('button', { name: 'Show sidebar', exact: true }).isVisible()) {
    await botsRailEntry.click()
  }

  await expect(page.getByRole('button', { name: 'New bot or group chat' })).toBeVisible()
}

async function createBot(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New bot or group chat' }).click()
  await page.getByRole('menuitem', { name: /^New bot$/i }).click()

  const dialog = page.getByRole('dialog', { name: /^New bot$/i })

  await dialog.getByRole('textbox', { name: 'Bot name' }).fill(name)
  await dialog.getByRole('button', { name: 'Create Bot', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })

  await expect
    .poll(async () => {
      const result = await rpc<{ profiles: { name: string }[] }>(page, 'profiles.list')

      return result.profiles.some(profile => profile.name === name)
    }, { timeout: 60_000 })
    .toBe(true)
}

async function createGroup(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New bot or group chat' }).click()
  await page.getByRole('menuitem', { name: /^New group chat$/i }).click()

  const dialog = page.getByRole('dialog', { name: /^New group chat$/i })

  for (const name of MEMBERS) {
    await dialog.getByText(name === 'atlas' ? 'Atlas' : 'Nova', { exact: true }).locator('xpath=ancestor::label').getByRole('checkbox').click()
  }

  await dialog.getByRole('textbox', { name: 'Group name' }).fill(GROUP)
  await dialog.getByRole('button', { name: 'Create Group (2)', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect(page.getByRole('textbox', { name: `Message ${GROUP}` }).filter({ visible: true })).toBeVisible({
    timeout: 30_000
  })
}

async function assertMemberReplies(page: Page): Promise<void> {
  const replyRows = page.locator('[data-entry-index]').filter({ hasText: REPLY })

  await expect(replyRows).toHaveCount(2)
  const rendered = await replyRows.allTextContents()

  expect(rendered.filter(text => text.includes('Atlas'))).toHaveLength(1)
  expect(rendered.filter(text => text.includes('Nova'))).toHaveLength(1)
}

test('group room, member replies, pin, and quick filter survive a window reload', async () => {
  test.setTimeout(360_000)
  const real = await bootReal('groupchat-reload')

  try {
    const { app, page, provider } = real

    await test.step('create two real bot profiles and a group room through the UI', async () => {
      await openBots(page)

      for (const name of MEMBERS) {
        await createBot(page, name)
      }

      await createGroup(page)
      await expect(roomRow(page)).toBeVisible()
    })

    await test.step('pin the room and send one message to both members', async () => {
      await roomRow(page).click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Pin to top', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Pinned 1', exact: true })).toBeVisible()

      provider.script(MARKER, [{ text: [REPLY] }])
      const composer = page.getByRole('textbox', { name: `Message ${GROUP}` }).filter({ visible: true })

      await composer.fill(`${MARKER} ${PROMPT}`)
      await composer.press('Enter')

      await expect
        .poll(
          () => provider.completions.filter(completion => completion.marker === MARKER && completion.finished).length,
          { timeout: 120_000 }
        )
        .toBeGreaterThanOrEqual(2)
      await expect(page.locator('[data-slot="group-chat-message-content"]').filter({ hasText: PROMPT })).toHaveCount(1)
      await assertMemberReplies(page)
      await expect(page.getByRole('button', { name: 'Stop all', exact: true })).toHaveCount(0)

      await page.getByRole('button', { name: 'Show members', exact: true }).click()
      const membersPanel = page.getByTestId('group-members-panel')

      await expect(membersPanel.getByText('Atlas', { exact: true })).toBeVisible()
      await expect(membersPanel.getByText('Nova', { exact: true })).toBeVisible()
      await shot(page, '2-groupchat', '01-room')
    })

    await test.step('switch the room-list quick filter away from its default', async () => {
      await quickFilter(page, 'Unread').click()
      await expect(quickFilter(page, 'Unread')).toHaveAttribute('aria-pressed', 'true')
    })

    await test.step('reload the window', async () => {
      const method = await reloadWindow(app, page)
      test.info().annotations.push({ type: 'reload', description: method })
    })

    await test.step('after reload: the profile records still exist and the quick filter restores', async () => {
      await openBots(page)
      const profiles = await rpc<{ profiles: { name: string }[] }>(page, 'profiles.list')

      for (const name of MEMBERS) {
        expect(profiles.profiles.map(profile => profile.name)).toContain(name)
      }

      await expect(quickFilter(page, 'Unread')).toHaveAttribute('aria-pressed', 'true')
    })

    await test.step('after reload: the pinned room is in the room list with both members', async () => {
      // Unread is a per-viewer filter and intentionally hides read rooms;
      // assert its restoration above, then clear the filter to inspect the
      // persisted room roster.
      await quickFilter(page, 'All').click()
      await expect(quickFilter(page, 'All')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('button', { name: 'Pinned 1', exact: true })).toBeVisible()
      await expect(roomRow(page)).toBeVisible()

      await roomRow(page).click()
      await expect(page.getByRole('textbox', { name: `Message ${GROUP}` }).filter({ visible: true })).toBeVisible()
      await page.getByRole('button', { name: 'Show members', exact: true }).click()

      const membersPanel = page.getByTestId('group-members-panel')

      await expect(membersPanel.getByText('Atlas', { exact: true })).toBeVisible()
      await expect(membersPanel.getByText('Nova', { exact: true })).toBeVisible()
    })

    await test.step('after reload: each member transcript and the room screen contain one copy', async () => {
      const memberSessions = await Promise.all(
        MEMBERS.map(async profile => {
          const result = await rpc<{ sessions: { id: string; title: string }[] }>(page, 'session.list', {
            include_hidden: true,
            limit: 100,
            profile
          })

          const groupSessions = result.sessions.filter(session => session.title.startsWith('Group:'))

          expect(groupSessions, `${profile} has the room's stored member session`).toHaveLength(1)

          return {
            profile,
            transcript: await persistedTranscript(page, groupSessions[0].id, profile)
          }
        })
      )

      for (const member of memberSessions) {
        expect(
          member.transcript.filter(message => message.role === 'assistant' && message.content.includes(REPLY)),
          `${member.profile}'s backend transcript`
        ).toHaveLength(1)
      }

      await expect(page.locator('[data-slot="group-chat-message-content"]').filter({ hasText: PROMPT })).toHaveCount(1)
      await assertMemberReplies(page)
      await shot(page, '6-design', '02-room-members-open')
      await shot(page, '2-groupchat', '02-after-reload')
    })
  } finally {
    await real.close()
  }
})
