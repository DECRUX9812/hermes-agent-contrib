/** Deliverable states stay together rather than growing the roster's locale tree. */
export type DeliverablesMessages = {
  title: string
  empty: string
  refresh: string
  loading: string
  failed: string
  stale: string
  unavailable: string
}

export const DELIVERABLES_EN: DeliverablesMessages = {
  title: 'Deliverables',
  empty: 'Files, images and links from this bot’s work will appear here.',
  refresh: 'Refresh',
  loading: 'Loading deliverables…',
  failed: 'Could not load deliverables. Your work has not been removed.',
  stale: 'Could not refresh. Showing the last loaded deliverables.',
  unavailable: 'Deliverables are not available on this connection.'
}

export const DELIVERABLES_JA: DeliverablesMessages = {
  title: '成果物',
  empty: '成果物はまだありません。',
  refresh: '更新',
  loading: '成果物を読み込み中…',
  failed: '成果物を読み込めませんでした。作業内容は削除されていません。',
  stale: '更新できませんでした。前回読み込んだ成果物を表示しています。',
  unavailable: 'この接続では成果物を利用できません。'
}

export const DELIVERABLES_ZH: DeliverablesMessages = {
  title: '交付物',
  empty: '暂无交付物。',
  refresh: '刷新',
  loading: '正在加载交付物…',
  failed: '无法加载交付物。你的工作未被删除。',
  stale: '无法刷新。正在显示上次加载的交付物。',
  unavailable: '此连接不支持交付物。'
}

export const DELIVERABLES_ZH_HANT: DeliverablesMessages = {
  title: '交付物',
  empty: '暫無交付物。',
  refresh: '重新整理',
  loading: '正在載入交付物…',
  failed: '無法載入交付物。你的工作並未被刪除。',
  stale: '無法重新整理。正在顯示上次載入的交付物。',
  unavailable: '此連線不支援交付物。'
}
