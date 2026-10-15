import type { ToolCardsCopy } from './types_tool_cards'

export const jaToolCards: ToolCardsCopy = {
  activityLabel: 'ツールの動作',
  families: {
    browser: 'ブラウザ',
    code: 'コード',
    files: 'ファイル',
    generic: 'ツール',
    mcp: 'コネクタ',
    search: '検索',
    terminal: 'ターミナル',
    web: 'Web'
  },
  names: {
    memory: 'メモリ',
    message: 'メッセージ',
    schedule: 'スケジュール',
    skills: 'スキル',
    vision: 'ビジョン'
  },
  usedTimes: (name, count) => `${name} ×${count} 回使用`,
  usedTools: count => `${count} 個のツールを使用`,
  working: '処理中…',
  awaitingApproval: '承認待ち',
  reviewApproval: '確認',
  failed: '失敗',
  stopped: '停止しました',
  statuses: {
    browser_back: { done: '戻りました', pending: '戻っています' },
    browser_console: { done: 'ページのコンソールを読みました', pending: 'ページのコンソールを読んでいます' },
    browser_get_images: { done: 'ページの画像を集めました', pending: 'ページの画像を集めています' },
    browser_press: { done: 'キーを押しました', pending: 'キーを押しています' },
    browser_scroll: { done: 'ページをスクロールしました', pending: 'ページをスクロールしています' },
    browser_vision: { done: 'ページを確認しました', pending: 'ページを確認しています' }
  },
  details: {
    request: 'リクエスト',
    output: '出力',
    duration: '所要時間',
    noOutput: '出力なし'
  },
  argLabels: {
    code: 'コード',
    command: 'コマンド',
    input: '入力',
    path: 'ファイル',
    query: '検索',
    target: '対象',
    text: 'テキスト',
    url: 'アドレス'
  },
  viewer: {
    action: '操作',
    title: name => `${name}のステップ`,
    step: (index, total) => `ステップ ${index} / ${total}`,
    noScreenshot: 'このステップのスクリーンショットはありません',
    thumbnail: 'スクリーンショット',
    snapshot: 'DOM スナップショット',
    url: 'URL',
    previous: '前のステップ',
    next: '次のステップ'
  }
}
