import { installBrowserDesktopBridge } from './browser-desktop-bridge'
import { installBrowserViewport } from './browser-viewport'

if (typeof window !== 'undefined' && installBrowserDesktopBridge()) {
  console.log('[browser-desktop-bridge-install] installing viewport and desktop plugin capability')
  installBrowserViewport()
  // The desktop-plugin door (desktopPluginsRoot / readDir / readFileText / readPluginSource)
  // now comes from upstream's `createBrowserDesktopPluginsBridge`, which
  // `installBrowserDesktopBridge()` spreads into the bridge it installs — the fork's own
  // `installBrowserDesktopPluginCapability` was the pre-upstream version of the same thing.
}
