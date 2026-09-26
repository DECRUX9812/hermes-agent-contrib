import { createContext } from 'react'

import type { HermesGateway } from '@/hermes'

export interface ThreadEditContextValue {
  cwd: string | null
  gateway: HermesGateway | null
  sessionId: string | null
}

// Edit-composer context. The composer only exists while a message is being
// edited, and it mounts deep inside the memo'd ThreadMessageList, so the
// edit context can neither ride the component-map memo deps (that remints
// the component types on every session switch and remounts the outgoing
// transcript) nor sit in a render-time ref (a mounted composer never
// re-reads it when a same-session change leaves every list prop
// referentially equal). Context solves both: the component type stays
// stable, and a changed value propagates straight to the mounted consumer.
//
// Lives in its own module so row components (user-message) can read the
// session without importing index.tsx back.
export const ThreadEditContext = createContext<ThreadEditContextValue>({ cwd: null, gateway: null, sessionId: null })
