/**
 * QA for the isolated component fixture, NOT a live gateway or Electron E2E.
 * Start npm run dev:renderer, then node scripts/refinement-preview-qa.mjs.
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from '@playwright/test'

const url = process.env.HERMES_REVIEW_URL || 'http://127.0.0.1:5174/refinement-preview.html'
const output = resolve(process.env.HERMES_REVIEW_OUTPUT || 'build/refinement-review')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chromium' })

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('button', { name: 'New team', exact: true }).waitFor()
  assert.match(await page.locator('body').innerText(), /Fixture data · No live agent connection/)
  await page.screenshot({ path: resolve(output, 'desktop-light.png'), fullPage: true })
  await page.getByRole('button', { name: 'Dark appearance', exact: true }).click()
  await page.screenshot({ path: resolve(output, 'desktop-dark.png'), fullPage: true })

  const activity = page.getByRole('tab', { name: 'Activity', exact: true })
  await activity.focus()
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.locator(':focus').textContent(), 'Scheduled')
  assert.equal(await page.locator(':focus').getAttribute('aria-selected'), 'true')
  await page.keyboard.press('End')
  assert.equal(await page.locator(':focus').textContent(), 'Bot')
  await page.keyboard.press('Home')
  assert.equal(await page.locator(':focus').textContent(), 'Activity')
  assert.equal(await page.locator('[role=tab][tabindex="0"]').count(), 1)

  for (const name of ['Approvals', 'Scheduled', 'Bot', 'Activity']) {
    await page.getByRole('tab', { name, exact: true }).click()
    assert.equal(await page.getByRole('tabpanel').count(), 1)
  }

  assert.match(await page.getByTestId('work-now').innerText(), /Step 3 of 5/)
  await page.screenshot({ path: resolve(output, 'work-board.png'), clip: { x: 1040, y: 0, width: 400, height: 960 } })
  await page.getByTestId('work-now').getByRole('button', { name: 'Watch', exact: true }).click()
  assert.match(await page.getByRole('dialog').innerText(), /npm run typecheck/)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)

  await page.getByRole('button', { name: 'Delete team', exact: true }).click()
  assert.match(await page.getByRole('dialog').innerText(), /bots and their conversations are kept/)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.getByText('Desktop studio', { exact: true }).count(), 1)

  await page.getByRole('button', { name: 'New team', exact: true }).click()
  assert.match(await page.getByRole('dialog').innerText(), /Team name/)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByRole('button', { name: 'Approve', exact: true }).waitFor({ state: 'hidden' })

  for (const width of [1440, 800, 375]) {
    await page.setViewportSize({ width, height: 960 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    assert.equal(overflow, false, `Page overflow at ${width}px`)
    await page.screenshot({ path: resolve(output, `desktop-${width}.png`), fullPage: true })
    if (width === 375) {
      await page.getByRole('tab', { name: 'Activity', exact: true }).scrollIntoViewIfNeeded()
      const tabBox = await page.getByRole('tab', { name: 'Activity', exact: true }).boundingBox()
      assert.ok(tabBox && tabBox.y >= 0 && tabBox.y + tabBox.height <= 960, 'Compact rail must be reachable')
      await page.screenshot({ path: resolve(output, 'desktop-375-rail.png'), fullPage: true })
    }
  }
  assert.deepEqual(errors, [])
  console.log('PASS: fixture disclosure, light/dark, four tabs, keyboard navigation, task details,')
  console.log('delete cancellation, create dialog, fixture approval, 1440/800/375px and zero page errors.')
  console.log(`Screenshots: ${output}`)
} finally {
  await browser.close()
}
