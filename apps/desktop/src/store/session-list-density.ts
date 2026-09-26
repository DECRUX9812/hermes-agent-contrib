import { type Codec, persistentAtom } from '@/lib/persisted'

export type SessionListDensity = 'compact' | 'condensed' | 'comfortable' | 'detailed'

const STORAGE_KEY = 'hermes.desktop.sessionListDensity'

// Compact is the pre-density row exactly as it shipped, so existing users see
// no change until they opt into a denser-information mode themselves (#68119).
// Condensed goes the other direction — dot + title only; everything the row
// would have shown stays reachable on the title's tooltip.
const densityCodec: Codec<SessionListDensity> = {
  decode: raw => (raw === 'condensed' || raw === 'comfortable' || raw === 'detailed' ? raw : 'compact'),
  encode: value => value
}

export const $sessionListDensity = persistentAtom<SessionListDensity>(STORAGE_KEY, 'compact', densityCodec)

export function setSessionListDensity(density: SessionListDensity) {
  $sessionListDensity.set(density)
}
