import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { expect, test } from '@playwright/test'

import { currentSessionId, recordWebSockets, send } from '../core/harness'

import { bootReal, reloadWindow, shot } from './reload-harness'

/**
 * Ambition mode on the REAL backend, with the REAL hermes-ambition plugin
 * installed into the sandbox HERMES_HOME (cloned into plugins/ and enabled
 * through the config allow-list — the same state `hermes plugins adopt` +
 * `hermes plugins enable` produce; the plugin declares no dependencies).
 * The LLM is the lane's only fake (the scripted provider): it plays the
 * agent calling the plugin's REAL tools, which run against the plugin's
 * REAL store — the chip, the card edits and the mode all persist in it.
 *
 * The pillar gate: chip ON → card proposed → target edited → accepted →
 * full window reload → chip still ON, the card still shows the EDITED
 * target as accepted, and the judge result chip is visible.
 */

const SOURCE_DIR = process.env.HERMES_AMBITION_SOURCE ?? path.join(os.homedir(), 'Code', 'hermes-ambition')

/** Neutral demo values only (repo privacy rule). */
const CARD_ID = 'card-ambition-e2e-1'

const DEMO_FIELDS = {
  altitude: 'Make the demo workspace self-checking after every batch run.',
  depth: 'Start from the sample queue fixtures and the two starter scripts.',
  judge: 'The outside checklist script shipped with the demo project.',
  range: 'Wire the checker into the batch runner the crew reviews weekly.',
  target: '24 demo batches checked'
}

const setupMarker = 'U0-ambition'
const marker = `U1-${Math.random().toString(36).slice(2, 8)}`
const finalText = 'The card is accepted and the judge recorded the result.'

const installPlugin = (hermesHome: string) => {
  if (!fs.existsSync(path.join(SOURCE_DIR, 'plugin.yaml'))) {
    throw new Error(`ambition plugin source not found at ${SOURCE_DIR} (set HERMES_AMBITION_SOURCE)`)
  }

  // The clone-equivalent: the plugin directory (with its git dir, as a clone
  // carries) under the user plugins root, plus the enable allow-list — the
  // config state `hermes plugins enable ambition` writes.
  fs.mkdirSync(path.join(hermesHome, 'plugins'), { recursive: true })
  fs.cpSync(SOURCE_DIR, path.join(hermesHome, 'plugins', 'ambition'), { recursive: true })

  const configPath = path.join(hermesHome, 'config.yaml')
  fs.writeFileSync(configPath, `${fs.readFileSync(configPath, 'utf8')}\nplugins:\n  enabled:\n    - ambition\n`)
}

