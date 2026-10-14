/**
 * Group room strings, registered beside Bot Mode's bundles under the same
 * plugin id as `room.*`. The room's own chrome lives here; each area keeps
 * its keys in a sibling (`room-i18n-<area>.ts`) so the main catalog stops
 * growing. Every locale Bot Mode ships carries every key.
 */

import { type PluginLocaleBundles, usePluginI18n } from '@hermes/plugin-sdk'

import { LIST_EN, LIST_JA, LIST_ZH, LIST_ZH_HANT } from './room-i18n-list'
import { MEMBERS_EN, MEMBERS_JA, MEMBERS_ZH, MEMBERS_ZH_HANT } from './room-i18n-members'
import { THREAD_EN, THREAD_JA, THREAD_ZH, THREAD_ZH_HANT } from './room-i18n-thread'
import { ID } from './shared'
import { bindTree } from './team-i18n'

const CHROME_EN = {
  asideCollapse: 'Hide panel',
  asideExpand: 'Show panel',
  asideLabel: 'Room panel',
  asideResize: 'Resize panel',
  panelThreads: 'Threads',
  threadClose: 'Close thread'
}

type ChromeMessages = typeof CHROME_EN

const CHROME_JA: ChromeMessages = {
  asideCollapse: 'パネルを隠す',
  asideExpand: 'パネルを表示',
  asideLabel: 'ルームパネル',
  asideResize: 'パネルのサイズを変更',
  panelThreads: 'スレッド',
  threadClose: 'スレッドを閉じる'
}

const CHROME_ZH: ChromeMessages = {
  asideCollapse: '隐藏面板',
  asideExpand: '显示面板',
  asideLabel: '房间面板',
  asideResize: '调整面板大小',
  panelThreads: '话题',
  threadClose: '关闭话题'
}

const CHROME_ZH_HANT: ChromeMessages = {
  asideCollapse: '隱藏面板',
  asideExpand: '顯示面板',
  asideLabel: '房間面板',
  asideResize: '調整面板大小',
  panelThreads: '話題',
  threadClose: '關閉話題'
}

const ROOM_EN = { ...CHROME_EN, list: LIST_EN, members: MEMBERS_EN, thread: THREAD_EN }

export type RoomText = typeof ROOM_EN

export const ROOM_LOCALES: PluginLocaleBundles = {
  en: { room: ROOM_EN },
  ja: { room: { ...CHROME_JA, list: LIST_JA, members: MEMBERS_JA, thread: THREAD_JA } },
  zh: { room: { ...CHROME_ZH, list: LIST_ZH, members: MEMBERS_ZH, thread: THREAD_ZH } },
  'zh-hant': { room: { ...CHROME_ZH_HANT, list: LIST_ZH_HANT, members: MEMBERS_ZH_HANT, thread: THREAD_ZH_HANT } }
}

/** Typed access for the active locale: `r.asideExpand`, `r.members.…`. */
export function useRoomText(): RoomText {
  const t = usePluginI18n(ID)

  return bindTree(t, ROOM_EN, 'room') as RoomText
}
