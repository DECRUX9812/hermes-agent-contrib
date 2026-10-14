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
  showDetails: 'Show details',
  hideDetails: 'Hide details',
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
