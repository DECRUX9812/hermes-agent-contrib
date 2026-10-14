/**
 * Sessions survive a window reload: one scripted reply, the sidebar row, the
 * plugin rail, the Advanced mode and the split layout are all still there after
 * Ctrl+R, each read back from the backend (persisted transcript, session.list)
 * and not from the window that was reloaded.
 */

import { expect, type Page, test } from '@playwright/test'

import { currentSessionId, persistedTranscript, recordWebSockets, send } from '../core/harness'

import { bootReal, railEntryKeys, reloadWindow, rpc, shot } from './reload-harness'

const nonce = Math.random()
  .toString(36)
  .slice(2, 8)
  .replace(/[^a-z0-9]/g, 'x')
  .padEnd(4, 'q')

const MARKER = `U1-${nonce}`
const PROMPT = 'Draft the weekly team update'
const REPLY = 'Weekly update drafted: three wins, two risks, one ask.'
const PLUGIN_PAGE = 'kanban:nav'

function viewport(page: Page) {
  return page.locator('[data-slot="aui_thread-viewport"]').filter({ visible: true })
}

async function openAppearanceSettings(page: Page) {
  await page.locator('[data-rail-entry="settings"]').click()
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('button', { name: 'Window & layout', exact: true }).click()
}

function modeOption(page: Page, label: string) {
  return page.locator('button[aria-pressed]').filter({ hasText: new RegExp(`^${label}$`) })
}

async function closeSettings(page: Page) {
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.locator('[data-overlay-surface]')).toHaveCount(0)
}

test('sessions survive a window reload: reply, sidebar row, plugin rail, mode and split', async () => {
  const real = await bootReal('sessions-reload')

  try {
    const { app, page, provider } = real
    const ws = recordWebSockets(page)
    let railBefore: string[] = []
    let sessionId = ''

    await test.step('switch to Advanced through the Settings control; plugin page in the rail', async () => {
      await openAppearanceSettings(page)
      await modeOption(page, 'Advanced').click()
      await closeSettings(page)
      await page.locator('[data-rail-entry="home"]').click()
      await expect.poll(() => railEntryKeys(page)).toContain(PLUGIN_PAGE)
      railBefore = await railEntryKeys(page)
      console.log(`[reload] rail before reload: ${railBefore.join(', ')}`)
    })

    await test.step('send a prompt; the scripted reply renders', async () => {
      provider.script(MARKER, [{ text: ['Weekly update drafted: ', 'three wins, two risks, one ask.'] }])
      await send(page, `${MARKER} ${PROMPT}`, 'Enter', ws)
      await expect
        .poll(() => provider.completions.some(c => c.marker === MARKER && c.finished), { timeout: 120_000 })
        .toBe(true)
      await expect(viewport(page)).toContainText(REPLY)
      sessionId = await currentSessionId(page)
      expect(sessionId).not.toBe('')
      await shot(page, '1-sessions', '01-chat')
    })

    await test.step('split the view into two panes', async () => {
      await page.keyboard.press('Control+Backslash')
      await expect(viewport(page)).toHaveCount(2)
      await shot(page, '1-sessions', '02-split')
    })

    await test.step('reload the window', async () => {
      const method = await reloadWindow(app, page)
      test.info().annotations.push({ type: 'reload', description: method })
    })

    await test.step('after reload: the reply renders exactly once, from the screen and from the backend', async () => {
      const replies = page.locator('[data-slot="aui_assistant-message-root"]').filter({ hasText: REPLY })
      await expect(replies).toHaveCount(1)

      const stored = await persistedTranscript(page, sessionId)
      expect(stored.filter(m => m.role === 'assistant' && m.content.includes(REPLY))).toHaveLength(1)
    })

    await test.step('after reload: the session is still in the sidebar and in session.list', async () => {
      await expect(page.locator('[data-slot="sidebar"] button').filter({ hasText: PROMPT }).first()).toBeVisible()
      const listed = await rpc<{ sessions: { id: string }[] }>(page, 'session.list', { limit: 50 })
      expect(listed.sessions.map(s => s.id)).toContain(sessionId)
    })

    await test.step('after reload: the rail entries are the ones recorded before it', async () => {
      expect(await railEntryKeys(page)).toEqual(railBefore)
    })

    await test.step('after reload: the split layout is restored', async () => {
      // The layout tree is persisted per interface mode (layout-persistence.ts: Advanced
      // keeps the bare `hermes.desktop.layoutTree.v2` key), so the second pane comes back.
      await expect(viewport(page)).toHaveCount(2)
      await shot(page, '1-sessions', '03-after-reload')
    })

    await test.step('after reload: still Advanced, read from the Settings control', async () => {
      await openAppearanceSettings(page)
      await expect(modeOption(page, 'Advanced')).toHaveAttribute('aria-pressed', 'true')
      await closeSettings(page)
    })
  } finally {
    await real.close()
  }
})
