import { defineLocale } from './define-locale'
import { introZhHant } from './intro-zh-hant'
import { zhHantArtifacts } from './zh-hant_artifacts'
import { zhHantAssistant } from './zh-hant_assistant'
import { zhHantBoot } from './zh-hant_boot'
import { zhHantCapabilities } from './zh-hant_capabilities'
import { zhHantChat } from './zh-hant_chat'
import { zhHantChrome } from './zh-hant_chrome'
import { zhHantCommandCenter } from './zh-hant_command_center'
import { zhHantCommon } from './zh-hant_common'
import { zhHantConnectors } from './zh-hant_connectors'
import { zhHantDiagnostics } from './zh-hant_diagnostics'
import { zhHantSettings } from './zh-hant_settings'

export const zhHant = defineLocale({
  skillDeepLink: {
    installTitle: (name: string) => `安裝「${name}」？`,
    installDescription: '此技能將於新的工作階段中可用。請僅安裝可信來源的內容。',
    installTo: '安裝至',
    thisComputer: '這部電腦',
    installing: '正在安裝…',
    installComplete: (name: string) => `已安裝「${name}」`,
    destinationChanged: '安裝目標已變更。請關閉此對話框並重新開啟安裝連結。',
    installed: '已安裝',
    source: '來源'
  },
  externalOpenFailed: {
    title: '無法開啟此連結',
    message: '沒有註冊用於開啟此位址的瀏覽器。請複製連結並手動開啟。',
    copyUrl: '複製連結',
    close: '關閉'
  },
  sharedMetrics: {
    consentTitle: '協助改進 Hermes？',
    consentBody:
      '共享指標只包含有上限的計數，絕不包含提示詞、檔案、路徑或錯誤文字。收集僅在本機進行；傳送給 Nous 需要另行同意。',
    whatIsCollected: '收集哪些內容',
    collectedIntro: '僅限有上限的計數：',
    collectedActivity:
      '活動、工作階段長度、結果和錯誤類別，包括記憶寫入或上下文壓縮被拒絕、失敗或略過時的原因（來自固定清單）',
    collectedModels: '模型路由和 token 總量',
    collectedNames: '內建工具、指令和目錄項名稱',
    collectedMilestones: '分組的設定計數',
    collectedReliability: '更新結果與耗時、當機、啟動與回覆速度、訊息平台狀態',
    collectedUsage:
      'Hermes 的使用方式：代理的準確度與效率（編輯是否成功、迴圈、錯誤後的恢復、每個任務的 token 與工具呼叫數、快取中斷），各介面與 Desktop 模式的活躍時間，哪些應用程式區域、操作與設定被使用、很快關閉或被關閉，以及供應商設定的結果',
    collectedMachine:
      '概略的機器資訊：記憶體範圍、GPU 類型、Hermes 版本新舊與發行通道、落後的更新數、是否使用本機模型伺服器',
    installId:
      '傳送會把每日資料包上傳到 Nous 遙測服務。資料包帶有此設定檔的安裝 ID：一個不含個人資訊的固定隨機 UUID，刪除共享指標目錄即可重設。',
    consentWindow:
      '只有整個收集期間都落在已記錄同意時段內的資料包才會被傳送——你同意之前的資料，或傳送關閉期間的資料，都會留在本機。你可以隨時再次關閉傳送。',
    readDocs: '查看完整說明',
    share: '收集並傳送給 Nous',
    local: '僅在本機收集',
    off: '不用了',
    changeLater: '你可以隨時在 設定 → 安全性 中變更。',
    saveFailed: '無法儲存你的選擇',
    collectLabel: '收集使用統計',
    collectDesc: '在此裝置上保存有上限的計數。絕不包含提示詞、檔案、路徑或錯誤文字。',
    sendLabel: '向 Nous 傳送使用統計',
    sendDesc: '將每日資料包上傳到 Nous 遙測服務。只傳送同意時段內的資料。需要先開啟收集。',
    unavailable: '請更新 Hermes 後端以變更此設定。',
    stripBody: '僅限有界計數器，絕不包含提示詞或檔案。',
    stripReaskBody: '再次詢問：舊版本可能在你看到此問題之前就已儲存了「不用了」。',
    stripChoices: { share: '傳送給 Nous', local: '僅限本機', off: '不用了' },
    stripDetails: '詳細資訊'
  },
  intro: introZhHant,
  sessionImport: zhHantConnectors.sessionImport,
  common: zhHantCommon.common,
  fileMenu: zhHantChrome.fileMenu,
  boot: zhHantBoot.boot,
  notifications: zhHantDiagnostics.notifications,
  remoteDisplayBanner: zhHantBoot.remoteDisplayBanner,
  billingBlock: zhHantCommon.billingBlock,
  sendDiagnostics: zhHantDiagnostics.sendDiagnostics,
  titlebar: zhHantChrome.titlebar,
  language: zhHantSettings.language,
  settings: zhHantSettings.settings,
  skills: zhHantCapabilities.skills,
  starmap: zhHantCapabilities.starmap,
  agents: zhHantCapabilities.agents,
  commandCenter: zhHantCommandCenter.commandCenter,
  messaging: zhHantCommandCenter.messaging,
  profiles: zhHantCommandCenter.profiles,
  modelAssignment: {
    saveFailed: 'Hermes 未儲存該模型變更。',
    confirmTitle: '模型選擇警告',
    confirmDetail: '僅在你接受此權衡時確認。',
    confirmAction: '確認',
    declined: '已取消模型變更 — 你拒絕了資料訓練層級警告。'
  },
  cron: zhHantCommandCenter.cron,
  artifacts: zhHantArtifacts.artifacts,
  artifactCard: zhHantArtifacts.artifactCard,
  artifactPreview: zhHantArtifacts.artifactPreview,
  sidebar: zhHantChrome.sidebar,
  composer: zhHantChat.composer,
  statusStack: zhHantChat.statusStack,
  updates: zhHantBoot.updates,
  guidedGreeting: zhHantBoot.guidedGreeting,
  install: zhHantBoot.install,
  onboarding: zhHantBoot.onboarding,
  modelPicker: zhHantSettings.modelPicker,
  modelVisibility: zhHantSettings.modelVisibility,
  shell: zhHantChrome.shell,
  rightSidebar: zhHantChrome.rightSidebar,
  preview: zhHantArtifacts.preview,
  interfaceMode: {
    title: '介面模式',
    hint: '只改變顯示的內容，不改變 Hermes 的能力。',
    sessionNote: '由簡潔模式設定。此處的變更僅在本次工作階段內生效；切換到進階模式即可保留為你的設定。',
    simpleNotice: '簡潔模式 — 面板與其他工具已隱藏。',
    showAdvanced: '顯示進階模式',
    simple: {
      label: '簡潔',
      description: '用於與 Hermes 對話。只有側邊欄和聊天；沒有終端機、檔案或差異面板。'
    },
    advanced: {
      label: '進階',
      description: '面向開發者。終端機、檔案、差異、狀態列和版面配置，按你的設定顯示。'
    }
  },
  zones: zhHantChrome.zones,
  contextMenu: zhHantChrome.contextMenu,
  assistant: zhHantAssistant.assistant,
  prompts: zhHantChat.prompts,
  desktop: zhHantChat.desktop,
  errors: zhHantDiagnostics.errors,
  tips: zhHantChat.tips,
  ui: zhHantCommon.ui,
  todayBrief: {
    greeting: { morning: '早安', afternoon: '午安', evening: '晚安', night: '還在忙？' },
    needsYou: '需要你處理',
    running: '正在執行',
    finished: '你離開時已完成',
    scheduled: '今天的安排',
    recent: '從上次繼續'
  },

  live: {
    title: '即時',
    noSession: '未選擇工作階段',
    emptyTitle: '尚未執行任何動作',
    emptyBody: '每個指令、每次檔案讀取與工具呼叫都會在開始時顯示於此，並附上完整輸出。不做任何摘要。',
    count: total => `${total} 個動作`,
    countRunning: (total, running) => `${total} 個動作 · ${running} 個執行中`,
    follow: '跟隨',
    followHint: '跳到最新動作並保持可見',
    copy: '複製指令與輸出',
    exitCode: code => `結束碼 ${code}`,
    runningFor: elapsed => `已執行 ${elapsed}`,
    waitingForOutput: '執行中——完成後顯示輸出',
    noOutput: '沒有輸出',
    openLive: '即時'
  },

  connectors: {
    title: '連接你的應用程式',
    connect: '連接',
    skip: '暫時不要',
    cancel: '停止等待',
    retry: '再試一次',
    grant: '重新連接',
    connected: '已連接',
    checking: '正在檢查你的應用程式…',
    notConnected: '未連接',
    skipped: '已略過',
    disabled: '無法使用',
    failed: '無法連接',
    needsAuth: '存取權已過期',
    opening: '正在開啟登入…',
    waiting: '正在等待瀏覽器…',
    timeout: '仍在等待授權。',
    refresh: '重新整理狀態',
    connectError: '無法開始授權。請再試一次。',
    connectErrorFor: (app: string) => `無法開始 ${app} 的授權。`,
    unavailable: '此工作階段無法使用連接器。',
    ownerMissing: '請重新開啟此對話以管理其連接。',
    search: '尋找應用程式',
    empty: '沒有相符的應用程式',
    disclaimer: '連接為選用。僅授權你想讓 Hermes 使用的應用程式。',
    execution: '連接器工具',
    setup: (server: string) => `設定 ${server}`,
    openInBrowser: '在瀏覽器中開啟',
    setupCancel: '取消',
    authorizedToolsUnavailable: '已授權。工具無法使用。',
    required: '必要'
  },

  keybinds: {
    actions: {
      'nav.starmap': '開啟記憶圖譜',
      'nav.webhooks': '開啟 Webhook'
    }
  },

  connectorsPage: {
    title: '連接器',
    searchPlaceholder: (count: number) => `搜尋 ${count} 個應用程式`,
    filterCategory: '類別',
    categoryAll: '所有類別',
    uncategorised: '未分類',
    residencyLocal: '在此裝置上',
    segment: {
      all: '全部',
      available: '可用',
      connected: '已連線',
      off: '已關閉'
    },
    group: {
      connected: '已連線',
      connectedNote: '先列出中斷的連線。',
      available: '可用',
      off: '已關閉',
      offNote: '登入狀態會保留。'
    },
    card: {
      kindManaged: '受管理',
      kindCatalog: 'MCP · 目錄',
      kindCustom: 'MCP · 自訂',
      kindPlugin: (plugin: string) => `MCP · 外掛 ${plugin}`,
      inCatalog: '在 Hermes 目錄中',
      hostedTwin: '有受管理版本',
      alsoLocal: '也可在此裝置執行',
      open: (name: string) => `開啟 ${name}`,
      turnServerOn: (name: string) => `開啟 ${name}`,
      turnServerOff: (name: string) => `關閉 ${name}`,
      state: {
        accessExpired: '存取權已過期',
        available: '可用',
        connected: '已連線',
        connecting: '連線中',
        connectionUnknown: '狀態不明',
        couldNotConnect: '無法連線',
        offByYourOrganisation: '已由您的組織關閉',
        offForYou: '已為您關閉',
        serverConnecting: '連線中…',
        serverError: '錯誤',
        serverNeedsAuth: '需要驗證',
        serverOff: '關閉',
        serverOn: '開啟',
        serverOnUnused: '開啟，未使用'
      },
      fact: {
        tools: (count: number) => `${count} 個工具`,
        toolsOff: (count: number) => `${count} 個工具已關閉`,
        toolsOn: (count: number) => `${count} 個工具已開啟`,
        toolsSomeOn: (total: number, on: number) => `${total} 個工具，${on} 個已開啟`
      },
      verb: {
        authenticate: '驗證',
        connect: '連線',
        install: '安裝',
        openLogs: '開啟記錄',
        reconnect: '重新連線',
        stopWaiting: '停止等待',
        tryAgain: '重試',
        turnBackOn: '重新開啟'
      },
      reason: {
        finishSignIn: '請在瀏覽器中完成登入。',
        reconnect: '重新連線以繼續使用此應用程式。',
        serverError: '伺服器拒絕了連線。',
        serverNeedsAuth: '登入後此伺服器才能回應。'
      }
    },
    page: {
      loading: '正在讀取目錄與此電腦上的伺服器',
      emptyTitle: '尚無應用程式。在此電腦上新增伺服器即可開始。',
      noMatchTitle: '沒有符合的應用程式',
      noMatchBody: '沒有相符項目。將 Hermes 指向您自己的 MCP 伺服器即可新增。',
      clearSearch: '清除搜尋',
      hostedFailedTitle: '無法連線到託管應用程式。',
      hostedFailedBody: '此電腦上的伺服器不受影響，仍在執行。沒有任何項目被關閉。',
      retry: '重試',
      matchesElsewhere: (count: number) => `其他群組中還有 ${count} 個相符項目。`,
      showAllMatches: '顯示所有相符項目',
      segmentNoMatch: (segment: string) => `${segment} 中沒有相符項目，因此顯示全部。`,
      freeTierNote: '登入前，連線會保留在此電腦上。',
      signInLine: '登入 Nous 即可使用受管理的應用程式。',
      signIn: '登入',
      managedUnavailable: '此帳戶尚無法使用受管理的應用程式。',
      writeFailed: '該變更未儲存。',
      refreshFailed: '工具列表未重新整理。',
      disconnectNoAccount: 'Hermes 在此沒有可中斷的帳戶。請重新整理頁面後重試。',
      disconnectRefused: 'Nous 目前無法移除此登入。請改用開關關閉該應用程式，或稍後再試。'
    },
    add: {
      action: '新增自己的伺服器',
      title: '連線到自訂 MCP',
      hint: '在此裝置的 mcp.json 中新增一個項目',
      pasteLabel: '貼上指令或片段',
      pastePlaceholder: 'npx -y @modelcontextprotocol/server-filesystem /path/to/dir',
      pasteNoMatch: '無法識別為伺服器。請改為填寫下方欄位。',
      name: '名稱',
      nameTaken: '此名稱已被使用。',
      type: '類型',
      typeStdio: 'STDIO',
      typeHttp: 'Streamable HTTP',
      command: '啟動指令',
      args: '參數',
      addArg: '+ 新增參數',
      envVars: '環境變數',
      addEnvVar: '+ 新增環境變數',
      passthrough: '環境變數傳遞',
      addPassthrough: '+ 新增變數',
      cwd: '工作目錄',
      url: 'URL',
      headers: '標頭',
      addHeader: '+ 新增標頭',
      auth: '驗證',
      authNone: '無',
      authOauth: 'OAuth',
      authBearer: 'Bearer 權杖',
      keyPlaceholder: 'KEY',
      valuePlaceholder: '值',
      removeRow: '移除此列',
      editJson: '編輯 mcp.json',
      saveFailed: '該伺服器未儲存。'
    },
    dialog: {
      disconnect: '中斷連線',
      disconnectTitle: (name: string) => `中斷與 ${name} 的連線？`,
      disconnectBody: 'Hermes 將不再以此帳戶操作。您可以隨時重新連線。',
      menuRefreshTools: '重新整理工具',
      moreActions: '更多操作',
      removeServerTitle: (name: string) => `移除 ${name}？`,
      removeServerBody: '該項目將從此電腦的 mcp.json 中移除，不會刪除其他內容。',
      appSwitch: (name: string) => `Hermes 可以使用 ${name}`,
      waysTitle: (name: string) => `${name} 的執行位置`,
      wayNotConnected: (name: string) => `尚未連線。請在瀏覽器中登入 ${name}。`,
      wayHosted: '受管理',
      bothOn: (name: string) => `兩者都已開啟，Hermes 會看到兩份 ${name} 工具。`,
      turnOffLocal: '關閉本機伺服器',
      providedByPlugin: (plugin: string) => `由外掛 ${plugin} 提供`,
      openPlugins: '開啟外掛分頁',
      nousLine: 'Nous 應用程式跟隨您的帳戶，而非設定檔。',
      rulesReadOnly: '目前無法變更規則。',
      rulesAppOff: (name: string) => `開啟 ${name} 才能變更其工具。`,
      rulesSignIn: '登入後即可變更 Hermes 在此可執行的操作。',
      orgNote: (count: number) => `您的組織關閉了 ${count} 個工具。`,
      orgLink: '開啟連接器管理',
      connectEnded: '登入未完成。',
      connectOpenAgain: '重新開啟連結',
      tokensPerCall: '每次呼叫的權杖數',
      usesPerMonth: '30 天內的使用次數',
      advanced: '進階',
      advancedHint: 'mcp.json 項目與記錄'
    },
    tools: {
      title: '工具',
      notInstalledBody: '在此裝置上安裝後即可查看其提供的工具。',
      summaryTitle: (name: string) => `Hermes 可使用 ${name} 執行的操作`,
      summaryPreviewTitle: (name: string) => `連線後 Hermes 可使用 ${name} 執行的操作`,
      summaryCount: (count: number) => `${count} 個工具`,
      summaryAllTools: '所有工具',
      summaryOther: '其他',
      allToolsSwitch: '開啟或關閉所有工具',
      summaryAllOn: '全部開啟',
      summarySomeOn: (on: number, total: number) => `${on}/${total} 已開啟`,
      summaryOff: '關閉',
      showAllTools: (count: number) => `顯示全部 ${count} 個工具`,
      showSummary: '顯示摘要',
      facetSwitch: (facet: string) => `開啟或關閉${facet}工具`,
      moreHints: (count: number) => `+${count}`,
      staleSignIn: '登入以讀取最新工具列表。',
      searchCountPlaceholder: (count: number) => `搜尋 ${count} 個工具`,
      toolList: (name: string) => `${name} 工具`,
      categorySelect: (count: number) => `${count} 個類別`,
      showDeprecated: (count: number) => `顯示 ${count} 個已棄用項目`,
      hideDeprecated: (count: number) => `隱藏 ${count} 個已棄用項目`,
      quickReadOnly: '唯讀',
      quickNoDestructive: '關閉破壞性工具',
      quickEverythingOn: '全部開啟',
      lockedHint: '已由您的組織關閉',
      turnToolOn: (tool: string) => `開啟 ${tool}`,
      turnToolOff: (tool: string) => `關閉 ${tool}`,
      showDetails: (tool: string) => `顯示 ${tool} 的功能`,
      hideDetails: (tool: string) => `隱藏 ${tool} 的功能`,
      noMatch: '沒有符合這些篩選條件的工具。',
      loading: '正在讀取工具列表',
      unavailableLine: '工具列表無法使用。',
      needsAuthTitle: (name: string) => `登入 ${name} 以讀取其工具。`,
      needsAuthBody: '登入狀態僅保留在此電腦上，不會外傳。',
      retry: '重試',
      goneTitle: (name: string) => `${name} 已從目錄移除。`,
      goneBody: 'Hermes 無法再呼叫它。在您移除之前此列會保留，內容不會憑空消失。',
      remove: '移除',
      offTitle: (name: string) => `${name} 已關閉。`,
      offBody: '使用上方開關開啟即可讀取其提供的工具。',
      signedOutTitle: '登入 Nous 以讀取工具列表。',
      signedOutBody: '此電腦上的伺服器不受影響。',
      conflictTitle: '您編輯期間有人變更了此規則。',
      conflictBody: (theyOff: number, theyOn: number) => {
        const they = [
          theyOff > 0 ? `關閉了您已開啟的 ${theyOff} 個工具` : '',
          theyOn > 0 ? `保留了您已關閉的 ${theyOn} 個工具` : ''
        ].filter(Boolean)

        return `${they.length > 0 ? `對方${they.join('，且')}。` : ''}您的編輯仍保留在畫面上；尚未寫入。`
      },
      conflictReload: '重新載入對方版本',
      conflictSave: '以您的版本覆寫儲存',
      saveFailed: '這些工具規則未儲存。',
      footerDirty: (off: number, backOn: number) => `${off} 個工具已關閉，${backOn === 0 ? '無' : backOn} 個重新開啟`,
      discard: '捨棄',
      save: '儲存變更',
      saving: '儲存中…'
    },
    vocabulary: {
      facetRead: {
        label: '讀取',
        long: '從此應用程式讀取資料，不做任何變更。'
      },
      facetWrite: {
        label: '寫入',
        long: '在此應用程式中建立或變更內容。'
      },
      facetDestructive: {
        label: '破壞性',
        long: '可能永久移除此應用程式中的內容。'
      },
      facetUnclassified: {
        label: '效果不明',
        long: '此應用程式未說明該工具的作用。'
      },
      hintReadOnly: {
        label: '唯讀',
        long: '此工具宣告僅讀取資料。'
      },
      hintCreate: {
        label: '建立',
        long: '建立新內容。'
      },
      hintUpdate: {
        label: '更新',
        long: '變更既有內容。'
      },
      hintDelete: {
        label: '刪除',
        long: '移除內容。'
      },
      hintDestructive: {
        label: '破壞性',
        long: '此處的變更無法復原。'
      },
      hintIdempotent: {
        label: '可重複',
        long: '執行兩次與執行一次效果相同。'
      },
      hintOpenWorld: {
        label: '外部',
        long: '會存取此應用程式以外的內容。'
      }
    }
  }
})
