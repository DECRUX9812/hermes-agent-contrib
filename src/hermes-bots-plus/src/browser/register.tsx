/** Everything the Browser contributes to the app: strings, the titlebar
 *  button, palette rows, the floating-window shortcut and the link routing. */

import { Codicon, KEYBINDS_AREA, PALETTE_AREA, type PluginContext } from '@hermes/plugin-sdk'

import { ID } from '../shared'

import { BROWSER_LOCALES, browserText } from './browser-i18n'
import { BROWSER_SETTINGS_PAGE, BrowserSettingsPage } from './cloud'
import { installBrowserIntercept } from './intercept'
import { disposeBrowser, dockBrowser, floatBrowser, newBrowserTab, showBrowser, toggleFloatingBrowser } from './open'

const TOGGLE_FLOAT = `${ID}.browser.toggle-float`

export function registerBrowser(ctx: PluginContext): () => void {
  const disposers: (() => void)[] = []
  const add = (dispose: unknown) => {
    if (typeof dispose === 'function') {
      disposers.push(dispose as () => void)
    }
  }

  add(ctx.i18n.register(BROWSER_LOCALES))
  const text = browserText()

  add(
    ctx.register({
      id: 'browser-titlebar',
      area: 'titleBar.tools.right',
      data: {
        id: `${ID}.browser`,
        label: text.open,
        icon: <Codicon name="globe" />,
        actionId: TOGGLE_FLOAT,
        tour: 'hermes-browser',
        onSelect: () => void showBrowser()
      }
    })
  )

  if (KEYBINDS_AREA) {
    add(
      ctx.register({
        id: 'browser-toggle-float',
        area: KEYBINDS_AREA,
        data: { id: TOGGLE_FLOAT, category: 'view', defaults: ['mod+alt+b'], label: text.toggleFloating, run: toggleFloatingBrowser }
      })
    )
  }

  add(
    ctx.register({
      id: 'browser-open',
      area: PALETTE_AREA,
      data: { id: `${ID}.browser.open`, label: text.open, keywords: ['browser', 'web', 'preview', 'url', 'tab'], run: () => void showBrowser() }
    })
  )
  add(
    ctx.register({
      id: 'browser-new-tab',
      area: PALETTE_AREA,
      data: { id: `${ID}.browser.new-tab`, label: `${text.title}: ${text.newTab}`, keywords: ['browser', 'tab'], run: newBrowserTab }
    })
  )
  add(
    ctx.register({
      id: 'browser-float',
      area: PALETTE_AREA,
      data: {
        id: `${ID}.browser.float`,
        label: `${text.title}: ${text.popOut}`,
        keywords: ['browser', 'float', 'picture in picture', 'pip', 'pop out'],
        run: floatBrowser
      }
    })
  )

  for (const side of ['left', 'right'] as const) {
    add(
      ctx.register({
        id: `browser-dock-${side}`,
        area: PALETTE_AREA,
        data: {
          id: `${ID}.browser.dock-${side}`,
          label: `${text.title}: ${side === 'left' ? text.dockLeft : text.dockRight}`,
          keywords: ['browser', 'dock', 'side', side],
          run: () => dockBrowser(side)
        }
      })
    )
  }

  // Per-bot browser mode (cloud / local headed). Older hosts have no plugin settings pages.
  if (typeof ctx.registerSettingsPage === 'function') {
    add(ctx.registerSettingsPage({ id: BROWSER_SETTINGS_PAGE, title: text.settingsTitle, icon: 'globe', order: 40, render: () => <BrowserSettingsPage /> }))
  }

  add(installBrowserIntercept())

  return () => {
    disposeBrowser()
    disposers.reverse().forEach(dispose => dispose())
  }
}
