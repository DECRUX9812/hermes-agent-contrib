/**
 * A hosted room runs on the backend: the member turns are driven by the
 * gateway's own Discussion driver, so a round keeps going while no renderer is
 * attached. This lane reloads the window mid-turn with the room view unmounted,
 * then reads the round out of `groups.log` through RPC alone before it opens
 * the room again and checks that every reply renders exactly once.
 */

import { expect, type Page, test } from '@playwright/test'

import { gate } from '../core/provider'

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

interface RoomEvent {
  event_id: string
  kind: string
  payload: Record<string, unknown>
  seq: number
}

interface GroupsLog {
  cursor: number
  events: RoomEvent[]
  has_more: boolean
  latest_seq: number
}

function roomRow(page: Page) {
  return page.getByRole('button', { name: new RegExp(`^${GROUP}, 2 bots`) })
}

function composer(page: Page) {
  return page.getByRole('textbox', { name: `Message ${GROUP}` }).filter({ visible: true })
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
    .poll(
      async () => {
        const result = await rpc<{ profiles: { name: string }[] }>(page, 'profiles.list')

        return result.profiles.some(profile => profile.name === name)
      },
      { timeout: 60_000 }
    )
    .toBe(true)
}

async function createGroup(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New bot or group chat' }).click()
  await page.getByRole('menuitem', { name: /^New group chat$/i }).click()

  const dialog = page.getByRole('dialog', { name: /^New group chat$/i })

  for (const name of MEMBERS) {
    await dialog
      .getByText(name === 'atlas' ? 'Atlas' : 'Nova', { exact: true })
      .locator('xpath=ancestor::label')
      .getByRole('checkbox')
      .click()
  }

  await dialog.getByRole('textbox', { name: 'Group name' }).fill(GROUP)
  await dialog.getByRole('button', { name: 'Create Group (2)', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

/** The room the renderer created on the backend (idempotent `groups.create`). */
async function hostedRoomId(page: Page): Promise<string> {
  const result = await rpc<{ rooms: { name: string; room_id: string }[] }>(page, 'groups.list', { limit: 50 })
  const room = result.rooms.find(candidate => candidate.name === GROUP)

  if (!room) {
    throw new Error(`the backend hosts no room named ${GROUP}`)
  }

  return room.room_id
}

async function readLog(page: Page, roomId: string): Promise<GroupsLog> {
  return rpc<GroupsLog>(page, 'groups.log', { limit: 200, room_id: roomId, since_seq: 0 })
}

function memberReplies(log: GroupsLog): RoomEvent[] {
  return log.events.filter(
    event => event.kind === 'message.member' && String(event.payload.text ?? '').includes(REPLY)
  )
}

function settlements(log: GroupsLog): RoomEvent[] {
  return log.events.filter(event => event.kind === 'turn.settled')
}

async function assertRoomRendersRoundOnce(page: Page): Promise<void> {
  const replyRows = page.locator('[data-entry-index]').filter({ hasText: REPLY })

  await expect(replyRows).toHaveCount(2)
  const rendered = await replyRows.allTextContents()

  expect(rendered.filter(text => text.includes('Atlas'))).toHaveLength(1)
  expect(rendered.filter(text => text.includes('Nova'))).toHaveLength(1)
  await expect(page.locator('[data-slot="group-chat-message-content"]').filter({ hasText: PROMPT })).toHaveCount(1)
}

/**
 * A narrow room renders the members panel as a sheet: its scrim covers the whole
 * room (the header included), so it has to go before anything else is clickable.
 */
async function dismissRoomSheet(page: Page): Promise<void> {
  const sheet = page.getByTestId('group-room-sheet')

  if (await sheet.isVisible()) {
    await sheet.locator('xpath=preceding-sibling::div[1]').click({ position: { x: 4, y: 4 } })
    await expect(sheet).toBeHidden({ timeout: 30_000 })
  }
}

test('a hosted room keeps running on the backend through a window reload', async () => {
  test.setTimeout(360_000)
  const real = await bootReal('hosted-room-reload')

  try {
    const { app, page, provider } = real

    await test.step('create two real bot profiles and a hosted group room', async () => {
      await openBots(page)

      for (const name of MEMBERS) {
        await createBot(page, name)
      }

      await createGroup(page)

      const capabilities = await rpc<{ driver: boolean }>(page, 'groups.capabilities')

      expect(capabilities.driver, 'the backend runs the hosted-room driver').toBe(true)
      await expect(composer(page)).toBeVisible({ timeout: 30_000 })
    })

    await test.step('send one message and reload the window while the first member answers', async () => {
      const hold = gate()

      provider.script(MARKER, [{ holdAfterFirstChunk: hold, text: [REPLY] }])

      await composer(page).fill(`${MARKER} @all ${PROMPT}`)
      await composer(page).press('Enter')

      const roomId = await hostedRoomId(page)

      await expect
        .poll(async () => (await readLog(page, roomId)).events.some(event => event.kind === 'turn.started'), {
          timeout: 120_000
        })
        .toBe(true)
      await expect
        .poll(() => provider.completions.filter(completion => completion.marker === MARKER).length, {
          timeout: 120_000
        })
        .toBeGreaterThanOrEqual(1)

      // The turn is mid-stream and the room view is about to unmount: only the
      // backend can finish this round.
      const reloading = reloadWindow(app, page)

      hold.open()
      const method = await reloading

      test.info().annotations.push({ type: 'reload', description: method })
      await shot(page, '5-team', '01-reloaded-mid-turn')
    })

    await test.step('after the reload the round finishes without any renderer attached', async () => {
      const roomId = await hostedRoomId(page)

      await expect
        .poll(async () => memberReplies(await readLog(page, roomId)).length, { timeout: 180_000 })
        .toBe(2)
      await expect.poll(async () => settlements(await readLog(page, roomId)).length, { timeout: 180_000 }).toBe(2)

      const log = await readLog(page, roomId)
      const replies = memberReplies(log)
      const senders = replies.map(event => String(event.payload.member_id ?? ''))

      expect(new Set(senders).size, 'one reply per member').toBe(2)
      expect(log.events.length, 'every room event is in the log exactly once').toBe(
        new Set(log.events.map(event => event.event_id)).size
      )
      expect(
        log.events.filter(event => event.kind === 'message.user' && String(event.payload.text ?? '').includes(MARKER))
      ).toHaveLength(1)
    })

    await test.step('reopening the room renders the round it never saw started', async () => {
      if (!(await roomRow(page).isVisible())) {
        await openBots(page)
      }

      await roomRow(page).click()
      await expect(composer(page)).toBeVisible({ timeout: 30_000 })
      await assertRoomRendersRoundOnce(page)

      await page.getByRole('button', { name: 'Show members', exact: true }).click()

      const membersPanel = page.getByTestId('group-members-panel')

      await expect(membersPanel.getByText('Atlas', { exact: true })).toBeVisible()
      await expect(membersPanel.getByText('Nova', { exact: true })).toBeVisible()
      await shot(page, '5-team', '02-room-after-reload')

      // A narrow room renders the members panel as a sheet whose scrim covers the
      // header; dismiss it so the room can be left again.
      const sheet = page.getByTestId('group-room-sheet')

      if (await sheet.isVisible()) {
        await sheet.locator('xpath=preceding-sibling::div[1]').click({ position: { x: 4, y: 4 } })
        await expect(sheet).toBeHidden({ timeout: 30_000 })
      }
    })

    await test.step('closing the room view and reopening it replays the log once', async () => {
      await dismissRoomSheet(page)
      await page.locator('button[aria-label="Back"]:visible').first().click()
      await expect(composer(page)).toBeHidden({ timeout: 30_000 })

      const roomId = await hostedRoomId(page)

      await expect.poll(async () => settlements(await readLog(page, roomId)).length, { timeout: 60_000 }).toBe(2)

      await roomRow(page).click()
      await expect(composer(page)).toBeVisible({ timeout: 30_000 })
      await assertRoomRendersRoundOnce(page)
      await shot(page, '5-team', '03-room-reopened')
    })
  } finally {
    await real.close()
  }
})
