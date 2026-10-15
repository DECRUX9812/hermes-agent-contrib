import { host } from '@hermes/plugin-sdk'

import { api, type DeskFolder, type DeskWorkstream, errorText } from './api'

export function requestPrompt(folder: DeskFolder, workstreamId: string, request: string): string {
  return `${request}\n\nWork only inside ${folder.path}. Use the office tools (toolset "office"). Workstream id: ${workstreamId}.`
}

export interface StartResult {
  error?: string
  started: boolean
  workstream: DeskWorkstream
}

// Records the workstream first so the request is never lost, then starts a real
// Hermes session for it. Any gateway failure leaves the workstream `queued` and
// is reported to the caller; it is never marked running without a live turn.
export async function startWorkstream(folder: DeskFolder, request: string): Promise<StartResult> {
  const workstream = await api.createWorkstream({
    folder_id: folder.id,
    request,
    title: request.slice(0, 60)
  })

  if (typeof host.request !== 'function') {
    return { error: 'This Hermes build has no gateway request door (host.request).', started: false, workstream }
  }

  let created: { session_id?: string; stored_session_id?: string }

  try {
    created = await host.request('session.create', { cwd: folder.path, cwd_explicit: true })
  } catch (error) {
    return { error: `Could not start a Hermes session: ${errorText(error)}`, started: false, workstream }
  }

  const storedId = created.stored_session_id || created.session_id

  try {
    await host.request('prompt.submit', {
      session_id: created.session_id,
      text: requestPrompt(folder, workstream.id, request)
    })
  } catch (error) {
    if (storedId) {
      await api.patchWorkstream(workstream.id, { session_id: storedId }).catch(() => undefined)
    }

    return {
      error: `The session started but the request was not sent: ${errorText(error)}`,
      started: false,
      workstream
    }
  }

  try {
    const updated = await api.patchWorkstream(workstream.id, { session_id: storedId, status: 'running' })

    return { started: true, workstream: updated }
  } catch (error) {
    return {
      error: `Started, but the Desk could not record the session: ${errorText(error)}`,
      started: true,
      workstream
    }
  }
}
