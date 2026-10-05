/**
 * Pane-internal copy (not part of the app's i18n catalog — the 3D Pane is a
 * self-contained overlay). One module so strings are easy to find and change.
 */
export const PANE_COPY = {
  ask: 'Ask',
  feed: 'Feed',
  feedTitle: 'Activity feed — coming with the presence milestone',
  hide: 'Hide',
  summon: (name: string) => `Summon ${name}`,
  dismiss: (name: string) => `Hide ${name}`
}
