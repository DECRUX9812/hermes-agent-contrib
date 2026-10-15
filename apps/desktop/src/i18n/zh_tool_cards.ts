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
  working: '处理中…',
  awaitingApproval: '等待你的批准',
  reviewApproval: '查看',
  failed: '失败',
  stopped: '已停止',
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
    title: name => `${name}步骤`,
    step: (index, total) => `第 ${index} 步，共 ${total} 步`,
    noScreenshot: '此步骤没有截图',
    previous: '上一步',
    next: '下一步'
  }
}
