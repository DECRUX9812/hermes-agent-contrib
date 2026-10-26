import { installBrowserDesktopBridge } from './browser-desktop-bridge'
import { installBrowserDesktopPluginCapability } from './browser-desktop-plugins'
import { installBrowserViewport } from './browser-viewport'

if (typeof window !== 'undefined' && installBrowserDesktopBridge()) {
  console.log('[browser-desktop-bridge-install] installing viewport and desktop plugin capability')
  installBrowserViewport()
  // Disk plugins resolve through `window.hermesDesktop.desktopPluginsRoot`, which
  // only Electron's preload defines; without this the webapp's `diskRoots()` is []
  // and every folder under <home>/desktop-plugins is silently invisible.
  installBrowserDesktopPluginCapability()
}
