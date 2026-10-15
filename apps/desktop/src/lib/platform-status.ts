import type { StatusState } from '@/components/status-dot'

// One reading of a messaging platform's runtime state, shared by the Messaging
// page and the gateway menu so the same bot never shows two different tones.
// Anything enabled that isn't connected or failed (connecting, retrying,
// restart needed, gateway stopped, needs setup) is waiting on something: warn.
const STATE_STATUS: Record<string, StatusState> = {
  connected: 'done',
  disabled: 'queued',
  fatal: 'error',
  startup_failed: 'error'
}

interface PlatformStatusInput {
  enabled?: boolean
  state?: null | string
}

export function platformStatusTone({ enabled = true, state }: PlatformStatusInput): StatusState {
  if (!enabled) {
    return 'queued'
  }

  return (state && STATE_STATUS[state]) || 'running'
}