test('ambition card survives an edit, an accept and a full reload', async () => {
  test.setTimeout(600_000)
  const real = await bootReal('ambition-reload', { setupHome: installPlugin })

  try {
    const { app, page, provider } = real
    const websockets = recordWebSockets(page)

    // Turn 1: create the real session the chip scopes to.
    provider.script(setupMarker, [{ text: ['Ready for the ambition demo.'] }])
    await send(page, `${setupMarker} Say you are ready.`, 'Enter', websockets)
    await expect
      .poll(() => provider.completions.filter(item => item.marker === setupMarker).length, { timeout: 120_000 })
      .toBe(1)

    // The chip appears once a session exists; OFF until the backend says on.
    const chip = page.locator('[data-slot="ambition-chip"]')

    await expect(chip).toBeVisible()
    await expect(chip).toHaveAttribute('data-state', 'off')

    // Enable through the chip: the optimistic paint IS the backend mode PUT.
    await chip.click()
    await expect(chip).toHaveAttribute('data-state', 'on', { timeout: 30_000 })
    await shot(page, '7-ambition', '01-chip-on')

    // Turn 2: the real flow for a deferred plugin tool — the tool_search
    // bridge surfaces it, then the plugin's REAL tools execute against the
    // plugin's REAL store (the LLM is the lane's only fake).
    provider.script(marker, [
      { toolCalls: [{ name: 'tool_search', args: { queries: ['ambition card plan', 'ambition judge verdict'] } }] },
      { toolCalls: [{ name: 'tool_describe', args: { names: ['ambition_card', 'ambition_judge'] } }] },
      {
        text: ['Drafting an ambition card for this ask.'],
        toolCalls: [
          {
            name: 'tool_call',
            args: {
              calls: [{ name: 'ambition_card', arguments: { ...DEMO_FIELDS, card_id: CARD_ID, widens_scope: false } }]
            }
          }
        ]
      },
      {
        toolCalls: [
          {
            name: 'tool_call',
            args: {
              calls: [
                {
                  name: 'ambition_judge',
                  arguments: {
                    card_id: CARD_ID,
                    evidence: 'checklist output: 24 of 24 demo batches checked by the outside script',
                    judge: 'outside checklist script',
                    measured: '24 demo batches',
                    verdict: 'pass'
                  }
                }
              ]
            }
          }
        ]
      },
      { text: [finalText] }
    ])

    await send(page, `${marker} Plan and finish the demo batch review.`, 'Enter', websockets)
    // The turn must run to completion: the card and judge chips draw the
    // SETTLED tool calls, so the assertions below poll the finished turn.
    await expect
      .poll(() => provider.completions.filter(item => item.marker === marker && item.finished).length, {
        timeout: 180_000
      })
      .toBe(5)

    const card = page.locator('[data-slot="ambition-card"]')

    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('data-ambition-status', 'proposed')

    // The five labelled fields render, each editable inline.
    for (const field of ['altitude', 'depth', 'range', 'target', 'judge']) {
      await expect(card.locator(`[data-ambition-field="${field}"] textarea`)).toBeVisible()
    }

    await shot(page, '7-ambition', '02-card-proposed')

    // Edit Target inline → the edit PATCHes the real card.
    const target = card.locator('[data-ambition-field="target"] textarea')
    await target.fill('30 demo batches checked')
    await target.press('Tab')
    await expect(card).toHaveAttribute('data-ambition-status', 'edited', { timeout: 30_000 })
    await expect(card.locator('[data-ambition-field="target"] textarea')).toHaveValue('30 demo batches checked')
    await shot(page, '7-ambition', '03-card-edited')

    // Accept → the card folds to one line carrying the edited target.
    await card.locator('[data-slot="ambition-accept"]').click()
    const folded = page.locator('[data-slot="ambition-card-folded"]')

    await expect(folded).toBeVisible({ timeout: 30_000 })
    await expect(folded).toHaveAttribute('data-ambition-status', 'accepted')
    await expect(folded).toContainText('30 demo batches checked')

    // The judge chip shows Target vs Measured with the verdict mark.
    const judge = page.locator('[data-slot="ambition-judge"]')

    await expect(judge).toBeVisible()
    await expect(judge).toHaveAttribute('data-verdict', 'pass')
    await expect(judge.locator('[data-slot="ambition-judge-target"]')).toContainText('24 demo batches')
    await expect(judge.locator('[data-slot="ambition-judge-measured"]')).toContainText('24 demo batches')
    await expect(page.getByText('outside checklist script')).toBeVisible()

    // The Target was edited AFTER the verdict, so the chip keeps the value the
    // judge was handed and names the one the card carries now — a verdict can
    // never be read against a target it was not measured against.
    await expect(judge.locator('[data-slot="ambition-judge-target-edited"]')).toContainText(
      '30 demo batches checked'
    )

    expect(await currentSessionId(page)).toBeTruthy()

    // ── The pillar gate: everything above survives a full window reload. ──
    const method = await reloadWindow(app, page)
    test.info().annotations.push({ type: 'reload', description: method })

    await expect(page.locator('[data-slot="ambition-chip"]')).toBeVisible()
    await expect(page.locator('[data-slot="ambition-chip"]')).toHaveAttribute('data-state', 'on')

    const reloadedCard = page.locator('[data-slot="ambition-card-folded"]')

    await expect(reloadedCard).toBeVisible()
    await expect(reloadedCard).toHaveAttribute('data-ambition-status', 'accepted')
    await expect(reloadedCard).toContainText('30 demo batches checked')

    const reloadedJudge = page.locator('[data-slot="ambition-judge"]')

    await expect(reloadedJudge).toBeVisible()
    await expect(reloadedJudge).toHaveAttribute('data-verdict', 'pass')
    await expect(reloadedJudge.locator('[data-slot="ambition-judge-target"]')).toContainText('24 demo batches')
    await expect(reloadedJudge.locator('[data-slot="ambition-judge-target-edited"]')).toContainText(
      '30 demo batches checked'
    )
    await shot(page, '7-ambition', '04-after-reload-judge')
  } finally {
    await real.close()
  }
})
