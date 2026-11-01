/** Service worker: the dock's front door.
 *
 *  A side panel can only be opened from a user gesture, and a service worker
 *  has none — so the toolbar click and the keyboard command are the two entry
 *  points, and both are gestures. Nothing else lives here on purpose: the HUD
 *  and the capture logic are page code, so the worker can be asleep for all of it.
 */

const openDock = async tab => {
  try {
    await chrome.sidePanel.open({ windowId: tab?.windowId ?? (await chrome.windows.getLastFocused()).id })
  } catch {
    // `sidePanel.open` needs the gesture that we only have from a real click.
    // Fall back to a window so the user still gets the panel.
    await chrome.windows.create({
      focused: true,
      height: 720,
      type: 'popup',
      url: chrome.runtime.getURL('dock.html'),
      width: 460,
    })
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // Toolbar click opens the dock instead of a popup: fewer clicks to reach the
  // panel that docks beside the tab, which is the point of the product.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

chrome.action.onClicked.addListener(openDock)

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'open-dock') {return}
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  await openDock(tab)
})
