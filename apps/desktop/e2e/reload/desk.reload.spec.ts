/**
 * The Desk page against the real backend. The e2e sandbox venv does NOT have
 * the hermes-office plugin installed, so what is real there is the plugin's
 * desktop half and its honest empty state:
 *
 *  - the Desk rail entry (briefcase) is on the plugin rail;
 *  - clicking it opens `/desk`;
 *  - with no hermes-office backend the page shows the needs-the-plugin state —
 *    not a crash, and never mock folders or workstreams;
 *  - after a full window reload the rail entry and the open page are identical.
 */

import { expect, test } from '@playwright/test'

import { composer } from '../core/harness'

import { bootReal, railEntryKeys, reloadWindow, shot } from './reload-harness'

const DESK_RAIL_ENTRY = 'hermes-office:nav'
const UNAVAILABLE_TITLE = 'Desk needs the hermes-office plugin'

test('the Desk rail entry opens an honest page that survives a reload', async () => {
  test.setTimeout(300_000)
  const real = await bootReal('desk-reload')

  try {
    const { app, page } = real
    let railBefore: string[] = []

    await test.step('the Desk rail entry is on the plugin rail', async () => {
      await expect.poll(() => railEntryKeys(page)).toContain(DESK_RAIL_ENTRY)
      railBefore = await railEntryKeys(page)
    })

    await test.step('clicking the briefcase opens /desk with the needs-the-plugin state', async () => {
      await page.locator(`[data-rail-entry="${DESK_RAIL_ENTRY}"]`).click()

      await expect(page).toHaveURL(/\/desk$/)
      await expect(page.locator('[data-slot="desk-unavailable"]')).toContainText(UNAVAILABLE_TITLE, {
        timeout: 30_000
      })

      // The honest state paints no fake data.
      await expect(page.locator('[data-slot="desk-page"]')).toHaveCount(0)
      await shot(page, '6-desk', '01-desk-unavailable')
    })

    await test.step('reload the window (from home; plugin pages mount no composer for the harness to wait on)', async () => {
      await page.locator('[data-rail-entry="home"]').click()
      await composer(page).waitFor({ state: 'visible' })

      const method = await reloadWindow(app, page)
      test.info().annotations.push({ type: 'reload', description: method })
    })

    await test.step('after reload: the same rail entry, the same open page', async () => {
      await expect.poll(() => railEntryKeys(page)).toEqual(railBefore)

      await page.locator(`[data-rail-entry="${DESK_RAIL_ENTRY}"]`).click()
      await expect(page).toHaveURL(/\/desk$/)
      await expect(page.locator('[data-slot="desk-unavailable"]')).toContainText(UNAVAILABLE_TITLE, {
        timeout: 30_000
      })
      await shot(page, '6-desk', '02-desk-after-reload')
    })
  } finally {
    await real.close()
  }
})
