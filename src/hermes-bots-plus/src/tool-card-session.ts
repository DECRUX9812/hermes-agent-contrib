import { createContext } from 'react'

/** The Bot Chat whose transcript the cards sit in, so "Open page" and an
 *  expanded screenshot land in that chat's preview pane. */
export const PreviewSessionContext = createContext<{ runtimeId: null | string; storedId: null | string }>({
  runtimeId: null,
  storedId: null
})
