/**
 * DESIGN.md rule 2 visual proof: a long assistant answer reads at the
 * ~72ch prose measure inside the 46rem transcript column — prose lines wrap
 * at `--prose-measure` while the column (and the composer below) keep the
 * full width for wide content.
 */

import { expect, test } from '@playwright/test'

import { recordWebSockets, send } from '../core/harness'

import { bootReal, shot } from './reload-harness'

const nonce = Math.random()
  .toString(36)
  .slice(2, 8)
  .replace(/[^a-z0-9]/g, 'x')
  .padEnd(4, 'q')

const MARKER = `U1-${nonce}`
const PROMPT = 'Summarize the launch plan for the team.'

// Four long paragraphs: at the 46rem column each would run ~90 characters
// per line uncapped, so the shot only shows the measure when the cap binds.
const PARAGRAPHS = [
  'The launch window opens next Tuesday and the checklist is in good shape overall. ' +
    'The messaging gateway passed its soak test overnight with no dropped deliveries, ' +
    'and the fallback path that retries failed handshakes kept every session alive ' +
    'through two forced reconnects, which was the last open risk from the review.',
  'Documentation is the remaining bottleneck before the announcement can go out. ' +
    'The setup guide needs a walkthrough for the new connection flow, and the ' +
    'troubleshooting page is missing the three most common gateway errors that ' +
    'support has seen this month.',
  'Pricing and packaging are locked. The free tier keeps the limits it shipped with, ' +
    'paid tiers inherit the new usage dashboard, and the migration for existing ' +
    'workspaces runs automatically on first sign-in after the release, so no ' +
    'administrator action is required.',
  'If everything holds, the rollout is: docs finish Monday, the release candidate ' +
    'is cut Tuesday morning, the blog post and the demo video go out with the ' +
    'announcement on Wednesday, and the team review of the first-week metrics ' +
    'lands the following Monday.'
]

const REPLY = PARAGRAPHS.join('\n\n')

test('long assistant prose reads at the 72ch measure', async () => {
  test.setTimeout(180_000)
  const real = await bootReal('design-prose')

  try {
    const { page, provider } = real
    const ws = recordWebSockets(page)

    provider.script(MARKER, [{ text: [REPLY] }])
    await send(page, `${MARKER} ${PROMPT}`, 'Enter', ws)
    await expect
      .poll(() => provider.completions.some(c => c.marker === MARKER && c.finished), { timeout: 120_000 })
      .toBe(true)

    const content = page
      .locator('[data-slot="aui_assistant-message-content"]')
      .filter({ hasText: 'The launch window opens next Tuesday' })
      .filter({ visible: true })

    await expect(content).toBeVisible()

    // Behaviour contract: every prose paragraph is capped at --prose-measure
    // while the message column stays on --composer-width. At this viewport the
    // column is 46rem (well above the measure), so the cap must bind and the
    // paragraphs must sit clearly inside it.
    const { paragraphs, proseWidth, columnWidth } = await content.evaluate(el => {
      const column = el.closest('[data-slot="aui_thread-content"]') ?? el
      // Streamdown wraps blocks in its own containers, so paragraphs are
      // nested — match at any depth.
      const prose = [...el.querySelectorAll<HTMLElement>('.aui-md p')]

      return {
        columnWidth: column.getBoundingClientRect().width,
        paragraphs: prose.length,
        proseWidth: Math.max(0, ...prose.map(p => p.getBoundingClientRect().width))
      }
    })

    expect(paragraphs).toBe(PARAGRAPHS.length)
    // The cap (72ch of the conversation font, ~36rem) must keep prose well
    // inside the 46rem column.
    expect(proseWidth).toBeGreaterThan(0)
    expect(proseWidth).toBeLessThan(columnWidth - 64)
    await shot(page, '6-design', '01-chat-prose')
  } finally {
    await real.close()
  }
})
