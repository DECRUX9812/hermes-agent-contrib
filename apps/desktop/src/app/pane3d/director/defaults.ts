import { scriptedConversation } from '../dev-harness/conversation-script'
import { runDemoFeed } from '../dev-harness/demo-feed'
import { DevHarnessExecutor } from '../dev-harness/dev-executor'

import { setTaskSubmitter } from './composer'
import { setDemoScriptHandler } from './demo'
import { setConversationSource } from './room'
import { setTaskExecutor, submitTask } from './tasks'

/**
 * The single composition point where the pane installs its default
 * `TaskExecutor`, `ConversationSource` and scripted demo feed (architecture §11).
 *
 * Everything scripted lives in `dev-harness/`; this is the one module that
 * knows about it, and `pane-app.tsx` imports it once. It also wires the
 * composer's submit seam: the text and the effective context (removed chips
 * excluded) go straight into a task session.
 */
export function installPane3dDefaults(): void {
  setConversationSource(scriptedConversation)
  setTaskExecutor(new DevHarnessExecutor())
  setTaskSubmitter((avatar, text, context) => {
    submitTask(avatar, text, context)
  })
  setDemoScriptHandler(script => {
    if (script === 'notify') {
      runDemoFeed()
    }
  })
}
