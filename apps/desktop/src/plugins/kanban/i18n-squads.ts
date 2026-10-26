/**
 * Squads strings, one section of the kanban plugin bundle (`k.squads.*`).
 * Kept beside i18n.ts so the board's own bundle stays readable.
 */

// A type alias, not an interface: plugin bundles need the implicit index signature.
export type SquadsMessages = {
  toggle: string
  title: string
  intro: string
  team: string
  setUp: string
  ready: string
  notSetUp: string
  setUpDone: (profile: string) => string
  start: string
  template: string
  goal: string
  goalPlaceholder: string
  launch: string
  setupNote: string
  started: (name: string) => string
  runs: string
  noRuns: string
  progress: (done: number, total: number) => string
  state: { attention: string; done: string; queued: string; running: string }
  final: string
  waitingOn: (steps: string) => string
  openTask: (title: string) => string
  notes: string
  noNotes: string
  notePlaceholder: string
  send: string
  back: string
}

export const squadsEn: SquadsMessages = {
  toggle: 'Squads',
  title: 'Squads',
  intro: 'A squad is a small team of agents working one goal together. Each step runs as a card on this board.',
  team: 'Team',
  setUp: 'Set up',
  ready: 'Ready',
  notSetUp: 'Not set up',
  setUpDone: profile => `Created teammate ${profile}`,
  start: 'Start a squad',
  template: 'Playbook',
  goal: 'Goal',
  goalPlaceholder: 'What should the squad deliver?',
  launch: 'Start squad',
  setupNote: 'Teammates that are not set up yet are created when the squad starts.',
  started: name => `${name} squad started`,
  runs: 'Recent squads',
  noRuns: 'No squads yet. Start one above.',
  progress: (done, total) => `${done}/${total} steps done`,
  state: { attention: 'Needs you', done: 'Done', queued: 'Queued', running: 'Working' },
  final: 'Deliverable',
  waitingOn: steps => `Waiting on ${steps}`,
  openTask: title => `Open ${title}`,
  notes: 'Squad notes',
  noNotes: 'No notes yet. Notes reach every teammate.',
  notePlaceholder: 'Leave a note for the squad…',
  send: 'Send',
  back: 'All squads'
}

export const squadsJa: SquadsMessages = {
  toggle: 'スクワッド',
  title: 'スクワッド',
  intro: 'スクワッドは、1 つの目標に一緒に取り組むエージェントの小さなチームです。各ステップはこのボードのカードとして実行されます。',
  team: 'チーム',
  setUp: 'セットアップ',
  ready: '準備完了',
  notSetUp: '未セットアップ',
  setUpDone: profile => `メンバー ${profile} を作成しました`,
  start: 'スクワッドを開始',
  template: 'プレイブック',
  goal: '目標',
  goalPlaceholder: 'スクワッドに何を届けてほしいですか？',
  launch: 'スクワッドを開始',
  setupNote: '未セットアップのメンバーはスクワッド開始時に作成されます。',
  started: name => `${name} スクワッドを開始しました`,
  runs: '最近のスクワッド',
  noRuns: 'まだスクワッドはありません。上から開始してください。',
  progress: (done, total) => `${done}/${total} ステップ完了`,
  state: { attention: '対応が必要', done: '完了', queued: '待機中', running: '作業中' },
  final: '成果物',
  waitingOn: steps => `${steps} を待機中`,
  openTask: title => `${title} を開く`,
  notes: 'スクワッドのメモ',
  noNotes: 'まだメモはありません。メモはすべてのメンバーに届きます。',
  notePlaceholder: 'スクワッドへのメモ…',
  send: '送信',
  back: 'すべてのスクワッド'
}

export const squadsZh: SquadsMessages = {
  toggle: '小队',
  title: '小队',
  intro: '小队是围绕一个目标协作的一小组智能体。每个步骤都作为此看板上的卡片运行。',
  team: '成员',
  setUp: '设置',
  ready: '就绪',
  notSetUp: '未设置',
  setUpDone: profile => `已创建成员 ${profile}`,
  start: '启动小队',
  template: '剧本',
  goal: '目标',
  goalPlaceholder: '小队需要交付什么？',
  launch: '启动小队',
  setupNote: '尚未设置的成员会在小队启动时自动创建。',
  started: name => `${name} 小队已启动`,
  runs: '最近的小队',
  noRuns: '还没有小队。在上方启动一个。',
  progress: (done, total) => `已完成 ${done}/${total} 步`,
  state: { attention: '需要你处理', done: '已完成', queued: '排队中', running: '进行中' },
  final: '交付物',
  waitingOn: steps => `等待 ${steps}`,
  openTask: title => `打开 ${title}`,
  notes: '小队留言',
  noNotes: '还没有留言。留言会发给每位成员。',
  notePlaceholder: '给小队留言…',
  send: '发送',
  back: '全部小队'
}

export const squadsZhHant: SquadsMessages = {
  toggle: '小隊',
  title: '小隊',
  intro: '小隊是圍繞一個目標協作的一小組代理。每個步驟都作為此面板上的卡片執行。',
  team: '成員',
  setUp: '設定',
  ready: '就緒',
  notSetUp: '未設定',
  setUpDone: profile => `已建立成員 ${profile}`,
  start: '啟動小隊',
  template: '劇本',
  goal: '目標',
  goalPlaceholder: '小隊需要交付什麼？',
  launch: '啟動小隊',
  setupNote: '尚未設定的成員會在小隊啟動時自動建立。',
  started: name => `${name} 小隊已啟動`,
  runs: '最近的小隊',
  noRuns: '還沒有小隊。在上方啟動一個。',
  progress: (done, total) => `已完成 ${done}/${total} 步`,
  state: { attention: '需要你處理', done: '已完成', queued: '排隊中', running: '進行中' },
  final: '交付物',
  waitingOn: steps => `等待 ${steps}`,
  openTask: title => `開啟 ${title}`,
  notes: '小隊留言',
  noNotes: '還沒有留言。留言會傳給每位成員。',
  notePlaceholder: '給小隊留言…',
  send: '傳送',
  back: '全部小隊'
}
