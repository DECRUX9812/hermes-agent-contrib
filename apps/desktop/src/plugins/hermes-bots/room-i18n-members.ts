/**
 * Room strings: The members panel, strip and member card.
 * Every locale block carries every key; English is the fallback floor.
 */

export const MEMBERS_EN = {
  tab: 'Members',
  title: 'Members',
  manage: 'Manage members',
  showMembers: 'Show members',
  hideMembers: 'Hide members',
  empty: 'No members yet',
  lead: 'Lead',
  waiting: 'Waiting on you',
  working: 'Working',
  idle: 'Idle',
  offline: 'Unreachable',
  needsAnswer: 'Needs your answer',
  needsApproval: 'Needs your approval',
  workingTool: (tool: string) => `Running ${tool}`,
  idleShow: (count: number) => `Show ${count} idle`,
  idleHide: 'Hide idle',
  cardLabel: (name: string) => `${name}, details`,
  mention: 'Mention',
  openChat: 'Open chat',
  stop: 'Stop',
  makeLead: 'Make lead',
  everyoneListens: 'Everyone listens'
}

export type MEMBERSMessages = typeof MEMBERS_EN

export const MEMBERS_JA: MEMBERSMessages = {
  tab: 'メンバー',
  title: 'メンバー',
  manage: 'メンバーを管理',
  showMembers: 'メンバーを表示',
  hideMembers: 'メンバーを隠す',
  empty: 'まだメンバーがいません',
  lead: 'リード',
  waiting: 'あなたの返答待ち',
  working: '作業中',
  idle: '待機中',
  offline: '応答なし',
  needsAnswer: 'あなたの回答が必要',
  needsApproval: 'あなたの承認が必要',
  workingTool: (tool: string) => `${tool} を実行中`,
  idleShow: (count: number) => `待機中の ${count} 人を表示`,
  idleHide: '待機中を隠す',
  cardLabel: (name: string) => `${name} の詳細`,
  mention: 'メンション',
  openChat: 'チャットを開く',
  stop: '停止',
  makeLead: 'リードにする',
  everyoneListens: '全員が聞く'
}

export const MEMBERS_ZH: MEMBERSMessages = {
  tab: '成员',
  title: '成员',
  manage: '管理成员',
  showMembers: '显示成员',
  hideMembers: '隐藏成员',
  empty: '还没有成员',
  lead: '负责人',
  waiting: '等待你处理',
  working: '工作中',
  idle: '空闲',
  offline: '无法连接',
  needsAnswer: '需要你回答',
  needsApproval: '需要你批准',
  workingTool: (tool: string) => `正在运行 ${tool}`,
  idleShow: (count: number) => `显示 ${count} 位空闲成员`,
  idleHide: '隐藏空闲成员',
  cardLabel: (name: string) => `${name} 的详情`,
  mention: '提及',
  openChat: '打开聊天',
  stop: '停止',
  makeLead: '设为负责人',
  everyoneListens: '全员倾听'
}

export const MEMBERS_ZH_HANT: MEMBERSMessages = {
  tab: '成員',
  title: '成員',
  manage: '管理成員',
  showMembers: '顯示成員',
  hideMembers: '隱藏成員',
  empty: '還沒有成員',
  lead: '負責人',
  waiting: '等待你處理',
  working: '工作中',
  idle: '閒置',
  offline: '無法連線',
  needsAnswer: '需要你回答',
  needsApproval: '需要你批准',
  workingTool: (tool: string) => `正在執行 ${tool}`,
  idleShow: (count: number) => `顯示 ${count} 位閒置成員`,
  idleHide: '隱藏閒置成員',
  cardLabel: (name: string) => `${name} 的詳情`,
  mention: '提及',
  openChat: '開啟聊天',
  stop: '停止',
  makeLead: '設為負責人',
  everyoneListens: '全員聆聽'
}
