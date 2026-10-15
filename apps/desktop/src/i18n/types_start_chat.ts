/** Fork-only: start_chat tool copy (retired upstream, ported to fork.onboarding). */
export interface StartChatCopy {
  starting: (title: string) => string
  startingUntitled: string
  untitled: string
  notStarted: string
  retry: string
  inProfile: (profile: string) => string
  open: string
  openFailed: string
}
