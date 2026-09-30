// Matches every wording the backend has used for "no provider yet", including
// the CLI-oriented `Hermes is not connected to any AI provider yet. Run
// `hermes model`…` — onboarding's picker is the desktop's answer to it, so
// that text must never reach a first-run user as a banner.
const PROVIDER_SETUP_ERROR_RE =
  /No (?:inference|Hermes) provider(?: is)? configured|no_provider_configured|set an API key|not connected to any AI provider/i

const SESSION_INFO_CREDENTIAL_WARNING_RE = /^No API key configured for provider '[^']*'\. First message will fail\.$/

export function isProviderSetupErrorMessage(message: null | string | undefined): boolean {
  const text = message?.trim()

  if (!text) {
    return false
  }

  return PROVIDER_SETUP_ERROR_RE.test(text) || SESSION_INFO_CREDENTIAL_WARNING_RE.test(text)
}
