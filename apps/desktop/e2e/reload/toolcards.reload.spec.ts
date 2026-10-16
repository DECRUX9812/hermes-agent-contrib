import { expect, test } from '@playwright/test'

import { currentSessionId, recordWebSockets, send } from '../core/harness'
import { gate } from '../core/provider'

import { bootReal, reloadWindow, shot } from './reload-harness'

const marker = `U1-${Math.random().toString(36).slice(2, 8)}`
const finalText = 'Both checks completed.'

test('tool pills fold after completion, keep the scroll anchor, and reopen after reload', async () => {
  test.setTimeout(300_000)
  const real = await bootReal('toolcards-reload')

  try {
    const { app, page, provider } = real
    const websockets = recordWebSockets(page)
    const finish = gate()

    const setupMarker = 'U0-toolcards'
    provider.script(setupMarker, [
      {
        text: [
          Array.from({ length: 25 }, (_, i) => `Prior message line ${i} establishes sufficient transcript height to test scroll anchoring.`).join('\n\n')
        ]
      }
    ])
    await send(page, `${setupMarker} setup height`, 'Enter', websockets)
    await expect
      .poll(() => provider.completions.filter(item => item.marker === setupMarker).length, { timeout: 60_000 })
      .toBe(1)

    provider.script(marker, [
      {
        text: ['Checking two paths.'],
        toolCalls: [
          { name: 'terminal', args: { command: "printf 'toolcards-alpha'" } },
          { name: 'terminal', args: { command: "printf 'toolcards-beta'" } }
        ]
      },
      { text: [finalText], holdAfterFirstChunk: finish }
    ])

    await send(page, `${marker} Run two harmless checks and report when both finish.`, 'Enter', websockets)
    await expect
      .poll(() => provider.completions.filter(item => item.marker === marker).length, { timeout: 120_000 })
      .toBe(2)
    await expect(page.locator('[data-tool-step="done"]')).toHaveCount(2, { timeout: 120_000 })

    const viewport = page.locator('[data-slot="aui_thread-viewport"]')
    await viewport.evaluate(element => {
      const scroller = element as HTMLElement
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 160)
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await expect(viewport).toHaveAttribute('data-following', 'false')

    // Scoped to the transcript: the sessions row previews this same sentence as
    // soon as the turn seals, and an unscoped `.first()` is that row by DOM
    // order — it would measure the sidebar, not the answer under the pills.
    const anchor = viewport.getByText(finalText, { exact: true }).first()
    await expect(anchor).toBeVisible()
    const before = await anchor.evaluate(element => element.getBoundingClientRect().top)
    await shot(page, '3-toolcards', '01-live-pills')

    finish.open()
    await expect(page.getByRole('button', { name: 'Used 2 tools' })).toBeVisible()
    const after = await anchor.evaluate(element => element.getBoundingClientRect().top)
    expect(Math.abs(after - before)).toBeLessThanOrEqual(35)
    await shot(page, '3-toolcards', '02-folded-run')

    expect(await currentSessionId(page)).toBeTruthy()
    await expect(page.locator('[data-tool-step-pane]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Used 2 tools' }).click()
    await page.locator('[data-tool-step]').first().click()
    await expect(page.locator('[data-tool-step-pane]')).toBeVisible()
    await expect(page.locator('[data-tool-step-pane]')).toContainText('printf')
    await shot(page, '3-toolcards', '03-step-view')

    const method = await reloadWindow(app, page)
    test.info().annotations.push({ type: 'reload', description: method })
    await expect(page.getByRole('button', { name: 'Used 2 tools' })).toBeVisible()
    await expect(page.locator('[data-tool-step-pane]')).toHaveCount(0)
    await shot(page, '3-toolcards', '04-after-reload')
  } finally {
    await real.close()
  }
})
