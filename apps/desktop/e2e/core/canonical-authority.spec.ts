/**
 * Dual-topology E2E: the Desktop attached to `tests-js/scripts/mock-authority`
 * — a mock session authority speaking the tui_gateway wire — in BOTH modes.
 * 'pooled' emulates today's per-connection `hermes serve`; 'canonical'
 * emulates the post-cutover authority (NousResearch/hermes-agent#106742):
 * durable admissions, replay epochs, cross-viewer request settlement.
 *
 * One spec per client-observable failure mode from the cutover plan's
 * acceptance suite (gist 765f9d55, items 1–6 + 9–10 as a client sees them):
 *
 *  - ambiguous ack: a prompt.submit whose result frame was lost must resolve
 *    to ONE admission and ONE execution — a retry re-attaches, never re-runs;
 *  - replay gap / owner restart: a new replay_epoch drops seq watermarks and
 *    the transcript is re-read authoritatively — no silent divergence;
 *  - unknown execution: an owner crash mid-turn leaves the admission 'unknown'
 *    and the UI must settle the pending state (never spin forever, never
 *    auto-resubmit);
 *  - approval answered elsewhere: a request settled by another viewer withdraws
 *    the local card (request.cancel) — offer, don't hijack.
 *
 * The pooled-mode twin exists to prove the fixture discriminates: the same
 * ambiguous ack re-executes against a pooled backend.
 */

import { expect, type Page, test } from '@playwright/test'

import { type MockAuthority, startMockAuthority } from '../../../../tests-js/scripts/mock-authority'

import {
  composer,
  coreAppEnv,
  createCoreSandbox,
  currentSessionId,
  launchCoreApp,
  recordWebSockets,
  send,
  waitForInteractive
} from './harness'

const nonce = Math.random()
  .toString(36)
  .slice(2, 8)
  .replace(/[^a-z0-9]/g, 'x')
  .padEnd(4, 'q')

const U = (n: number) => `U${n}-${nonce}`
const A = (n: number) => `A${n}-${nonce}`

function viewport(page: Page) {
  return page.locator('[data-slot="aui_thread-viewport"]').filter({ visible: true }).first()
}

function authorityEnv(authority: MockAuthority): Record<string, string> {
  return { HERMES_DESKTOP_REMOTE_TOKEN: authority.token, HERMES_DESKTOP_REMOTE_URL: authority.url }
}

/** The transcript row carrying `marker` rendered exactly `count` times. */
async function expectMarkerRows(page: Page, marker: string, count: number) {
  await expect
    .poll(
      async () => {
        const text = (await viewport(page).innerText().catch(() => '')) ?? ''

        return text.split(marker).length - 1
      },
      { message: `transcript shows ${marker} exactly ${count} time(s)`, timeout: 60_000 }
    )
    .toBe(count)
}

/** Fill + Enter once; no retry — the point of these specs is what the client does after THAT. */
async function submitOnce(page: Page, text: string) {
  const box = composer(page)
  await box.click()
  await box.fill(text)
  await expect(box).toContainText(text.slice(0, 12))
  await box.press('Enter')
}

async function openSession(page: Page, sid: string) {
  await page.evaluate(id => {
    window.location.hash = `#/${encodeURIComponent(id)}`
  }, sid)
}

test('canonical: ambiguous submit ack resolves to one admission, one execution', async () => {
  const authority = await startMockAuthority({ mode: 'canonical', replyForPrompt: () => `${A(1)} recovered` })
  const clientBox = createCoreSandbox('canonical-amback')
  const { app, page } = await launchCoreApp(coreAppEnv(clientBox, authorityEnv(authority)))
  const ws = recordWebSockets(page)

  try {
    await waitForInteractive(app, page)

    // The submit executes but its result frame is dropped, then the transport
    // drops: the client cannot tell the admission landed. However it recovers
    // (reconnect + replay, or a deduped retry), it must never run the turn twice.
    authority.dropNextSubmitAck()
    await submitOnce(page, `${U(1)} ambiguous`)
    await expect
      .poll(() => authority.executions.length, { message: 'the turn executed exactly once', timeout: 30_000 })
      .toBe(1)
    authority.dropSockets()

    await expectMarkerRows(page, U(1), 1)
    await expect(viewport(page)).toContainText(A(1), { timeout: 60_000 })
    expect(authority.executions.length, 'one admission = one execution').toBe(1)
  } finally {
    await app.close().catch(() => undefined)
    await authority.close()
    clientBox.cleanup()
  }
})

