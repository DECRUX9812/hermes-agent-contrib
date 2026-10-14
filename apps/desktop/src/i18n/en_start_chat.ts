import type { StartChatCopy } from './types_start_chat'

export const enStartChat: StartChatCopy = {
  starting: title => `Starting “${title}”…`,
  startingUntitled: 'Starting a chat…',
  untitled: 'New chat',
  notStarted: "Couldn't start that chat.",
  retry: 'Retry',
  inProfile: profile => `In ${profile}`,
  open: 'Open',
  openFailed: "Couldn't open the chat"
}
