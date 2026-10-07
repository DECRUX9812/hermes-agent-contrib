import type { DemoScript } from '../protocol'

/**
 * The seam between `store.applyPaneState` and the scripted dev harness
 * (architecture §11). The store handles the `demo` message but may not import
 * `dev-harness/`; `defaults.ts` — the single composition point — registers the
 * handler that runs the script.
 */
export type DemoScriptHandler = (script: DemoScript) => void

let handler: DemoScriptHandler | null = null

export function setDemoScriptHandler(next: DemoScriptHandler | null): void {
  handler = next
}

export function runDemoScript(script: DemoScript): void {
  handler?.(script)
}
