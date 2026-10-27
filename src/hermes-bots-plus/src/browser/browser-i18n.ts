/**
 * Strings for the Hermes Browser workspace. English is the floor; other
 * locales fall back to it until translated.
 */

import { type PluginLocaleBundles, usePluginI18n } from '@hermes/plugin-sdk'

import { getPluginCtx, i18nId } from '../shared'
import { bindTree } from '../team-i18n'

export const BROWSER_EN = {
  title: 'Browser',
  open: 'Open browser',
  newTab: 'New tab',
  closeTab: 'Close tab',
  back: 'Back',
  forward: 'Forward',
  reload: 'Reload',
  stop: 'Stop',
  address: 'Search or enter address',
  openExternal: 'Open in a new browser tab',
  askBot: 'Ask a bot to open this page',
  askBotPrompt: (url: string) => `Open ${url} in your browser and tell me what you see.`,
  viaGateway: 'Shown through Hermes',
  viaGatewayHint: 'This page is rendered by the browser on your Hermes machine and streamed here.',
  showDirect: 'Show directly',
  loadingPage: (host: string) => `Loading ${host}…`,
  checking: 'Checking the page…',
  blockedTitle: (host: string) => `${host} can't be shown inside another app`,
  blockedBody: 'The site tells browsers not to display it in a frame. You can still view it here through Hermes, or open it in a new tab.',
  viewHere: 'View it here',
  unreachableTitle: (host: string) => `Can't reach ${host}`,
  unreachableLocal:
    'Nothing answered on this address, on this computer or on your Hermes machine. Is the dev server running?',
  unreachableRemote: "The page didn't answer. Check the address or try again in a moment.",
  tryAgain: 'Try again',
  remoteFailed: "Hermes couldn't render this page.",
  emptyTitle: 'Browse without leaving Hermes',
  emptyBody:
    'Links from your chats open here. Local dev servers render inline, and sites that refuse frames are shown through Hermes.',
  emptyHint: 'Type an address, or try one of these',
  linksHere: 'Open chat links here',
  linksHereHint: 'When off, chat links open in your own browser',
  botTab: (name: string) => `${name} · Screen`,
  activityTab: (name: string) => `${name} · Browsing`,
  activityIdle: 'Finished',
  activityWaiting: 'Waiting for the first screenshot…',
  activityGone: 'This browsing session is no longer in view. Scroll the chat back to it to follow along.',
  following: 'Following live',
  followLatest: 'Jump to latest',
  stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
  openPageHere: 'Open this page in a tab',
  watchScreen: 'Watch live screen',
  showMe: 'Show me',
  showMeHint: "Follow the bot's browsing in the Browser",
  stepsLabel: 'Steps',
  needsUpdate: 'Update Hermes to open the in-app browser.',
  openedHere: (host: string) => `Opened ${host} in the Hermes browser`,
  popOut: 'Float over the app',
  floating: 'Floating browser',
  dockLeft: 'Dock to the left',
  dockRight: 'Dock to the right',
  undock: 'Float freely',
  toTab: 'Put back in a tab',
  minimise: 'Minimise (Esc)',
  restore: (title: string) => `Restore ${title}`,
  closeBrowser: 'Close browser',
  takeOver: 'Take over',
  handBack: 'Hand back',
  botActive: 'A bot is working',
  toggleFloating: 'Toggle floating browser',
  moveHint: 'Drag to move. Drop on a screen edge to dock.',
  resize: 'Resize',
  floatUnavailable: "This Hermes can't float the browser yet, so it opened as a tab.",
  pageKeys: 'Keys for the page',
  cloudWatching: 'Watching a cloud browser, take-over not available',
  cloudWatchingShort: 'Cloud browser',
  cloudTip: 'This bot browses in a cloud browser, which only it can drive. To take over, switch it to a local headed browser in Settings, Plugins, Browser.',
  settingsTitle: 'Browser',
  settingsIntro:
    "Where each bot's browser runs. Cloud browsers can be watched but not taken over. A local headed browser opens on this machine's desktop, so you can take over and hand back.",
  settingsEmpty: 'No local bots yet.',
  settingsLoading: 'Checking…',
  settingsUnknown: 'Unknown',
  modeLocal: 'Local, headed',
  modeCloud: 'Cloud',
  modeOther: 'Custom',
  useLocal: 'Use local headed browser',
  useCloud: 'Back to cloud',
  confirmLocalTitle: 'Switch {bot} to a local headed browser?',
  confirmLocalBody:
    "{bot}'s browser tasks will open a visible browser on this machine's desktop, which you can take over. The current config is backed up first.",
  confirmCloudTitle: 'Switch {bot} back to its cloud browser?',
  confirmCloudBody: "{bot}'s browser tasks go back to the cloud browser it used before. The current config is backed up first.",
  confirmSwitch: 'Switch',
  switching: 'Switching…',
  switched: 'Switched',
  cancel: 'Cancel',
  backupSaved: 'Backup: {file}',
  modeFailed: "Couldn't change the browser: {error}"
}

export const BROWSER_LOCALES: PluginLocaleBundles = { en: { browser: BROWSER_EN } }

export type BrowserText = typeof BROWSER_EN

export function useBrowserText(): BrowserText {
  const t = usePluginI18n(i18nId())

  return bindTree(t, BROWSER_EN, 'browser') as BrowserText
}

/** The same strings outside React (notifications, the titlebar tool label). */
export function browserText(): BrowserText {
  const translate = getPluginCtx()?.i18n?.t

  if (!translate) {
    return BROWSER_EN
  }

  return bindTree(translate, BROWSER_EN, 'browser') as BrowserText
}
