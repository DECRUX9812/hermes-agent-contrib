import { runDemoFeed } from '../dev-harness/demo-feed'

import { setDemoScriptHandler } from './demo'

/**
 * The single composition point where the pane installs its default
 * `TaskExecutor`, `ConversationSource` and scripted demo feed (architecture §11).
 *
 * Only the scripted notify feed exists in this milestone; the executor and
 * conversation source arrive with later features. Nothing outside
 * `dev-harness/` may import the harness, so this seam exists before the rest of
 * the content and stays the one place that knows about it.
 */
export function installPane3dDefaults(): void {
  setDemoScriptHandler(script => {
    if (script === 'notify') {
      runDemoFeed()
    }
  })
}
