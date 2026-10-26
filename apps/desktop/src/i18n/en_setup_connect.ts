import type { SetupConnectTranslations } from './types_setup_connect'

export const enSetupConnect: SetupConnectTranslations = {
  steps: { identity: 'Sign in', model: 'Model', connect: 'Connect' },
  title: 'Connect your tools',
  intro: 'Both are optional. You can change them later in Settings.',
  github: {
    title: 'GitHub',
    desc: 'Lets Hermes clone, push and open pull requests as you.',
    signIn: 'Sign in with GitHub',
    signedIn: account => `Signed in as ${account}`,
    signedInNoName: 'Signed in',
    notInstalled: 'Install the GitHub CLI (gh) on this computer to sign in here.',
    codeLabel: 'Enter this code on GitHub',
    openPage: 'Open github.com/login/device',
    waiting: 'Waiting for you to approve on GitHub…',
    cancel: 'Cancel',
    failed: "GitHub sign-in didn't finish.",
    retry: 'Try again'
  },
  remote: {
    title: 'Remote access',
    desc: 'Open Hermes from your phone or another computer, behind your Nous sign-in.',
    localOnly: 'This computer only',
    localOnlyDesc: 'Nothing is exposed. The default.',
    tunnel: 'Quick tunnel',
    tunnelDesc: 'A free Cloudflare HTTPS address. It changes each time the tunnel starts.',
    start: 'Start tunnel',
    starting: 'Starting…',
    stop: 'Stop',
    running: 'Live at',
    stale: 'Web access still points at an old tunnel address. Start the tunnel again to refresh it.',
    noCloudflared: 'Install cloudflared on this computer to use a quick tunnel.',
    ownDomain: 'Use my own domain',
    hostOnly: 'Remote access is set up from Hermes Desktop on the computer running Hermes.',
    failed: "Couldn't start the tunnel"
  },
  skip: 'Skip for now',
  continue: 'Continue'
}
