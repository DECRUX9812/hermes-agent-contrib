/**
 * Message SHAPE for Bot Mode's plugin-scoped i18n bundles (see `./i18n.ts`).
 */

import { type CanonicalGroupMessages } from './canonical-group-locales'

/** Strings for the per-session activity feed. */
export type SessionActivityMessages = {
  title: string
  pickSession: string
  noSessions: string
  noSessionsHint: string
  emptyTitle: string
  emptyHint: string
  loading: string
  failed: string
  retry: string
  loadOlder: string
  count: (count: number) => string
  updated: string
  running: string
  succeeded: string
  failedStatus: string
  cancelled: string
  expired: string
  waiting: string
  approvalTitle: string
  approvalHint: string
  answer: string
  answering: string
  approvalApproved: string
  approvalDenied: string
  approvalExpired: string
  openChat: string
  explaining: string
  explainBody: string
  sessionsLabel: string
}

export type BotsMessages = {
  sessionActivity: SessionActivityMessages
  canonical: { [K in keyof CanonicalGroupMessages]: string }
  /** Left rail: the bot + group-chat roster. */
  editor: {
    fullConfigHint: string
    liveCapabilities: string
    editSoul: string
    remoteCapabilitiesHint: string
    skillsEnabled: (enabled: number, total: number) => string
    toolsetsEnabled: (enabled: number, total: number) => string
    mcpServers: string
    providerCustom: string
    modelCustom: string
    backToDropdowns: string
    inheritLaunch: string
    enterManually: string
    gatewayDefault: string
    modelNameExample: string
    /** The Title field's example name, shown as its placeholder. */
    titleExample: string
    modelSwitchFailed: string
    newDescription: string
    name: string
    title: string
    description: string
    createOn: string
    general: string
    capabilities: string
    skills: string
    tools: string
    cloneFrom: string
    freshProfile: string
    inheritedModel: string
    soul: string
    shareKeys: string
    shareKeysOn: (target: string) => string
    shareKeysHint: string
    needsModel: string
    configureModel: string
    createEmpty: string
    nameTakenHint: string
    nameFirstHint: string
    newerDesktop: string
    newerGateway: string
    emptySkillsHint: string
    defaultToolsHint: string
    catalog: string
    catalogInstalled: string
    mcpHint: string
    creating: string
    createBot: string
    auto: string
    autoHint: string
    unlock: string
    lockFace: string
    lockedHint: string
    unlockedHint: string
    noImageModel: string
    checkingImage: string
    chooseImage: string
    editDescription: (name: string, profile: string) => string
    nameTaken: (name: string) => string
    nameTakenOn: (name: string, target: string) => string
    currentConnection: (name: string) => string
    remoteHint: (target: string) => string
    cloneFromOn: (target: string) => string
    catalogHint: (source: string) => string
    sectionsFailed: (sections: string) => string
    updated: (name: string) => string
    created: (name: string) => string
    createdOn: (name: string, target: string) => string
  }
  roster: {
    search: string
    searchPlaceholder: string
    newBotOrGroup: string
    groupChats: string
    emptyTitle: string
    emptyDesc: string
    noMatchQuery: (query: string) => string
    noMatchQueryOn: (query: string, gateway: string) => string
    noMatchFiltersOn: (gateway: string) => string
    noMatchFilters: string
    clearFilters: string
    allHidden: string
    hidden: string
    allHiddenDesc: string
    showHidden: string
    hideHidden: string
    noHiddenMatch: string
    pinned: string
    needsAttention: string
    needsInput: string
    /** The kind filter's three options, in menu order. */
    botsAndGroups: string
    botsOnly: string
    groupsOnly: string
    /** Section header above the roster list itself (the list is bots; group
     *  chats sit in their own section). */
    botsHeading: string
    /** Accessible name of the activity-toast toggle (icon-only). */
    activityToastsOn: string
    activityToastsOff: string
    /** The gateway filter's "every source" option. */
    allGateways: string
    /** The activity filter's four options, in menu order. */
    anyActivity: string
    activeNow: string
    recentlyActive: string
    older: string
    /** How a row's owning gateway is doing — see `botSourceStatus`. */
    gatewayRemoved: string
    onDemand: string
    ready: string
    statusUnknown: string
    unavailable: string
    retryNow: string
    rosterUnavailable: (reason: string) => string
    waitingForGateway: string
  }
  /** User-made roster sections (folders the user files bots into). */
  sections: {
    newSection: string
    newTitle: string
    renameTitle: string
    nameLabel: string
    namePlaceholder: string
    create: string
    rename: string
    moveUp: string
    moveDown: string
    unassigned: string
    options: (name: string) => string
    headingTip: string
    emptyHint: string
    moveTo: string
    newSectionEllipsis: string
    removeFromSection: string
    deleted: (name: string, count: number) => string
    undo: string
  }
  /** Creating, editing and removing a bot. */
  bot: {
    newTitle: string
    editTitle: string
    editMenu: string
    helpPromptPlaceholder: string
    descriptionHint: string
    newChatWith: string
    /** Re-opens the forever-chat on purpose. A plain row click only returns to
     *  the tabs already open, so a closed Bot Chat needs an explicit ask. */
    openBotChat: string
    openBotChatInNewTab: string
    /** Screen-reader label for the row spinner while a cold bot chat opens. */
    openingChat: string
    /** Row context menu: pin/hide toggles, their toasts, and the groups entry. */
    pinToTop: string
    unpin: string
    pinnedToast: (name: string) => string
    unpinnedToast: (name: string) => string
    hide: string
    unhide: string
    hiddenToast: (name: string) => string
    unhiddenToast: (name: string) => string
    groupsMenu: (groups: string) => string
    manageGroups: string
    metadataLoadFailed: string
    loadFailed: string
    groupsLoadFailed: string
    thisDevice: string
    /** Roster badge tooltips per attention class; `attentionFallback` when the class is unknown. */
    attentionFallback: string
    attentionProviderAuth: string
    attentionQuota: string
    attentionMissingConfig: string
    attentionBlocked: string
    duplicate: string
    duplicateFailed: string
    /** Row context menu: re-opening the freshest listed session for this bot. */
    openRecentSession: string
    duplicating: (name: string) => string
    /** Names what a duplicate actually got: the look, never the chat. */
    duplicated: (name: string, original: string) => string
    /** Typed failure from `duplicateBot` — the caller translates this code. */
    duplicateNoFreeName: string
    deleteTitle: string
    /** The delete confirmation's sentence around the bolded name and the
     *  monospaced profile path: prefix + name + pathPrefix + path + suffix.
     *  Split so a language can order the fragments it needs. */
    deleteDescPrefix: string
    deleteDescPathPrefix: string
    deleteDescSuffix: string
    removeFromAllGroups: string
    createFirstHint: string
    createFailed: string
    draftDiscarded: (name: string) => string
    draftCleanupFailed: (name: string) => string
    advanced: string
    advancedHint: string
    advancedFailed: string
    openAnotherChatUnsupported: string
    remoteConnectionsUnsupported: string
    /** Bot-open failure toasts (canonical-chat.ts notifyBotOpenFailure). The
     *  raw RPC/connection error travels in the toast `detail`, never here. */
    openNeedsUpdateTitle: string
    openNeedsUpdateMessage: (connectionLabel: string) => string
    openUnreachableTitle: string
    openUnreachableMessage: string
    openChatFailedTitle: (botName: string) => string
    openChatFailedMessage: string
    /** Localized fallback when a session tab refuses to open. */
    openSessionFailed: string
    openGateways: string
    /** Stands under the bot's name in a chat it has not spoken in yet. */
    chatEmpty: string
    /** First line of a brand-new bot's forever-chat — see `kickoffText`. */
    kickoff: string
    /** Composer `/new` (or `/reset`) inside a canonical bot chat: a toast
     *  saying the turn became `/compact` instead of forking the chat. */
    newBlockedTitle: string
    newBlockedMessage: string
  }
  /** Avatar picker: shapes, blobs, pets, uploads, generation. */
  avatar: {
    classicShapes: string
    blobFromName: string
    unlockFollowsName: string
    randomize: string
    /** The picker's four tabs, in order. */
    tabBot: string
    tabGenerate: string
    upload: string
    tabPet: string
    removeImage: string
    removeBackToShape: string
    describePlaceholder: string
    describeHint: string
    matchTheName: string
    pickPet: string
    /** Empty pet gallery: says how to get a pet (`hermes pets` is a command,
     *  so it stays as written in every locale). */
    noPetsGallery: string
    noPetsMatch: string
    petLoadFailed: string
    imageTooLarge: string
    generationFailed: string
    savedLocally: string
    savedLocallyDescriptionFailed: string
    generate: string
    generating: string
  }
  /** Group chats: the room, its composer, threads and activity feed. */
  group: {
    newTitle: string
    manageDesc: string
    manageTitle: string
    /** Submit of the manage-members form's "create a new group" row. */
    createAndJoin: string
    /** The room's "Manage members" picker: title, capped-count hint, save. */
    membersTitle: string
    membersDesc: (max: number, group: string) => string
    membersSave: string
    membersSaveFailed: string
    settingsTitle: string
    settingsDesc: string
    nameLabel: string
    holdDetection: string
    holdDetectionHint: string
    compressHistory: string
    compressHistoryHint: (member: string) => string
    compressing: (member: string) => string
    compressDone: (member: string, compressed: number, detail: string) => string
    compressNothing: (member: string) => string
    compressFailed: (member: string, error: string) => string
    searchToAdd: string
    searchToAddPlaceholder: string
    removeFromSelection: string
    disbandTitle: string
    deleteTitle: string
    deleteAction: string
    composerPlaceholder: string
    jumpToLatest: (count: number) => string
    dayToday: string
    dayYesterday: string
    slashCommandsUnsupported: string
    attachHint: string
    newThread: string
    reply: string
    replyInThread: string
    replyInThreadPlaceholder: string
    openThread: string
    collapseThread: string
    collapseThreadLabel: string
    activity: string
    noActivityYet: string
    showActivity: string
    hideActivity: string
    stop: string
    stopHint: string
    allHeldStatus: (count: number) => string
    heldMembersStatus: (members: string) => string
    holdReleaseHint: string
    needsYourInput: string
    noMembersToSend: (group: string) => string
    noReachableMembers: (group: string) => string
    pictureGenerationFailed: string
    nameTaken: (name: string) => string
    memberCount: (count: number) => string
    /** The reader's own lines in a room: the transcript speaker and the roster preview. */
    you: string
    /** How many of a room's members are reachable right now. */
    availableCount: (available: number, total: number) => string
    /** Opens the member picker — not a settings sub-page. */
    manageMembers: string
    /** Tooltip fallback when the room has no members yet. */
    noMembers: string
    /** Accessible name of the header's icon-only overflow trigger. */
    moreActions: string
    settingsHint: (group: string) => string
    settingsLabel: (group: string) => string
    disbandHint: (group: string) => string
    disbandLabel: (group: string) => string
    disbandAction: string
    disbanding: string
    disbandDone: string
    disbanded: (group: string) => string
    /** Wraps the bolded group name, so the name can lead the sentence in
     *  languages that put it there — see core's cron.deleteDesc* pair. */
    disbandDescPrefix: string
    disbandDescSuffix: (count: number) => string
    stopped: (group: string) => string
    /** Room row context menu + its toasts (mirrors the bot row's pin/chat pairs). */
    openChat: string
    pinToTop: string
    unpin: string
    pinnedToast: (room: string) => string
    unpinnedToast: (room: string) => string
    /** A scoped stop that left other threads' sends in the queue says so. */
    stoppedWithQueued: (room: string, queued: number) => string
    /** Composer chip: sends waiting behind the room's running turn. */
    queued: (count: number) => string
    removeAttachment: string
    attachmentFallback: string
    threadFallback: string
    replyCount: (replies: number) => string
    dropToThread: string
    dropToRoom: string
    waitingForAnswer: string
    memberThinking: (name: string) => string
    roomWorking: string
    messageRoom: (group: string) => string
    newThreadPlaceholder: (group: string) => string
    everyoneMeta: string
    commandApproval: string
    answerFailed: (handle: string, error: string) => string
    wantsToRunCommand: (handle: string) => string
    asks: (handle: string) => string
    answerTo: (member: string) => string
  }
  /** Skills hub + MCP setup surfaces embedded in the bot editor. */
  tools: {
    installHint: (name: string) => string
    installed: (name: string) => string
    installFailed: (name: string) => string
    searchHint: string
    resizeHint: string
    addServerFailed: string
    noTarget: string
    setKeyFailed: (name: string) => string
    configured: (name: string) => string
    authenticated: (name: string) => string
    testFailed: string
    completeSignIn: string
    needsSetup: (name: string) => string
    setUpDone: string
    saveTest: string
    authorizing: string
    working: string
    setupFailed: string
    signIn: string
    setUp: string
    skillsHub: string
    filterSkills: string
    searchHub: string
    noMcpServers: string
  }

  /** Bot Screen: the bot's headless desktop on the gateway host, live in a pane. */
  screen: {
    title: string
    menu: string
    unsupportedTitle: string
    unsupportedBody: string
    notInstalledTitle: string
    notInstalledBody: string
    installHint: string
    install: string
    installing: string
    installCancelled: string
    installFailed: string
    noPackageManager: string
    portalTitle: string
    portalOpen: string
    heroStopped: string
    heroNotInstalled: string
    heroConnecting: string
    heroStale: string
    heroSuppressed: string
    heroOpenLive: string
    heroInstall: string
    heroStart: string
    portalWatching: string
    portalYouControl: string
    portalOtherControls: string
    portalStopped: string
    portalNotInstalled: string
    portalUnsupported: string
    portalUnavailable: string
    /** Managed runtimes (Hermes Cloud): updates are the platform's job, not the user's. */
    portalUnavailableManaged: string
    managedNotIncludedTitle: string
    managedNotIncludedBody: string
    unavailableTitle: string
    autoOpenMenu: string
    autoOpenOnToast: (name: string) => string
    autoOpenOffToast: (name: string) => string
    stoppedTitle: string
    stoppedBody: string
    placementSandbox: (backend: string) => string
    imageSwitchTitle: string
    imageSwitchBody: (current: string, target: string) => string
    imageSwitchApprove: string
    imageSwitchKeep: string
    start: string
    attaching: string
    streamLost: string
    reconnect: string
    takeOver: string
    handBack: string
    handBackForce: string
    handBackForceHint: string
    openNeedsUpdate: string
    youControl: string
    otherControls: string
    agentControls: string
    controlTaken: string
    needsHttps: string
  }

  /** Bot-scoped scheduled jobs. Generic scheduling chrome (weekday names,
   *  Daily/Hourly, the job verbs) resolves against core's `cron` section. */
  cron: {
    untitled: string
    nameNul: string
    instructionNul: string
    minutesFromNow: string
    hoursFromNow: string
    daysFromNow: string
    stopAfter: string
    runsHint: string
    detailDescription: string
    status: string
    active: string
    paused: string
    schedule: string
    rawSchedule: string
    repeat: string
    nextRun: string
    overdueSince: string
    lastRun: string
    lastResult: string
    workdir: string
    succeeded: string
    failed: string
    deliveryFailed: string
    blockedConfig: string
    legacyUnsafe: string
    filterHint: string
    needsRosterFirst: string
    staleNotice: string
    readFailure: string
    createDesc: (bot: string) => string
    instruction: string
    whenToRun: string
    dayOfMonth: string
    sendResultsTo: string
    runHistoryOnly: string
    botChatTarget: (bot: string) => string
    continuity: string
    onceIn: (when: string) => string
    everyNDays: (days: number) => string
    everyNHours: (hours: number) => string
    everyNMinutes: (minutes: number) => string
    /** The frequency picker's eight options, in menu order. */
    freqOnce: string
    freqHourly: string
    freqDaily: string
    freqWeekdays: string
    freqWeekly: string
    freqMonthly: string
    freqInterval: string
    freqAdvanced: string
    unitMinutes: string
    unitHours: string
    unitDays: string
    /** One-line plain-language read-back of the picker's current state. */
    runsOnce: (count: number, unit: string) => string
    runsHourly: string
    runsDaily: (time: string) => string
    runsWeekdays: (time: string) => string
    runsWeekly: (day: string, time: string) => string
    runsMonthly: (day: string, time: string) => string
    runsInterval: (count: number, unit: string) => string
    runsRaw: string
    timesTotal: (count: number) => string
  }
  panel: {
    title: string
    tasks: string
    scheduled: string
    history: string
    saved: string
    now: string
    today: string
    yesterday: string
    workingNow: string
    offline: string
    tasksCompleted: (count: number) => string
    noSaved: string
    noHistory: string
    /** The first tab: routine runs AND conversations — not just tasks, so the
     *  label says what the list actually contains. */
    activity: string
    /** Empty-state body for the activity timeline, which lists routine runs
     *  AND listed conversations — the two things a bot actually does. */
    noActivityHint: string
    sessionMessages: (count: number) => string
    openChat: string
    updatedNow: string
    /** Footer freshness with the time attached, so a bare "now" is never the whole story. */
    updatedAt: (time: string) => string
    /** Inline dismiss × on a needs-you card. */
    dismissPrompt: string
    /** Live round/activity feed header. */
    liveActivity: string
    /** Live-round strip prefix (e.g. "Running round · Room"). */
    runningRound: string
    /** Stop button on the live-round strip. */
    stopRound: string
    /** Amber banner when the focused bot's source is unreachable. */
    unreachable: string
    /** Inline goal editor affordances. */
    goalEdit: string
    goalEmpty: string
    goalInput: string
    goalPlaceholder: string
    goalSet: string
  }
  /** Render-failure containment copy (`BotModeBoundary`). One pair for every
   *  surface: the panel, the room, and anything added later say the same
   *  thing — this surface broke, the rest still works. */
  errors: {
    title: string
    body: string
  }

}
