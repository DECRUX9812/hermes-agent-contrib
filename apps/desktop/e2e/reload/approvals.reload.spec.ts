/**
 * Durable approval decisions survive a renderer reload and run a terminal
 * command at most once. Only the LLM is scripted; Electron and the backend are
 * real for this reload lane.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { backendProcesses, currentSessionId, recordWebSockets, send, waitForInteractive } from '../core/harness'

import { bootReal, reloadWindow, rpc, shot } from './reload-harness'

const nonce = Math.random()
  .toString(36)
  .slice(2, 8)
  .replace(/[^a-z0-9]/g, 'x')
  .padEnd(4, 'q')

const U = (step: number) => `U${step}-${nonce}`
const A = (step: number) => `A${step}-${nonce}`

interface ApprovalRow {
  request_id: string
  status: string
  ran_at?: number | null
  choice?: string | null
}

function approvalEntry(page: Page) {
  return page.locator('[data-slot="composer-approval-entry"]').filter({ visible: true })
}

async function approvals(page: Page, sessionId: string): Promise<ApprovalRow[]> {
  const result = await rpc<{ approvals: ApprovalRow[] }>(page, 'fork.approvals.list', { session_id: sessionId })

  return result.approvals
}

test('approval card and decision survive reload without rerunning the command', async () => {
  const real = await bootReal('approvals-reload', { approvals: 'manual' })

  try {
    const { app, page, provider, box } = real
    const ws = recordWebSockets(page)
    const session = { sessionId: '', expectUserMarkers: [] as string[] }
    const runMarker = path.join(box.root, `approval-run-${nonce}.txt`)
    const runTarget = path.join(box.root, `approval-target-${nonce}`)
    const denyMarker = path.join(box.root, `approval-deny-${nonce}.txt`)
    const denyTarget = path.join(box.root, `approval-denied-target-${nonce}`)
    fs.mkdirSync(runTarget)
    fs.mkdirSync(denyTarget)

    const terminalCommand = (marker: string, target: string) =>
      `printf '%s\\n' '${nonce}' >> '${marker}' && rm -rf '${target}'`

    await test.step('ask for approval, with no side effect before the decision', async () => {
      provider.script(U(1), [
        {
          text: [`${A(1)} needs approval`],
          toolCalls: [{ name: 'terminal', args: { command: terminalCommand(runMarker, runTarget) } }]
        },
        { text: [`${A(1)} command completed`] }
      ])

      await send(page, `${U(1)} run the requested terminal command`, 'Enter', ws)

      const entry = approvalEntry(page)
      await expect(entry).toHaveCount(1, { timeout: 120_000 })
      await expect(entry).toContainText('terminal')
      await expect(entry).toContainText(terminalCommand(runMarker, runTarget))
      await expect(entry.getByRole('button', { name: 'Allow once' })).toBeVisible()
      await expect(entry.getByRole('button', { name: 'Always allow' })).toBeVisible()
      await expect(entry.getByRole('button', { name: 'Deny' })).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(fs.existsSync(runMarker)).toBe(false)
      expect(fs.existsSync(runTarget)).toBe(true)

      const order = await page.evaluate(() => {
        const card = document.querySelector('[data-slot="composer-approval-entry"]')
        const composer = document.querySelector('[data-slot="composer-root"]')

        return Boolean(card && composer && (card.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING))
      })

      expect(order).toBe(true)

      session.sessionId = await currentSessionId(page)
      await expect.poll(() => approvals(page, session.sessionId)).toHaveLength(1)
      await shot(page, '3-toolcards', '01-approval-pending')
    })

    await test.step('reload: render the same pending request once, then allow it once', async () => {
      await reloadWindow(app, page)

      const entry = approvalEntry(page)
      await expect(entry).toHaveCount(1, { timeout: 120_000 })
      await expect(entry.getByRole('button', { name: 'Allow once' })).toBeVisible()
      await expect(page.locator('[data-slot="composer-approval-entry"]')).toHaveCount(1)
      expect(fs.existsSync(runMarker)).toBe(false)

      await entry.getByRole('button', { name: 'Allow once' }).click()
      await expect(entry.getByRole('status')).toContainText('Decision recorded')
      await shot(page, '3-toolcards', '02-approval-allowed')

      await expect
        .poll(() => provider.completions.some(c => c.marker === U(1) && c.step === 1 && c.finished), {
          timeout: 120_000
        })
        .toBe(true)
      expect(fs.readFileSync(runMarker, 'utf8').trim().split(/\r?\n/)).toEqual([nonce])
      expect(fs.existsSync(runTarget)).toBe(false)
      session.expectUserMarkers.push(U(1))

      await expect
        .poll(async () => (await approvals(page, session.sessionId)).find(row => row.status === 'allowed'))
        .toMatchObject({ choice: 'once', ran_at: expect.any(Number) })
      await expect(approvalEntry(page)).toHaveCount(0, { timeout: 10_000 })

      await reloadWindow(app, page)
      await expect(approvalEntry(page)).toHaveCount(0, { timeout: 60_000 })
    })

    await test.step('backend restart: the terminal decision stays final', async () => {
      const [backend] = backendProcesses(box)
      expect(backend).toBeTruthy()
      process.kill(backend!.pid, 'SIGKILL')

      await expect
        .poll(
          () => backendProcesses(box).filter(proc => proc.pid !== backend!.pid).length,
          { message: 'the approval backend respawns', timeout: 120_000 }
        )
        .toBe(1)
      await waitForInteractive(app, page)

      await expect
        .poll(async () => (await approvals(page, session.sessionId)).find(row => row.status === 'allowed'))
        .toMatchObject({ choice: 'once', ran_at: expect.any(Number) })
      expect(fs.readFileSync(runMarker, 'utf8').trim().split(/\r?\n/)).toEqual([nonce])
      expect(fs.existsSync(runTarget)).toBe(false)
      await expect(approvalEntry(page)).toHaveCount(0)
    })

    await test.step('deny: the command does not run and the journal records denial', async () => {
      provider.script(U(2), [
        {
          text: [`${A(2)} needs approval`],
          toolCalls: [{ name: 'terminal', args: { command: terminalCommand(denyMarker, denyTarget) } }]
        },
        { text: [`${A(2)} command denied`] }
      ])

      await send(page, `${U(2)} run the second terminal command`, 'Enter', ws)

      const entry = approvalEntry(page)
      await expect(entry).toHaveCount(1, { timeout: 120_000 })
      await entry.getByRole('button', { name: 'Deny' }).click()
      await expect
        .poll(() => provider.completions.some(c => c.marker === U(2) && c.step === 1 && c.finished), {
          timeout: 120_000
        })
        .toBe(true)
      expect(fs.existsSync(denyMarker)).toBe(false)
      expect(fs.existsSync(denyTarget)).toBe(true)

      await expect
        .poll(async () => (await approvals(page, session.sessionId)).find(row => row.status === 'denied'))
        .toMatchObject({ choice: 'deny' })
      await shot(page, '3-toolcards', '03-approval-denied')
    })
  } finally {
    await real.close()
  }
})
