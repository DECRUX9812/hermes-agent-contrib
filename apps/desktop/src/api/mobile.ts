// Mobile companion (roadmap #45): mint a short-lived pairing code the phone
// redeems at `POST /api/mobile/pair` for the dashboard session token. The mint
// call is authed like every other /api route; the pairing exchange is public
// but code-gated (single-use, minutes-lived, rate-limited on misses).

import { hermesApi } from './client'

export interface MobilePairing {
  code: string
  expires_in: number
  page: string
}

export function createMobilePairingCode(): Promise<MobilePairing> {
  return hermesApi<MobilePairing>({ method: 'POST', path: '/api/mobile/pairing' })
}
