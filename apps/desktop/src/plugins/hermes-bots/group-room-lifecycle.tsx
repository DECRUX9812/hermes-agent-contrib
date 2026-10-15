/**
 * Room lifecycle: soft-disbanding a group chat — its memberships, room log,
 * stored state and open views — without touching the members' sessions.
 */

/**
 * The group-chat room surface: the merged room view, its settings dialog, the
 * MAIN-window tab it opens into, and the two room-lifecycle mutations that
 * surface drives — disband and rename.
 *
 * Disband and rename live here rather than beside the pane registry because a
 * rename re-opens the room's main tab, and that tab renders this file's
 * workspace: settings dialog → rename → open → main view → workspace is one
 * cycle, so it is one module. The tab registry and the composer drafts they
 * touch stay below, in `group-panes.ts`.
 */

import { queryClient } from '@hermes/plugin-sdk'

import {
  $botMeta,
  $lastRoster,
  botMetaV2Active,
  noteBotMetaWrite,
  persistBotMetaSnapshot,
  ROSTER_KEY,
  saveBotMeta
} from './data'
import {
  $groupChats,
  $groupChatWorkspace,
  $groupNeedsYou,
  rememberGroupChatTombstone,
  scheduleGroupChatServerSync
} from './group-chat'
import { groupDisbandMetadataPlan } from './group-membership'
import { closeGroupChatMainTab } from './group-panes'
import { clearGroupClarify } from './group-turns'
import { disbandHostedRoom, hostedRoomOwnerMember } from './hosted-room-log'
import { getPluginCtx } from './shared'
import type { GroupChat, RosterRow } from './types'

/** Soft-disband a group chat: remove only this group from every local member's
 *  membership list (the metadata syncs cross-machine via ui_meta), drop the
 *  room log from the atom + plugin storage, and close the room view if it's
 *  open. Other group memberships and the members' per-group gateway sessions
 *  ("Group: <roomId>", or legacy "Group: <name>") are intentionally KEPT. */
export async function disbandGroupChat(group: string, members: RosterRow[]) {
  // Invalidate any in-flight round-robin FIRST: bump the epoch so a running
  // drive bails at its next member boundary instead of appending to a room
  // the user just discarded.
  const all = {
    ...$groupChats.get()
  }

  const prior = all[group] || {}

  // The hosted Discussion owns this room once created. Retire it before the
  // renderer drops its local pointer, or a failed/offline write would leave
  // an orphaned backend room that can keep taking turns.
  if (prior.hostedRoomCreated && prior.roomId) {
    const owner = hostedRoomOwnerMember(prior, members)

    if (!owner) {
      throw new Error('The hosted room has no local owner for disband.')
    }

    await disbandHostedRoom(String(prior.roomId), owner)
  }

  const metaBefore = $botMeta.get()
  const cleanup = groupDisbandMetadataPlan(group, members, prior, $lastRoster.get(), metaBefore)
  let metadataPersistence: Promise<unknown> = Promise.resolve()

  if (cleanup.patches.size) {
    const nextMeta = {
      ...metaBefore
    }

    for (const [key, patch] of cleanup.patches) {
      nextMeta[key] = {
        ...(nextMeta[key] || {}),
        ...patch
      }
      noteBotMetaWrite(key)
    }

    // Paint the deletion before any remote write can stall. This also removes
    // orphaned legacy metadata that cannot safely be routed to a source.
    $botMeta.set(nextMeta)
    metadataPersistence = persistBotMetaSnapshot(
      nextMeta,
      botMetaV2Active || Object.keys(nextMeta).some(key => key.includes('::'))
    )
  }

  delete all[group]

  // Remember the disband durably BEFORE any remote write can stall: the
  // pending sync job alone forgets it once the retry ladder gives up or the
  // window closes, and a gateway mirror that missed the tombstone push would
  // resurrect the room on every later pull (#105275).
  await rememberGroupChatTombstone(group, prior.roomId, prior.syncRevision)

  // Keep a runtime-only tombstone while a drive may still be mid-turn; it
  // carries no log and is flagged so persistence and name-dedup skip it —
  // updateGroupChat writes the WHOLE atom map, so an unflagged tombstone
  // would be persisted by the next unrelated room write and its name would
  // count as taken, suffixing a same-name recreate to "<name> 2" forever.
  if (prior.running) {
    all[group] = {
      log: [],
      watermarks: {},
      sessions: {},
      epoch: (prior.epoch || 0) + 1,
      running: false,
      tombstone: true
    }
  }

  $groupChats.set(all)

  if ($groupChatWorkspace.get() === group) {
    $groupChatWorkspace.set(null)
  }

  // Retire the room's MAIN-window tab too (host.openWorkspace path).
  closeGroupChatMainTab(group)

  const needs = {
    ...$groupNeedsYou.get()
  }

  delete needs[group]
  $groupNeedsYou.set(needs)
  clearGroupClarify(group)

  // Persist the room map WITHOUT the disbanded room so it can't come back
  // on the next window load.
  try {
    const durable: Record<string, GroupChat> = {}

    for (const [name, room] of Object.entries($groupChats.get())) {
      if (name !== group && Array.isArray(room.log)) {
        durable[name] = {
          log: room.log,
          watermarks: room.watermarks,
          sessions: room.sessions || {},
          sessionOwners: room.sessionOwners || {},
          members: Array.isArray(room.members) ? room.members : [],
          roomId: typeof room.roomId === 'string' && room.roomId ? room.roomId : null,
          image: room.image || null,
          syncRevision: Math.max(0, Number(room.syncRevision || 0))
        }
      }
    }

    await Promise.resolve(getPluginCtx()?.storage?.set?.('group-chats', durable))
  } catch {
    /* storage unavailable — the atom reset above still empties the room */
  }

  scheduleGroupChatServerSync($groupChats.get(), {
    allowEmpty: true,
    deletedRooms: [group]
  })
  await metadataPersistence

  // Persist the cleanup to every exact owner we can prove. saveBotMeta never
  // throws (local storage + best-effort profiles.configure per owner), so a
  // flaky gateway cannot strand the local disband halfway.
  for (const [key, owner] of cleanup.owners) {
    const patch = cleanup.patches.get(key)

    if (patch) {
      await saveBotMeta(owner, patch)
    }
  }

  // Converge on server truth: the cached roster still carries the pre-disband
  // ui_meta (the write-fence in mergeServerMeta keeps it from resurrecting
  // the membership, but a fresh snapshot is what makes every surface agree).
  if (typeof queryClient !== 'undefined' && queryClient?.invalidateQueries) {
    queryClient.invalidateQueries({
      queryKey: ROSTER_KEY
    })
  }
}
