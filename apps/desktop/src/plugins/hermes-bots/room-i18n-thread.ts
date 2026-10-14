/**
 * Room strings: Message identity, event chips, working rows and the thread panel.
 * Every locale block carries every key; English is the fallback floor.
 */

export const THREAD_EN = {
  /** "<Name> is working" on the live working row, in the speaker's colour. */
  isWorking: (name: string) => `${name} is working`
}

export type THREADMessages = typeof THREAD_EN

export const THREAD_JA: THREADMessages = {
  isWorking: (name: string) => `${name} が作業中`
}

export const THREAD_ZH: THREADMessages = {
  isWorking: (name: string) => `${name} 正在工作`
}

export const THREAD_ZH_HANT: THREADMessages = {
  isWorking: (name: string) => `${name} 正在工作`
}
