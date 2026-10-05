import { scriptedConversation } from '../dev-harness/conversation-script'
import { runDemoFeed } from '../dev-harness/demo-feed'

import { setDemoScriptHandler } from './demo'
import { setConversationSource } from './room'

/**
 * The single composition point where the pane installs its default
 * `TaskExecutor`, `ConversationSource` and scripted demo feed (architecture §11).
 *
 * The scripted notify feed and the scripted conversation source exist in this
 * milestone; the executor arrives with a later feature. Nothing outside
 * `dev-harness/` may import the harness, so this seam exists before the rest of
 * the content and stays the one place that knows about it.
 */
export function installPane3dDefaults(): void {
  setConversationSource(scriptedConversation)
  setDemoScriptHandler(script => {
    if (script === 'notify') {
      runDemoFeed()
    }
  })
}
