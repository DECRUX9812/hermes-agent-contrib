import { host, useValue } from '@hermes/plugin-sdk'

import { groupMemberKey, groupSessionKey } from './group-membership'
import { liveTool } from './live-status'
import type { GroupMember } from './types'

type StatusItems = Parameters<typeof liveTool>[0]

/** The tool each live member is running now, keyed by member key. A member
 *  live on several threads reads from the first one that has a tool running. */
export function useMemberTools(
  sessions: Readonly<Record<string, string | true>> | undefined,
  liveWork: ReadonlyMap<string, ReadonlySet<string>>,
  members: readonly GroupMember[]
): ReadonlyMap<string, string> {
  const statusItems = (useValue(host.state.statusItemsBySession) || {}) as Record<string, StatusItems>
  const storedByRuntime = (useValue(host.state.storedSessionByRuntimeId) || {}) as Record<string, string>
  const runtimeByStored = new Map(Object.entries(storedByRuntime).map(([runtime, stored]) => [stored, runtime]))
  const tools = new Map<string, string>()

  for (const member of members) {
    for (const [thread, names] of liveWork) {
      if (!names.has(member.name)) {
        continue
      }

      const stored = sessions?.[groupSessionKey(thread, member)]
      const runtime = typeof stored === 'string' ? runtimeByStored.get(stored) || stored : null
      const tool = runtime ? liveTool(statusItems[runtime]) : undefined

      if (tool) {
        tools.set(groupMemberKey(member), tool)

        break
      }
    }
  }

  return tools
}
