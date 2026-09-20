/**
 * E2E: the empty-chat hero prompt.
 *
 * The intro splash's primary affordance is a real prompt field: it takes the
 * caret on a fresh draft, submits through the composer's own bus (the draft
 * becomes a session exactly as if typed into the composer), releases the caret
 * on Escape, and never yanks focus the user placed elsewhere.
 *
 * The hero, the starter chips and the recency rows also share one column:
 * `[data-slot='aui_intro'] > div` in styles.css pins direct children to the
 * composer width, so a `max-w-*` on a direct child silently resolves to 100%.
 * The column wrapper keeps them equal — checked below so it cannot regress.
 *
 * Prerequisite: `npm run build` must have been run so dist/ exists.
 */
import { expect, test } from './test'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expectVisualSnapshot } from './visual-snapshot'

const HERO_INPUT = '[data-slot="aui_intro"] input[type="text"]'
const HERO_SEND = '[data-slot="aui_intro"] form button[type="submit"]'
const INTRO = '[data-slot="aui_intro"]'
const SEARCH = 'input[aria-label="Search sessions"]'

let fixture: MockBackendFixture | null = null

test.beforeAll(async () => {
  fixture = await setupMockBackend()
  await waitForAppReady(fixture.page)
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

test.describe('empty-chat hero prompt', () => {
  test('lands in one column with the caret already in the field', async () => {
    const page = fixture!.page
    const hero = page.locator(HERO_INPUT)

    await expect(hero).toBeVisible()
    await expect(hero).toBeFocused()

    const widths = await page.evaluate(() => {
      const form = document.querySelector('[data-slot="aui_intro"] form')
      const column = form?.parentElement
      const width = (el: Element | null | undefined) => (el ? Math.round(el.getBoundingClientRect().width) : -1)

      return { column: width(column), form: width(form) }
    })

    // The form fills the column, and the column itself is a bounded column
    // rather than the full composer width.
    expect(widths.form).toBe(widths.column)
    expect(widths.column).toBeGreaterThan(420)
    expect(widths.column).toBeLessThanOrEqual(600)
  })

  test('send stays disabled until there is something to send', async () => {
    const page = fixture!.page
    const hero = page.locator(HERO_INPUT)
    const send = page.locator(HERO_SEND)

    await expect(send).toBeDisabled()
    await hero.fill('draft text')
    await expect(send).toBeEnabled()
    await hero.fill('')
  })

  test('Escape releases the caret', async () => {
    const page = fixture!.page
    const hero = page.locator(HERO_INPUT)

    await hero.click()
    await expect(hero).toBeFocused()
    await hero.press('Escape')
    await expect(hero).not.toBeFocused()
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

    await page.locator(`${INTRO} button:not(form button)`).first().click()
    await expect(page.locator('[data-slot="composer-rich-input"]')).not.toBeEmpty()
  })

  test('visual snapshot of the empty chat', async () => {
    await expectVisualSnapshot(fixture!.page, { app: fixture!.app, name: 'intro-hero' })
  })

  test('Enter submits through the composer and starts the session', async () => {
    const page = fixture!.page
    const composer = page.locator('[data-slot="composer-rich-input"]')

    await composer.fill('')
    await page.locator(HERO_INPUT).fill('hero prompt e2e')
    await page.locator(HERO_INPUT).press('Enter')

    // The draft becomes a real session: the splash gives way to the transcript
    // carrying the prompt text.
    await expect(page.locator(INTRO)).toHaveCount(0)
    await expect(page.locator('[data-slot="aui_thread-viewport"]')).toContainText('hero prompt e2e', {
      timeout: 60_000,
    })
  })
})
