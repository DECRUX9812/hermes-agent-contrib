/** Live tool activity cards (Bot Mode DMs and group rooms). */
export interface ToolCardsCopy {
  /** Accessible name of a stack of cards. */
  activityLabel: string
  /** Human name per tool family, shown in bold on the card. */
  families: {
    browser: string
    code: string
    files: string
    generic: string
    mcp: string
    search: string
    terminal: string
    web: string
  }
  /** Names for well-known tools that fall in the generic family. */
  names: {
    memory: string
    message: string
    schedule: string
    skills: string
    vision: string
  }
  /** A settled run of the same tool: "Used Browser ×3". */
  usedTimes: (name: string, count: number) => string
  /** Status while a call has no better line yet. */
  working: string
  awaitingApproval: string
  reviewApproval: string
  failed: string
  stopped: string
  showDetails: string
  hideDetails: string
  /** Detail rows inside an expanded card. */
  details: {
    request: string
    output: string
    duration: string
    noOutput: string
  }
  /** Labels for the human summary of a call's arguments. */
  argLabels: {
    code: string
    command: string
    input: string
    path: string
    query: string
    target: string
    text: string
    url: string
  }
  /** The browser steps viewer. */
  viewer: {
    title: (name: string) => string
    step: (index: number, total: number) => string
    noScreenshot: string
    previous: string
    next: string
  }
}
