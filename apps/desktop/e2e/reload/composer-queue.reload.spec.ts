/**
 * A follow-up sent while the bot's run is still going stays visible as a pill
 * next to the composer (the drawer that lists the queue is collapsed by
 * default), and it is never lost across a window reload: the queue is persisted
 * per conversation, so the follow-up is either still pending on the composer or
 * already handed to the run. Only the LLM is scripted; Electron and the gateway
 * are real.
 */

import { expect, type Page, test } from '@playwright/test'

import { currentSessionId, persistedTranscript, recordWebSockets, send } from '../core/harness'
import { gate } from '../core/provider'

import { bootReal, reloadWindow, rpc, shot } from './reload-harness'

const PROFILE = 'queue-scout'
const nonce = Math.random().toString(36).slice(2, 8)
const U = (step: number) => `U${step}-${nonce}`
const A = (step: number) => `A${step}-${nonce}`

const FIRST_TEXT = `${U(1)} summarize the release checklist`
const SECOND_TEXT = `${U(2)} also check the release notes`
const SECOND_REPLY = `${A(2)} the release notes look right`

const firstLine = (index: number) =>
  `${U(1)} transcript line ${index} gives the thread enough height to measure the scroll anchor.`

const longRunText = Array.from({ length: 25 }, (_, i) => firstLine(i + 1)).join('\n\n')

function queuedPills(page: Page) {
  return page.locator('[data-slot="composer-queued-pills"]')
}

/** The follow-up as stored transcript rows — independent of virtualized paint. */
async function storedFollowUps(page: Page): Promise<number> {
  const rows = await persistedTranscript(page, await currentSessionId(page), PROFILE)

  return rows.filter(row => row.role === 'user' && row.content.includes(U(2))).length
}

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

  const roster = await rpc<{
    profiles: { canonical_session?: { id?: string; resolved_id?: string } | null; name: string }[]
  }>(page, 'profiles.list')

  const canonical = roster.profiles.find(item => item.name === PROFILE)?.canonical_session
  const sessionId = canonical?.resolved_id || canonical?.id || ''

  expect(sessionId).not.toBe('')
  await expect.poll(() => currentSessionId(page)).toBe(sessionId)

  return sessionId
}

test('a queued follow-up stays visible while the bot runs and is never lost on reload', async () => {
  test.setTimeout(420_000)
  const real = await bootReal('composer-queue-reload')

  try {
    const { app, page, provider } = real
    const sockets = recordWebSockets(page)
    const finish = gate()

    await test.step('queue a follow-up while the bot is mid-run', async () => {
      await openBots(page)
      await createBot(page)
      await openBotChat(page)

      // A new bot chat opens with its intro turn; send behind it, never into it.
      await expect(
        page.locator(`[data-slot="bots-roster"] [data-roster-key="local::${PROFILE}"]`).getByRole('status')
      ).toHaveCount(0, { timeout: 180_000 })

      // The first turn stays open for the whole test: the run is still
      // producing when the follow-up is queued and when the window reloads.
      provider.script(U(1), [{ text: [longRunText], holdAfterFirstChunk: finish }])
      provider.script(U(2), [{ text: [SECOND_REPLY] }])

      await send(page, FIRST_TEXT, 'Enter', sockets)
      await expect(page.getByText(firstLine(1))).toBeVisible({ timeout: 120_000 })
      await expect(page.getByText(firstLine(25))).toBeVisible({ timeout: 120_000 })

      // Read the thread from above the fold, so a pill that grew the dock would
      // show up as a jump rather than hide under the composer.
      const viewport = page.locator('[data-slot="aui_thread-viewport"]')

      await viewport.evaluate(element => {
        const scroller = element as HTMLElement

        scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 200)
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      })
      await expect(viewport).toHaveAttribute('data-following', 'false')

      const anchor = page.getByText(firstLine(1)).first()

      await expect(anchor).toBeVisible()

      const before = await anchor.evaluate(element => element.getBoundingClientRect().top)

      // Control+Enter queues behind the run; plain Enter would redirect it.
      await send(page, SECOND_TEXT, 'Control+Enter', sockets)

      await expect(queuedPills(page)).toContainText(SECOND_TEXT, { timeout: 60_000 })
      await expect(page.locator('[data-slot="queued-pill"]')).toHaveCount(1)
      await expect(page.getByText('Operation interrupted', { exact: false })).toHaveCount(0)
      expect(await storedFollowUps(page)).toBe(0)

      const after = await anchor.evaluate(element => element.getBoundingClientRect().top)

      expect(Math.abs(after - before)).toBeLessThanOrEqual(35)
      await shot(page, '4-botpane', 'queue-pill-while-running')
    })

    await test.step('the queued follow-up is still pending after a window reload', async () => {
      const method = await reloadWindow(app, page)

      test.info().annotations.push({ type: 'reload', description: method })

      // The first turn is still held on the backend, so the fresh window has to
      // read that run as live and keep the follow-up queued. Handing it to the
      // run here is the bug: the reconnect retired every busy claim, the session
      // list left its loading state, and the drain fired into a turn that was
      // still going — one that emits no delta to re-assert itself.
      const landed = async () => `${await queuedPills(page).count()}-${await storedFollowUps(page)}`

      await expect.poll(landed, { timeout: 120_000 }).toBe('1-0')

      // And it stays queued: past the drain's retry interval, which is when a
      // reconnect that read the run as idle would have submitted it.
      await page.waitForTimeout(2_000)
      expect(await landed()).toBe('1-0')
      expect(provider.completions.filter(item => item.marker === U(2))).toHaveLength(0)

      test.info().annotations.push({ type: 'queued-after-reload', description: await landed() })
      await shot(page, '4-botpane', 'queue-pill-after-reload')
    })

    await test.step('finishing the run delivers the queue exactly once', async () => {
      finish.open()

      // Whatever the fresh window chose, the end state is the same: the
      // follow-up ran once, its reply rendered once, and the first turn's
      // streamed answer is neither lost nor duplicated.
      await expect.poll(() => storedFollowUps(page), { timeout: 180_000 }).toBe(1)
      await expect(page.getByText(SECOND_REPLY, { exact: true })).toHaveCount(1, { timeout: 180_000 })
      await expect(queuedPills(page)).toHaveCount(0)
      await expect(page.getByText(firstLine(25))).toHaveCount(1)
      await expect(page.getByText('Operation interrupted', { exact: false })).toHaveCount(0)
      await expect.poll(() => provider.completions.filter(item => item.marker === U(2)).length).toBe(1)
      await shot(page, '4-botpane', 'queue-pill-drained')
    })
  } finally {
    await real.close()
  }
})
