import { scriptedConversation } from '../dev-harness/conversation-script'
import { runDemoFeed } from '../dev-harness/demo-feed'
import { DevHarnessExecutor } from '../dev-harness/dev-executor'
import { playLaunchDemo } from '../dev-harness/launch-demo'

import { installChartPresenter } from './chart-live'
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
  setTaskSubmitter((avatar, text, context, demo) => {
    submitTask(avatar, text, context, demo)
  })
  // The result card's "Show chart" exists only while a presenter is registered
  // (architecture §8.7/§8.9), and the launch demo's result presents its chart
  // automatically through the same seam.
  installChartPresenter()
  setDemoScriptHandler(script => {
    if (script === 'launch') {
      playLaunchDemo()

      return
    }

    if (script === 'notify') {
      runDemoFeed()
    }
  })
}
