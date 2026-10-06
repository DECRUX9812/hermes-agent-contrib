/**
 * Electron wiring for the PageContextService (architecture §9). It reuses the
 * exact browser source the AnchorService watches, so the page the composer
 * reads is always the page the avatars perch on.
 */

import { createElectronBrowserSource } from './pane3d-anchor-electron'
import { createPageContextService, type PageContextService } from './pane3d-context'

export function createElectronPageContextService(): PageContextService {
  const source = createElectronBrowserSource()

  return createPageContextService({
    enumerateOsWindow: source.enumerateOsWindow,
    listGuests: source.listGuests,
    listHosts: source.listHosts
  })
}
