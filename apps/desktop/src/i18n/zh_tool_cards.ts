import type { ToolCardsCopy } from './types_tool_cards'

export const zhToolCards: ToolCardsCopy = {
  activityLabel: '工具活动',
  families: {
    browser: '浏览器',
    code: '代码',
    files: '文件',
    generic: '工具',
    mcp: '连接器',
    search: '搜索',
    terminal: '终端',
    web: '网页'
  },
  names: {
    memory: '记忆',
    message: '消息',
    schedule: '计划任务',
    skills: '技能',
    vision: '视觉'
  },
  usedTimes: (name, count) => `已使用 ${name} ×${count}`,
  usedTools: count => `已使用 ${count} 个工具`,
  working: '处理中…',
  awaitingApproval: '等待你的批准',
  reviewApproval: '查看',
  failed: '失败',
  stopped: '已停止',
  statuses: {
    browser_back: { done: '已返回', pending: '正在返回' },
    browser_console: { done: '已读取页面控制台', pending: '正在读取页面控制台' },
    browser_get_images: { done: '已收集页面图片', pending: '正在收集页面图片' },
    browser_press: { done: '已按键', pending: '正在按键' },
    browser_scroll: { done: '已滚动页面', pending: '正在滚动页面' },
    browser_vision: { done: '已查看页面', pending: '正在查看页面' }
  },
  details: {
    request: '请求',
    output: '输出',
    duration: '耗时',
    noOutput: '无输出'
  },
  argLabels: {
    code: '代码',
    command: '命令',
    input: '输入',
    path: '文件',
    query: '搜索',
    target: '目标',
    text: '文本',
    url: '地址'
  },
  viewer: {
    action: '操作',
    title: name => `${name}步骤`,
    step: (index, total) => `第 ${index} 步，共 ${total} 步`,
    noScreenshot: '此步骤没有截图',
    thumbnail: '截图',
    snapshot: 'DOM 快照',
    url: 'URL',
    previous: '上一步',
    next: '下一步'
  }
}
