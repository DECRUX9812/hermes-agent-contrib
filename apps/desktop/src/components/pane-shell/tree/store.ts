/**
 * Layout tree store: one persisted tree replaces paneStates side/band
 * overrides. The DEFAULT tree is declared by the app root (like config);
 * the persisted tree is the user's customization; reset returns to default.
 *
 * Facade over the domain siblings: core (tree atom, persistence, presets,
 * mutations), hidden (chrome hides, dismissals, hide-only strip tabs),
 * shares (split-share memory), lifecycle (closer/opener/collapse/reset
 * registries), predicates (pane classification), groups (active/hovered
 * zone tracking), drag (drag/drop state), panes (adoption, dock
 * enforcement, side collapse, reveal/close/reset), tabs (tab-strip verbs).
 */

export * from './store-core'
export * from './store-drag'
export * from './store-groups'
export * from './store-hidden'
export * from './store-lifecycle'
export * from './store-panes'
export * from './store-predicates'
export * from './store-shares'
export * from './store-tabs'
