import { expect, type Page, test } from '@playwright/test'

import { bootReal, reloadWindow, rpc, shot } from './reload-harness'

const GOAL = 'Summarize the handbook'

interface BoardCard {
  column: string
  needs_you: string | null
  stoppable: boolean
  task_id: string
  title: string
}

interface BoardResult {
  cards: BoardCard[]
  goal: { title: string } | null
  totals: { needs_you: number }
}

async function openTeam(page: Page): Promise<void> {
  await page.locator('[data-slot="activity-rail"] [data-rail-entry="hermes-bots:team-nav"]').click()
  await page.locator('[data-slot="team-page"]').waitFor({ state: 'visible' })
}

async function applyResearchTemplate(page: Page): Promise<void> {
  const card = page.locator('[data-slot="team-template"]').filter({ hasText: 'Research & Report' })

  await card.waitFor({ state: 'visible' })
  await shot(page, '5-team', '01-empty-templates')
  await card.getByRole('button', { name: 'Create team' }).click()
  await page.locator('[data-slot="team-goal-bar"]').waitFor({ state: 'visible', timeout: 60_000 })
}

/** The team the template apply created, straight from the backend. */
async function backendTeam(page: Page): Promise<{ id: string; members: { lead: boolean; profile: null | string; title: string }[] }> {
  const list = await rpc<{ teams: { id: string; name: string }[] }>(page, 'bots_team.list', {})

  expect(list.teams).toHaveLength(1)

  const view = await rpc<{ team: { id: string; members: { lead: boolean; profile: null | string; title: string }[] } }>(
    page,
    'bots_team.get',
    { team_id: list.teams[0].id }
  )

  return view.team
}

async function boardFromBackend(page: Page, teamId: string): Promise<BoardResult> {
  return rpc<BoardResult>(page, 'fork.team.board', { team_id: teamId })
}

/** The board card in the UI as (title, column) pairs. */
async function uiCards(page: Page): Promise<{ column: string; task_id: string; title: string }[]> {
  return page
    .locator('[data-slot="team-card"]')
    .evaluateAll(els =>
      els.map(el => ({
        column: el.closest('[data-slot="team-board-column"]')?.getAttribute('data-column') ?? '',
        task_id: el.getAttribute('data-task-id') ?? '',
        title: el.querySelector('p')?.textContent ?? ''
      }))
    )
}

test('a template team survives a reload with its org, goal and board intact', async () => {
  test.setTimeout(600_000)
  const real = await bootReal('team-board-reload')

  try {
    const { app, page } = real

    await test.step('create the Research & Report team from a template', async () => {
      await openTeam(page)
      await applyResearchTemplate(page)

      // The org chart: four seated bots, the lead the topmost seat.
      const seats = page.locator('[data-slot="team-seat"]')

      await expect(seats).toHaveCount(4)
      await expect(seats.first()).toContainText('Research lead')
    })

    const team = await test.step('the backend knows the team and its four profiles', async () => {
      const team = await backendTeam(page)

      expect(team.members).toHaveLength(4)
      expect(team.members.filter(m => m.lead)).toHaveLength(1)

      const roster = await rpc<{ profiles: { name: string }[] }>(page, 'profiles.list', {})

      for (const member of team.members) {
        expect(member.profile).toBeTruthy()
        expect(roster.profiles.map(p => p.name)).toContain(member.profile)
      }

      return team
    })

    await test.step('start a goal and watch a lead card reach the board', async () => {
      await page.getByRole('textbox', { name: 'What should the team do?' }).fill(GOAL)
      await page.getByRole('button', { name: 'Start', exact: true }).click()

      // The dispatcher may or may not run the worker in the sandbox (scripted model):
      // assert only what the backend reports, never a timing guess.
      let lead: BoardCard | undefined

      await expect
        .poll(
          async () => {
            const board = await boardFromBackend(page, team.id)

            lead = board.cards.find(c => c.title.toLowerCase().includes(GOAL.toLowerCase()))

            return lead ? true : false
          },
          { timeout: 120_000, intervals: [2_000] }
        )
        .toBe(true)

      const first = await boardFromBackend(page, team.id)

      lead = first.cards.find(c => c.title.toLowerCase().includes(GOAL.toLowerCase()))
      expect(['queued', 'in_progress']).toContain(lead!.column)

      // The UI draws the same card in the same column.
      await expect.poll(async () => (await uiCards(page)).some(c => c.task_id === lead!.task_id), {
        timeout: 30_000
      }).toBe(true)

      await shot(page, '5-team', '02-goal-board')
    })

    const before = await test.step('stop the card if it is running; Stop only exists when stoppable', async () => {
      const board = await boardFromBackend(page, team.id)
      const lead = board.cards.find(c => c.title.toLowerCase().includes(GOAL.toLowerCase()))!
      const uiCard = page.locator(`[data-slot="team-card"][data-task-id="${lead.task_id}"]`)

      await uiCard.waitFor({ state: 'visible' })

      const stop = uiCard.locator('[data-slot="team-card-stop"]')

      if (lead.stoppable) {
        await stop.click()
        await expect
          .poll(async () => (await boardFromBackend(page, team.id)).cards.find(c => c.task_id === lead.task_id)?.stoppable, {
            timeout: 60_000
          })
          .toBe(false)
      } else {
        await expect(stop).toHaveCount(0)
      }

      const after = await boardFromBackend(page, team.id)
      const settled = after.cards.find(c => c.task_id === lead.task_id)!

      return {
        goal: after.goal?.title ?? '',
        card: { column: settled.column, task_id: settled.task_id, title: settled.title },
        seats: (await backendTeam(page)).members.map(m => [m.profile, m.title, m.lead] as const)
      }
    })

    await test.step('reload the window', async () => {
      // The team route mounts no chat composer, and the reload harness waits for one,
      // so reload from the home route; every team surface below is re-read from the
      // backend through the normal RPC path either way.
      await page.locator('[data-slot="activity-rail"] [data-rail-entry="home"]').click()
      await page.locator('[data-slot="composer-root"]').waitFor({ state: 'visible' })

      const method = await reloadWindow(app, page)
      test.info().annotations.push({ type: 'reload', description: method })
    })

    await test.step('the reloaded page agrees with fork.team.board everywhere', async () => {
      await openTeam(page)

      // Same single team, same four seats, lead still on top.
      const seats = page.locator('[data-slot="team-seat"]')

      await expect(seats).toHaveCount(4)
      await expect(seats.first()).toContainText('Research lead')

      const after = await backendTeam(page)
      const afterSeats = after.members.map(m => [m.profile, m.title, m.lead] as const)

      expect(afterSeats).toEqual(before.seats)

      // The goal bar text and the card come from the backend, unchanged.
      await expect(page.locator('[data-slot="team-goal-active"]')).toContainText(before.goal)
      await expect(page.getByText(before.card.title)).toBeVisible()

      const board = await boardFromBackend(page, after.id)
      const card = board.cards.find(c => c.task_id === before.card.task_id)!

      expect(card.title).toBe(before.card.title)
      expect(card.column).toBe(before.card.column)

      const rows = await uiCards(page)

      expect(rows.find(r => r.task_id === before.card.task_id)).toEqual(before.card)
      await shot(page, '5-team', '03-after-reload')
    })
  } finally {
    await real.close()
  }
})
