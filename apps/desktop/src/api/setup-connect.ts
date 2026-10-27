import { hermesApi, profileScoped } from './client'
import type { WebAccessChange } from './webapp-access'

// First-run "Connect" step: GitHub sign-in through the host's gh CLI, and a Cloudflare Quick Tunnel
// that puts the Webapp on a public HTTPS address behind Nous sign-in. Tunnel routes answer only the
// native app on the computer running the gateway.

export interface GithubLogin {
  detail?: string
  state: 'failed' | 'pending' | 'succeeded'
  user_code: null | string
  verification_url: null | string
}

export interface GithubStatus {
  account: null | string
  authenticated: boolean
  /** `gh` is installed on the gateway's computer. */
  available: boolean
  login: GithubLogin | null
}

export interface TunnelStatus {
  cloudflared: boolean
  port: null | number
  running: boolean
  /** Web access is pinned to an earlier quick-tunnel address that no longer answers. */
  stale: boolean
  url: null | string
}

export interface TunnelChange {
  access: WebAccessChange
  tunnel: Partial<TunnelStatus> & { running: boolean; url: null | string }
}

/** Starting a tunnel also restarts the gateway onto web access, which can build the Webapp first. */
const TUNNEL_START_TIMEOUT_MS = 35 * 60_000

export function getGithubStatus(): Promise<GithubStatus> {
  return hermesApi<GithubStatus>({ ...profileScoped(), path: '/api/plugins/hermes-connect/github' })
}

export function startGithubLogin(): Promise<GithubLogin> {
  return hermesApi<GithubLogin>({ ...profileScoped(), method: 'POST', path: '/api/plugins/hermes-connect/github/login' })
}

export function cancelGithubLogin(): Promise<{ ok: boolean }> {
  return hermesApi<{ ok: boolean }>({ ...profileScoped(), method: 'DELETE', path: '/api/plugins/hermes-connect/github/login' })
}

export function getTunnelStatus(): Promise<TunnelStatus> {
  return hermesApi<TunnelStatus>({ ...profileScoped(), path: '/api/plugins/hermes-connect/tunnel' })
}

export function startTunnel(): Promise<TunnelChange> {
  return hermesApi<TunnelChange>({
    ...profileScoped(),
    method: 'POST',
    path: '/api/plugins/hermes-connect/tunnel/start',
    timeoutMs: TUNNEL_START_TIMEOUT_MS
  })
}

export function stopTunnel(): Promise<TunnelChange> {
  return hermesApi<TunnelChange>({ ...profileScoped(), method: 'POST', path: '/api/plugins/hermes-connect/tunnel/stop' })
}
