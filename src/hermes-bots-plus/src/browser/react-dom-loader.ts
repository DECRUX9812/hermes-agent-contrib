/** A react-dom renderer for the floating window's own root. The plugin build
 *  swaps this module for a loader that reads the vendored copy (built against
 *  the host's React) on first use; tests and dev get the real package. */
export async function loadReactDom(): Promise<{ createRoot: typeof import('react-dom/client').createRoot }> {
  return import('react-dom/client')
}
