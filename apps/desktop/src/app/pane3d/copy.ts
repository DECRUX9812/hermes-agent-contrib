/**
 * Pane-internal copy (not part of the app's i18n catalog — the 3D Pane is a
 * self-contained overlay). One module so strings are easy to find and change.
 */
export const PANE_COPY = {
  ask: 'Ask',
  closeComposer: 'Close composer',
  composerHint: 'Enter to send · Shift+Enter for a new line · Esc to close',
  composerPlaceholder: (name: string) => `Ask ${name} to build, copy or explain this…`,
  closeFeed: 'Close activity feed',
  devHarness: 'Dev harness',
  dismissNotification: 'Dismiss notification',
  feed: 'Activity feed',
  feedEmpty: 'No activity yet',
  hide: 'Hide',
  less: 'less',
  more: 'more',
  removeContext: (label: string) => `Remove ${label} context`,
  showChart: 'Show chart',
  taskClose: 'Close card',
  taskErrorTitle: 'Could not finish that',
  taskWorking: 'Working…',
  summon: (name: string) => `Summon ${name}`,
  dismiss: (name: string) => `Hide ${name}`
}
