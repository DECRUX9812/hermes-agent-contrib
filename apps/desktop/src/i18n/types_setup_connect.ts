export interface SetupConnectTranslations {
  steps: { identity: string; model: string; connect: string }
  title: string
  intro: string
  github: {
    title: string
    desc: string
    signIn: string
    signedIn: (account: string) => string
    signedInNoName: string
    notInstalled: string
    codeLabel: string
    openPage: string
    waiting: string
    cancel: string
    failed: string
    retry: string
  }
  remote: {
    title: string
    desc: string
    localOnly: string
    localOnlyDesc: string
    tunnel: string
    tunnelDesc: string
    start: string
    starting: string
    stop: string
    running: string
    stale: string
    noCloudflared: string
    ownDomain: string
    hostOnly: string
    failed: string
  }
  skip: string
  continue: string
}
