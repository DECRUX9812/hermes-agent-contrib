/**
 * Plugin-scoped i18n for the Desk — bundles shipped under the plugin id via
 * ctx.i18n.register, never touching core en.ts. English first; more locales
 * can drop into DESK_LOCALES without touching the components.
 */

import { type PluginLocaleBundles, type PluginTranslate, usePluginI18n } from '@hermes/plugin-sdk'

export const PLUGIN_ID = 'hermes-office'

// A type alias, not an interface: the bundle is assigned to PluginMessages,
// which needs the implicit index signature only a type literal carries.
type DeskMessages = {
  acceptChanges: string
  accepted: (n: number) => string
  accepting: string
  addFolder: string
  addFolderTitle: string
  after: string
  back: string
  backendUnreachable: string
  before: string
  browse: string
  cancel: string
  cannotOpenExternal: string
  cellsChanged: (n: number) => string
  cellsShifted: (n: number) => string
  checkingEngines: string
  commentAnchor: (anchor: string) => string
  comments: string
  conversation: string
  conversationUnavailable: string
  daysAgo: (n: number) => string
  deckNoSlides: string
  description: string
  docNoText: string
  enginesMissing: (names: string) => string
  enginesOk: string
  events: (n: number) => string
  files: string
  filesChanged: (n: number) => string
  filesCount: (n: number) => string
  folderPathNeeded: string
  healthLine: (engines: string, libreoffice: string, version: string) => string
  hoursAgo: (n: number) => string
  justNow: string
  libreofficeNo: string
  libreofficeYes: string
  loadFailed: string
  minAgo: (n: number) => string
  nav: string
  needsYou: string
  needsYouCount: (n: number) => string
  newRequest: string
  newRequestFor: (name: string) => string
  noActivity: string
  noEvents: string
  noFiles: string
  noFolders: string
  noOriginal: string
  noRequests: string
  noSessionYet: string
  onYourDesk: string
  open: string
  openCommand: string
  openExcel: string
  openFolderPlaceholder: string
  openInWord: string
  openPowerPoint: string
  paragraphsChanged: (n: number) => string
  recent: string
  rejectChanges: string
  rejected: (n: number) => string
  rejecting: string
  requestExample: string
  requestNeeded: string
  requestsCount: (n: number) => string
  queuedSaved: string
  receipts: string
  retry: string
  review: string
  revert: string
  revertedAgo: (ago: string) => string
  revertConfirm: string
  reverting: string
  selectFile: string
  sheetsAdded: (names: string) => string
  sheetsRemoved: (names: string) => string
  sinceAgo: (ago: string) => string
  slide: (n: number) => string
  slidesAdded: (n: number) => string
  slidesMoved: (n: number) => string
  slidesRemoved: (n: number) => string
  started: string
  starting: string
  startRequest: string
  stateChanged: string
  stateCreated: string
  stateWorking: string
  statusDone: string
  statusError: string
  statusNeedsYou: string
  statusQueued: string
  statusRunning: string
  statusUnknown: (status: string) => string
  textChanges: (n: number) => string
  trackedChanges: (n: number) => string
  unavailableBody: string
  unavailableTitle: string
  unknownAuthor: string
  unknownFolder: string
  workbookNoSheets: string
}

