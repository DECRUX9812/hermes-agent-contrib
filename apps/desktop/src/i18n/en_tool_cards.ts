import type { ToolCardsCopy } from './types_tool_cards'

export const enToolCards: ToolCardsCopy = {
  activityLabel: 'Tool activity',
  families: {
    browser: 'Browser',
    code: 'Code',
    files: 'Files',
    generic: 'Tool',
    mcp: 'Connector',
    search: 'Search',
    terminal: 'Terminal',
    web: 'Web'
  },
  names: {
    memory: 'Memory',
    message: 'Messages',
    schedule: 'Schedule',
    skills: 'Skills',
    vision: 'Vision'
  },
  usedTimes: (name, count) => `Used ${name} ×${count}`,
  working: 'Working…',
  awaitingApproval: 'Waiting for your approval',
  reviewApproval: 'Review',
  failed: 'Failed',
  stopped: 'Stopped',
  statuses: {
    browser_back: { done: 'Went back', pending: 'Going back' },
    browser_console: { done: 'Read the page console', pending: 'Reading the page console' },
    browser_get_images: { done: 'Collected page images', pending: 'Collecting page images' },
    browser_press: { done: 'Pressed a key', pending: 'Pressing a key' },
    browser_scroll: { done: 'Scrolled the page', pending: 'Scrolling the page' },
    browser_vision: { done: 'Looked at the page', pending: 'Looking at the page' }
  },
  details: {
    request: 'Request',
    output: 'Output',
    duration: 'Took',
    noOutput: 'No output'
  },
  argLabels: {
    code: 'Code',
    command: 'Command',
    input: 'Input',
    path: 'File',
    query: 'Search',
    target: 'Target',
    text: 'Text',
    url: 'Address'
  },
  viewer: {
    title: name => `${name} steps`,
    step: (index, total) => `Step ${index} of ${total}`,
    noScreenshot: 'No screenshot for this step',
    previous: 'Previous step',
    next: 'Next step'
  }
}