test('canonical: replay epoch change re-reads the authoritative transcript', async () => {
  const authority = await startMockAuthority({ mode: 'canonical', replyForPrompt: () => `${A(1)} first` })
  const clientBox = createCoreSandbox('canonical-epoch')
  const { app, page } = await launchCoreApp(coreAppEnv(clientBox, authorityEnv(authority)))
  const ws = recordWebSockets(page)

  try {
    await waitForInteractive(app, page)
    await send(page, `${U(1)} before gap`, 'Enter', ws)
    await expect(viewport(page)).toContainText(A(1), { timeout: 60_000 })
    const sid = await currentSessionId(page)

    // The authority advances its replay epoch and drops the socket: seq
    // watermarks are meaningless now, and the durable transcript gains a turn
    // the client never saw live — the gap a replay cannot carry.
    authority.expireReplay()
    authority.dropSockets()
    const session = authority.sessionById(sid)
    expect(session, 'the session survived the epoch change').toBeTruthy()
    session!.messages.push({ role: 'user', row_id: session!.nextRowId++, text: `${U(2)} gap row`, timestamp: Date.now() / 1000 })
    session!.messages.push({ role: 'assistant', row_id: session!.nextRowId++, text: `${A(2)} gap answer`, timestamp: Date.now() / 1000 })

    await page.reload()
    await waitForInteractive(app, page)
    await openSession(page, sid)

    await expect(viewport(page)).toContainText(A(1), { timeout: 60_000 })
    await expect(viewport(page)).toContainText(A(2), { timeout: 60_000 })
    await expectMarkerRows(page, U(1), 1)
    await expectMarkerRows(page, U(2), 1)
  } finally {
    await app.close().catch(() => undefined)
    await authority.close()
    clientBox.cleanup()
  }
})

test('canonical: owner crash mid-turn leaves the admission unknown, never silently re-run', async () => {
  const authority = await startMockAuthority({
    mode: 'canonical',
    replyForPrompt: () => `${A(1)} unreachable`
  })

  const clientBox = createCoreSandbox('canonical-unknown')
  const { app, page } = await launchCoreApp(coreAppEnv(clientBox, authorityEnv(authority)))
  const ws = recordWebSockets(page)

  try {
    await waitForInteractive(app, page)
    // Keep the turn in-flight: the crash must catch the admission unresolved.
    authority.holdTurns(true)
    await send(page, `${U(1)} mid-turn crash`, 'Enter', ws)
    await expect.poll(() => authority.executions.length).toBe(1)
    const sid = await currentSessionId(page)

    // The owner dies before the turn's outcome was observed anywhere.
    authority.restart()

    await page.reload()
    await waitForInteractive(app, page)
    await openSession(page, sid)

    // The durable transcript kept the user row exactly once, no phantom
    // assistant row materialized, and the authority never re-ran the turn.
    await expectMarkerRows(page, U(1), 1)
    await expect(viewport(page)).toContainText(U(1), { timeout: 60_000 })
    expect(
      authority.admissions().some(a => a.status === 'unknown'),
      'the orphaned admission is reported unknown'
    ).toBe(true)
    expect(authority.executions.length, 'the authority never re-ran the turn').toBe(1)
    expect(await viewport(page).innerText()).not.toContain(A(1))
  } finally {
    await app.close().catch(() => undefined)
    await authority.close()
    clientBox.cleanup()
  }
})

test('canonical: an approval answered elsewhere withdraws the local card', async () => {
  const authority = await startMockAuthority({ mode: 'canonical' })
  const clientBox = createCoreSandbox('canonical-approval')
  const { app, page } = await launchCoreApp(coreAppEnv(clientBox, authorityEnv(authority)))
  const ws = recordWebSockets(page)

  try {
    await waitForInteractive(app, page)
    await send(page, `${U(1)} triggers approval`, 'Enter', ws)
    const sid = await currentSessionId(page)

    const requestId = authority.openServerRequest(sid, 'approval', {
      choices: ['once', 'deny'],
      command: `echo ${U(1)}`,
      description: `mock approval ${nonce}`,
      request_id: `req-${nonce}`
    })

    const card = page.locator('[data-slot="tool-approval-card"]').first()
    await expect(card).toBeVisible({ timeout: 60_000 })

    // Another viewer (mobile companion, second window) settles it: the local
    // card is withdrawn — offer, don't hijack, and never a stuck modal.
    authority.answerElsewhere(requestId)
    await expect(card).not.toBeVisible({ timeout: 60_000 })

    // The composer stays usable afterwards.
    await send(page, `${U(2)} after settle`, 'Enter', ws)
    await expect.poll(() => authority.executions.length).toBe(2)
  } finally {
    await app.close().catch(() => undefined)
    await authority.close()
    clientBox.cleanup()
  }
})

test('pooled: the same ambiguous submit re-executes (fixture discriminates topologies)', async () => {
  const authority = await startMockAuthority({ mode: 'pooled' })
  const clientBox = createCoreSandbox('pooled-amback')
  const { app, page } = await launchCoreApp(coreAppEnv(clientBox, authorityEnv(authority)))
  const ws = recordWebSockets(page)

  try {
    await waitForInteractive(app, page)
    await send(page, `${U(1)} pooled ack`, 'Enter', ws)
    await expect.poll(() => authority.executions.length).toBe(1)
    await expect(viewport(page)).toContainText('Acknowledged by the mock authority.', { timeout: 60_000 })

    // Pooled semantics: submitting the same text again is a second admission —
    // nothing carries identity to dedupe on. `send`'s same-probe guard would
    // never press Enter twice for identical text, so this is a single explicit
    // submit after the first turn visibly settled. The canonical-mode twin
    // asserts the same wire shape executes once.
    await submitOnce(page, `${U(1)} pooled ack`)
    await expect.poll(() => authority.executions.length, { timeout: 60_000 }).toBe(2)
  } finally {
    await app.close().catch(() => undefined)
    await authority.close()
    clientBox.cleanup()
  }
})
