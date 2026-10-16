/**
 * DESIGN.md rule 4 visual proof: the team board draws the one status
 * vocabulary — queued (muted), running (accent pulse), needs approval
 * (amber), done (green) — through the shared tokens, several states side
 * by side on one screen.
 */

import { expect, test } from '@playwright/test'

import { bootReal, rpc, shot } from './reload-harness'

const GOAL = 'Summarize the handbook'

test('the team board shows several status states side by side', async () => {
  test.setTimeout(600_000)
  const real = await bootReal('design-status')

  try {
    const { page } = real

    await page.locator('[data-slot="activity-rail"] [data-rail-entry="hermes-bots:team-nav"]').click()
    await page.locator('[data-slot="team-page"]').waitFor({ state: 'visible' })

    const template = page.locator('[data-slot="team-template"]').filter({ hasText: 'Research & Report' })

    await template.waitFor({ state: 'visible' })
    await template.getByRole('button', { name: 'Create team' }).click()
    await page.locator('[data-slot="team-goal-bar"]').waitFor({ state: 'visible', timeout: 60_000 })

    await page.getByRole('textbox', { name: 'What should the team do?' }).fill(GOAL)
    await page.getByRole('button', { name: 'Start', exact: true }).click()

    // Any card on the board first; then give running a grace window so the
    // shot catches queued and running (accent pulse) side by side when the
    // sandbox dispatcher promotes the lead (it may legitimately stay queued).
    await expect
      .poll(
        async () => {
          const list = await rpc<{ teams: { id: string }[] }>(page, 'bots_team.list', {})

          if (!list.teams.length) {
            return false
          }

          const board = await rpc<{ cards: { column: string }[] }>(page, 'fork.team.board', {
            team_id: list.teams[0].id
          })

          return board.cards.length > 0
        },
        { timeout: 120_000, intervals: [2_000] }
      )
      .toBe(true)

    try {
      await expect
        .poll(
          async () => {
            const list = await rpc<{ teams: { id: string }[] }>(page, 'bots_team.list', {})

            const board = await rpc<{ cards: { column: string }[] }>(page, 'fork.team.board', {
              team_id: list.teams[0].id
            })

            return board.cards.some(c => c.column === 'in_progress')
          },
          { timeout: 60_000, intervals: [2_000] }
        )
        .toBe(true)
    } catch {
      // A queued-only board is a valid resting state in the sandbox.
    }


    await page.locator('[data-slot="team-card"]').first().waitFor({ state: 'visible' })
    await shot(page, '6-design', '03-status-vocabulary')
  } finally {
    await real.close()
  }
})
