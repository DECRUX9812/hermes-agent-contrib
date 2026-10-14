import { useStore } from '@nanostores/react'

import { RecentProjects } from '@/components/chat/recent-projects'
import { $newSessionTabAction } from '@/components/pane-shell/tree/store'
import { $sessionTiles } from '@/store/session-states'

/** An empty session tile offers its recent projects. Picking one opens a session
 *  there in this tile's slot and retires the blank draft. Bot tiles keep their
 *  own profile, so they get no project shortcuts. */
export function BlankTileQuickStarts({ storedSessionId }: { storedSessionId: string }) {
  const tiles = useStore($sessionTiles)

  if (tiles.find(tile => tile.storedSessionId === storedSessionId)?.workspaceMode === 'bots') {
    return null
  }

  return (
    <RecentProjects
      onPick={cwd => $newSessionTabAction.get()?.({ cwd, replaceStoredSessionId: storedSessionId })}
    />
  )
}
