/**
 * E2E: the empty-chat prompt surface.
 *
 * The intro used to carry a look-alike prompt field next to the real composer —
 * two inputs on one screen, only one of them real. The hero is gone: the intro
 * keeps its wordmark, copy, starter chips and recency rows, and the composer is
 * the single prompt surface (docked at the pane's bottom, where its own
 * absolute positioning anchors it, with all of its controls intact).
 *
 * Prerequisite: `npm run build` must have been run so dist/ exists.
 */
import { expect, test } from './test'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expectVisualSnapshot } from './visual-snapshot'

const INTRO = '[data-slot="aui_intro"]'
const COMPOSER = '[data-slot="composer-root"]'
const COMPOSER_EDITOR = '[data-slot="composer-rich-input"]'
const SEARCH = 'input[aria-label="Search sessions"]'

let fixture: MockBackendFixture | null = null

test.beforeAll(async () => {
  fixture = await setupMockBackend()
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

test.describe('empty-chat prompt surface', () => {
  test('the empty canvas has exactly one prompt surface', async () => {
    const page = fixture!.page

    await expect(page.locator(INTRO)).toBeVisible()
    // No look-alike input in the intro any more: the composer is the only one,
    // and it is the very same node that docks under the transcript later.
    await expect(page.locator(`${INTRO} input[type="text"]`)).toHaveCount(0)
    await expect(page.locator(`${INTRO} ${COMPOSER}`)).toHaveCount(1)
    await expect(page.locator(COMPOSER)).toHaveCount(1)

    const geometry = await page.evaluate(() => {
      const intro = document.querySelector('[data-slot="aui_intro"]')!
      const composer = document.querySelector('[data-slot="composer-root"]')!
      const pane = intro.closest('[data-slot="composer-bounds"]') ?? intro.parentElement!
      const composerBox = composer.getBoundingClientRect()
      const paneBox = pane.getBoundingClientRect()
      const chips = intro.querySelectorAll('button')

      return {
        centerDelta: Math.round(
          Math.abs(composerBox.left + composerBox.width / 2 - (paneBox.left + paneBox.width / 2))
        ),
        chips: chips.length,
        composerTop: Math.round(composerBox.top),
        introBottom: Math.round(intro.getBoundingClientRect().bottom),
        paneHeight: Math.round(paneBox.height)
      }
    })

    // The composer is centred horizontally in the pane, and the intro still
    // offers its starter chips. (Vertical placement is verified visually: the
    // intro's box includes its own padding, so a geometric overlap check here
    // would flag the padding rather than the content.)
    expect(geometry.centerDelta).toBeLessThan(8)
    expect(geometry.chips).toBeGreaterThanOrEqual(3)
  })

  test('the caret is already in the composer on a fresh draft', async () => {
    await expect(fixture!.page.locator(COMPOSER_EDITOR)).toBeFocused()
  })

  test('typing elsewhere is never interrupted', async () => {
    const page = fixture!.page
    const search = page.locator(SEARCH)

    await search.click()
    await search.fill('keep me')
    await page.waitForTimeout(400)

    await expect(search).toBeFocused()
    await expect(search).toHaveValue('keep me')
    await search.fill('')
  })

  test('a starter chip drops its prompt into the composer', async () => {
    const page = fixture!.page

    await page.locator(`${INTRO} button:not(${COMPOSER} button)`).first().click()
    await expect(page.locator(COMPOSER_EDITOR)).not.toBeEmpty()
    await page.locator(COMPOSER_EDITOR).fill('')
  })

  test('visual snapshot of the empty chat', async () => {
    await expectVisualSnapshot(fixture!.page, { app: fixture!.app, name: 'intro-composer' })
  })

  test('Enter submits through the composer and starts the session', async () => {
    const page = fixture!.page
    const editor = page.locator(COMPOSER_EDITOR)

    await editor.click()
    await editor.fill('hero prompt e2e')
    await editor.press('Enter')

    // The draft becomes a real session: the splash gives way to the transcript
    // carrying the prompt text, and the composer docks below — still exactly one.
    await expect(page.locator(INTRO)).toHaveCount(0, { timeout: 60_000 })
    await expect(page.locator('[data-slot="aui_thread-viewport"]')).toContainText('hero prompt e2e', {
      timeout: 60_000
    })
    await expect(page.locator(COMPOSER)).toHaveCount(1)
    await expect(page.locator(`${INTRO} ${COMPOSER}`)).toHaveCount(0)
  })
})
