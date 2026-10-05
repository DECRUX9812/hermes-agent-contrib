/**
 * Pane-internal copy (not part of the app's i18n catalog — the 3D Pane is a
 * self-contained overlay). One module so strings are easy to find and change.
 */
export const PANE_COPY = {
  ask: 'Ask',
  closeFeed: 'Close activity feed',
  devHarness: 'Dev harness',
  dismissNotification: 'Dismiss notification',
  feed: 'Activity feed',
  feedEmpty: 'No activity yet',
  hide: 'Hide',
  less: 'less',
  more: 'more',
  summon: (name: string) => `Summon ${name}`,
  dismiss: (name: string) => `Hide ${name}`
}