export const en: DeskMessages = {
  acceptChanges: 'Accept changes',
  accepted: n => (n === 1 ? 'Accepted 1 change.' : `Accepted ${n} changes.`),
  accepting: 'Accepting…',
  addFolder: 'Add folder',
  addFolderTitle: 'Add a folder to your Desk',
  after: 'After',
  back: 'Desk',
  backendUnreachable: 'Backend unreachable',
  before: 'Before',
  browse: 'Browse…',
  cancel: 'Cancel',
  cannotOpenExternal: 'This window cannot open files with the system app.',
  cellsChanged: n => `${n} cell${n === 1 ? '' : 's'} changed`,
  cellsShifted: n => `${n} shifted`,
  checkingEngines: 'Checking the office engines…',
  commentAnchor: anchor => ` on “${anchor}”`,
  comments: 'Comments',
  conversation: 'Conversation',
  conversationUnavailable: 'The conversation is not available.',
  daysAgo: n => `${n} d ago`,
  deckNoSlides: 'This deck has no slides.',
  description: 'Office work on your folders: Word, Excel and PowerPoint edits with tracked changes, previews and receipts.',
  docNoText: 'This document has no text paragraphs.',
  enginesMissing: names => `Engines missing: ${names}`,
  enginesOk: 'Engines ok (docx, pptx, xlsx)',
  events: n => `Events (${n})`,
  files: 'Files',
  filesChanged: n => `${n} file${n === 1 ? '' : 's'} changed`,
  filesCount: n => `${n} file${n === 1 ? '' : 's'}`,
  folderPathNeeded: 'Enter the absolute path of a folder.',
  healthLine: (engines, libreoffice, version) => [engines, libreoffice, version].filter(Boolean).join(' · '),
  hoursAgo: n => `${n} h ago`,
  justNow: 'just now',
  libreofficeNo: 'LibreOffice no',
  libreofficeYes: 'LibreOffice yes',
  loadFailed: 'The Desk could not be loaded.',
  minAgo: n => `${n} min ago`,
  nav: 'Desk',
  needsYou: 'Needs you',
  needsYouCount: n => `${n} need you`,
  newRequest: 'New request',
  newRequestFor: name => `New request for ${name}`,
  noActivity: 'No activity recorded yet.',
  noEvents: 'No events yet.',
  noFiles: 'No files touched yet.',
  noFolders: 'No folders yet. Add a folder of Word, Excel or PowerPoint files to start.',
  noOriginal: 'No receipt yet, so there is no saved original to compare against.',
  noRequests: 'No requests yet. Start one from a folder above.',
  noSessionYet: 'No Hermes session is attached to this request yet.',
  onYourDesk: 'On your desk',
  open: 'Open',
  openCommand: 'Desk: Open the Desk',
  openExcel: 'Open in Excel',
  openFolderPlaceholder: '/path/to/a/folder',
  openInWord: 'Open in Word',
  openPowerPoint: 'Open in PowerPoint',
  paragraphsChanged: n => `${n} paragraph${n === 1 ? '' : 's'} changed`,
  recent: 'Recent',
  rejectChanges: 'Reject changes',
  rejected: n => (n === 1 ? 'Rejected 1 change.' : `Rejected ${n} changes.`),
  rejecting: 'Rejecting…',
  requestExample: 'e.g. Tighten the executive summary in the board memo and track the changes.',
  requestNeeded: 'Describe what you want done in this folder.',
  queuedSaved: 'The request is saved on the Desk as queued.',
  receipts: 'Receipts',
  requestsCount: n => `${n} request${n === 1 ? '' : 's'}`,
  retry: 'Retry',
  review: 'Review',
  revert: 'Revert',
  revertedAgo: ago => `reverted ${ago}`,
  revertConfirm: 'Restore the file from before this change?',
  reverting: 'Reverting…',
  selectFile: 'Select a file to preview it.',
  sheetsAdded: names => `sheets added: ${names}`,
  sheetsRemoved: names => `sheets removed: ${names}`,
  sinceAgo: ago => `since ${ago}`,
  slide: n => `Slide ${n}`,
  slidesAdded: n => `${n} slides added`,
  slidesMoved: n => `${n} moved`,
  slidesRemoved: n => `${n} removed`,
  started: 'Started',
  starting: 'Starting…',
  startRequest: 'Start',
  stateChanged: 'Changed',
  stateCreated: 'Created',
  stateWorking: 'Working',
  statusDone: 'Done',
  statusError: 'Error',
  statusNeedsYou: 'Needs you',
  statusQueued: 'Queued',
  statusRunning: 'Running',
  statusUnknown: status => status,
  textChanges: n => `${n} text change${n === 1 ? '' : 's'}`,
  trackedChanges: n => `${n} tracked change${n === 1 ? '' : 's'}`,
  unavailableBody:
    'This Hermes backend does not have the hermes-office plugin, so there is no Desk to show. Install it in your Hermes plugins directory, enable it in config.yaml, and reopen this page.',
  unavailableTitle: 'Desk needs the hermes-office plugin',
  unknownAuthor: 'Unknown',
  unknownFolder: 'Unknown folder',
  workbookNoSheets: 'This workbook has no sheets.'
}

export const DESK_LOCALES: PluginLocaleBundles = { en }

/** Reactive translator bound to this plugin's bundles. */
export function useDeskI18n(): PluginTranslate {
  return usePluginI18n(PLUGIN_ID)
}

export type { DeskMessages }
