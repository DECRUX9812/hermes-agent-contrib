import { installBrowserDesktopBridge } from './browser-desktop-bridge'
import { installBrowserDesktopPluginCapability } from './browser-desktop-plugins'
import { installBrowserViewport } from './browser-viewport'

if (typeof window !== 'undefined' && installBrowserDesktopBridge()) {
  installBrowserViewport()
  // Disk plugins resolve through `window.hermesDesktop.desktopPluginsRoot`,
  // which only Electron's preload defines. Without this the browser-hosted
  // renderer's `diskRoots()` returns [] and every folder under
  // <home>/desktop-plugins is silently invisible. The capability no-ops when a
  // preload bridge already answered, so Electron stays authoritative.
  installBrowserDesktopPluginCapability()
}
