import { arArtifacts } from './ar_artifacts'
import { arAssistant } from './ar_assistant'
import { arBoot } from './ar_boot'
import { arCapabilities } from './ar_capabilities'
import { arChat } from './ar_chat'
import { arChrome } from './ar_chrome'
import { arCommandCenter } from './ar_command_center'
import { arCommon } from './ar_common'
import { arConnectors } from './ar_connectors'
import { arDiagnostics } from './ar_diagnostics'
import { arSettings } from './ar_settings'
import { defineLocale } from './define-locale'

export const ar = defineLocale({
  sharedMetrics: arCommon.sharedMetrics,
  externalOpenFailed: arChrome.externalOpenFailed,
  sessionImport: arConnectors.sessionImport,
  sendDiagnostics: arDiagnostics.sendDiagnostics,
  common: arCommon.common,
  fileMenu: arChrome.fileMenu,
  boot: arBoot.boot,
  notifications: arDiagnostics.notifications,
  remoteDisplayBanner: arBoot.remoteDisplayBanner,
  titlebar: arChrome.titlebar,
  keybinds: arChrome.keybinds,
  language: arSettings.language,
  settings: arSettings.settings,
  skills: arCapabilities.skills,
  agents: arCapabilities.agents,
  commandCenter: arCommandCenter.commandCenter,
  messaging: arCommandCenter.messaging,
  profiles: arCommandCenter.profiles,
  modelAssignment: arSettings.modelAssignment,
  cron: arCommandCenter.cron,
  artifacts: arArtifacts.artifacts,
  artifactCard: arArtifacts.artifactCard,
  artifactPreview: arArtifacts.artifactPreview,
  sidebar: arChrome.sidebar,
  composer: arChat.composer,
  statusStack: arChat.statusStack,
  updates: arBoot.updates,
  guidedGreeting: arBoot.guidedGreeting,
  install: arBoot.install,
  onboarding: arBoot.onboarding,
  modelPicker: arSettings.modelPicker,
  modelVisibility: arSettings.modelVisibility,
  shell: arChrome.shell,
  rightSidebar: arChrome.rightSidebar,
  preview: arArtifacts.preview,
  interfaceMode: arSettings.interfaceMode,
  zones: arChrome.zones,
  contextMenu: arChrome.contextMenu,
  assistant: arAssistant.assistant,
  prompts: arChat.prompts,
  desktop: arChat.desktop,
  errors: arDiagnostics.errors,
  tips: arChat.tips,
  ui: arCommon.ui,

  todayBrief: {
    greeting: { morning: 'صباح الخير', afternoon: 'مساء الخير', evening: 'مساء الخير', night: 'تعمل حتى وقت متأخر؟' },
    needsYou: 'بانتظارك',
    running: 'قيد التشغيل',
    finished: 'انتهى أثناء غيابك',
    scheduled: 'القادم اليوم',
    recent: 'تابع من حيث توقفت'
  },

  live: {
    title: 'مباشر',
    noSession: 'لم يتم تحديد جلسة',
    emptyTitle: 'لم يُشغَّل شيء بعد',
    emptyBody: 'يظهر هنا كل أمر وكل قراءة ملف وكل استدعاء أداة لحظة بدئه، مع مخرجاته كاملة. لا يُختصر أي شيء.',
    count: total => `${total} ${total === 1 ? 'إجراء' : 'إجراءات'}`,
    countRunning: (total, running) => `${total} ${total === 1 ? 'إجراء' : 'إجراءات'} · ${running} قيد التشغيل`,
    follow: 'متابعة',
    followHint: 'الانتقال إلى أحدث إجراء وإبقاؤه ظاهرًا',
    copy: 'نسخ الأمر والمخرجات',
    exitCode: code => `رمز الخروج ${code}`,
    runningFor: elapsed => `قيد التشغيل منذ ${elapsed}`,
    waitingForOutput: 'قيد التشغيل — تظهر المخرجات عند الانتهاء',
    noOutput: 'لا توجد مخرجات',
    openLive: 'مباشر'
  },

  connectors: {
    title: 'اربط تطبيقاتك',
    connect: 'ربط',
    skip: 'ليس الآن',
    cancel: 'إيقاف الانتظار',
    retry: 'إعادة المحاولة',
    grant: 'إعادة الربط',
    connected: 'متصل',
    checking: 'جارٍ فحص تطبيقاتك…',
    notConnected: 'غير متصل',
    skipped: 'تم التخطي',
    disabled: 'غير متاح',
    failed: 'تعذّر الربط',
    needsAuth: 'انتهت صلاحية الوصول',
    opening: 'جارٍ فتح تسجيل الدخول…',
    waiting: 'بانتظار المتصفح…',
    timeout: 'ما زلنا بانتظار التفويض.',
    refresh: 'تحديث الحالة',
    connectError: 'تعذّر بدء التفويض. حاول مجددًا.',
    connectErrorFor: (app: string) => `تعذّر بدء التفويض لـ ${app}.`,
    unavailable: 'الموصّلات غير متاحة لهذه الجلسة.',
    ownerMissing: 'أعد فتح هذه المحادثة لإدارة اتصالاتها.',
    search: 'ابحث عن تطبيق',
    empty: 'لا توجد تطبيقات مطابقة',
    disclaimer: 'الربط اختياري. فوّض فقط التطبيقات التي تريد أن يستخدمها Hermes.',
    execution: 'أدوات الموصّلات',
    setup: (server: string) => `إعداد ${server}`,
    openInBrowser: 'افتح في المتصفح',
    setupCancel: 'إلغاء',
    authorizedToolsUnavailable: 'تم التفويض. الأدوات غير متاحة.',
    required: 'مطلوب'
  },

  intro: {
    recentSessions: 'تابع من حيث توقفت'
  },

  connectorsPage: {
    title: 'الموصّلات',
    searchPlaceholder: (count: number) => `ابحث في ${count} تطبيقًا`,
    filterCategory: 'الفئة',
    categoryAll: 'كل الفئات',
    uncategorised: 'غير مصنّف',
    residencyLocal: 'على هذا الجهاز',
    segment: {
      all: 'الكل',
      available: 'متاح',
      connected: 'متصل',
      off: 'متوقف'
    },
    group: {
      connected: 'متصل',
      connectedNote: 'الاتصالات المعطّلة أولًا.',
      available: 'متاح',
      off: 'متوقف',
      offNote: 'تُحفظ تسجيلات الدخول.'
    },
    card: {
      kindManaged: 'مُدار',
      kindCatalog: 'MCP · كتالوج',
      kindCustom: 'MCP · مخصص',
      kindPlugin: (plugin: string) => `MCP · إضافة ${plugin}`,
      inCatalog: 'في كتالوج Hermes',
      hostedTwin: 'تتوفر نسخة مُدارة',
      alsoLocal: 'يعمل أيضًا على هذا الجهاز',
      open: (name: string) => `فتح ${name}`,
      turnServerOn: (name: string) => `تشغيل ${name}`,
      turnServerOff: (name: string) => `إيقاف ${name}`,
      state: {
        accessExpired: 'انتهت صلاحية الوصول',
        available: 'متاح',
        connected: 'متصل',
        connecting: 'جارٍ الاتصال',
        connectionUnknown: 'الحالة مجهولة',
        couldNotConnect: 'تعذّر الاتصال',
        offByYourOrganisation: 'متوقف من مؤسستك',
        offForYou: 'متوقف لك',
        serverConnecting: 'جارٍ الاتصال…',
        serverError: 'خطأ',
        serverNeedsAuth: 'يتطلب مصادقة',
        serverOff: 'متوقف',
        serverOn: 'يعمل',
        serverOnUnused: 'يعمل، غير مستخدم'
      },
      fact: {
        tools: (count: number) => `${count} أداة`,
        toolsOff: (count: number) => `${count} أداة متوقفة`,
        toolsOn: (count: number) => `${count} أداة تعمل`,
        toolsSomeOn: (total: number, on: number) => `${total} أداة، ${on} تعمل`
      },
      verb: {
        authenticate: 'مصادقة',
        connect: 'اتصال',
        install: 'تثبيت',
        openLogs: 'فتح السجلات',
        reconnect: 'إعادة الاتصال',
        stopWaiting: 'إيقاف الانتظار',
        tryAgain: 'إعادة المحاولة',
        turnBackOn: 'إعادة التشغيل'
      },
      reason: {
        finishSignIn: 'أكمل تسجيل الدخول في متصفحك.',
        reconnect: 'أعد الاتصال ليبقى هذا التطبيق يعمل.',
        serverError: 'رفض الخادم الاتصال.',
        serverNeedsAuth: 'سجّل الدخول ليتمكن هذا الخادم من الرد.'
      }
    },
    page: {
      loading: 'جارٍ قراءة الكتالوج والخوادم على هذا الحاسوب',
      emptyTitle: 'لا تطبيقات هنا بعد. أضف خادمًا على هذا الحاسوب للبدء.',
      noMatchTitle: 'لا تطبيقات مطابقة',
      noMatchBody: 'لا شيء هنا يطابق. وجّه Hermes إلى خادم MCP خاص بك لإضافته.',
      clearSearch: 'مسح البحث',
      hostedFailedTitle: 'تعذّر الوصول إلى التطبيقات المستضافة.',
      hostedFailedBody: 'الخوادم على هذا الحاسوب غير متأثرة وما زالت تعمل. لم يُوقف أي شيء.',
      retry: 'إعادة المحاولة',
      matchesElsewhere: (count: number) => `${count} مطابقات إضافية في مجموعات أخرى.`,
      showAllMatches: 'عرض كل المطابقات',
      segmentNoMatch: (segment: string) => `لا مطابقة في ${segment}، لذا تُعرض كل المطابقات.`,
      freeTierNote: 'تبقى الاتصالات على هذا الحاسوب حتى تسجّل الدخول.',
      signInLine: 'سجّل الدخول إلى Nous لاستخدام التطبيقات المُدارة.',
      signIn: 'تسجيل الدخول',
      managedUnavailable: 'التطبيقات المُدارة غير متاحة لهذا الحساب بعد.',
      writeFailed: 'لم يُحفظ ذلك التغيير.',
      refreshFailed: 'لم تُحدَّث قائمة الأدوات.',
      disconnectNoAccount: 'لا يملك Hermes حسابًا لقطعه هنا. حدّث الصفحة وأعد المحاولة.',
      disconnectRefused:
        'تعذّر على Nous إزالة تسجيل الدخول هذا الآن. أوقف التطبيق بالمفتاح بدلًا من ذلك، أو أعد المحاولة لاحقًا.'
    },
    add: {
      action: 'أضف خاصًا بك',
      title: 'الاتصال بـMCP مخصص',
      hint: 'إدخال جديد واحد في mcp.json على هذا الجهاز',
      pasteLabel: 'الصق أمرًا أو مقتطفًا',
      pastePlaceholder: 'npx -y @modelcontextprotocol/server-filesystem /path/to/dir',
      pasteNoMatch: 'لا شيء هنا يُقرأ كخادم. املأ الحقول أدناه بدلًا من ذلك.',
      name: 'الاسم',
      nameTaken: 'هذا الاسم مستخدم مسبقًا.',
      type: 'النوع',
      typeStdio: 'STDIO',
      typeHttp: 'Streamable HTTP',
      command: 'أمر التشغيل',
      args: 'الوسائط',
      addArg: '+ إضافة وسيطة',
      envVars: 'متغيرات البيئة',
      addEnvVar: '+ إضافة متغير بيئة',
      passthrough: 'تمرير متغير البيئة',
      addPassthrough: '+ إضافة متغير',
      cwd: 'دليل العمل',
      url: 'URL',
      headers: 'الترويسات',
      addHeader: '+ إضافة ترويسة',
      auth: 'المصادقة',
      authNone: 'بلا',
      authOauth: 'OAuth',
      authBearer: 'رمز Bearer',
      keyPlaceholder: 'KEY',
      valuePlaceholder: 'القيمة',
      removeRow: 'إزالة هذا الصف',
      editJson: 'تحرير mcp.json',
      saveFailed: 'لم يُحفظ ذلك الخادم.'
    },
    dialog: {
      disconnect: 'قطع الاتصال',
      disconnectTitle: (name: string) => `قطع الاتصال بـ${name}؟`,
      disconnectBody: 'يتوقف Hermes عن العمل كهذا الحساب. يمكنك إعادة الاتصال في أي وقت.',
      menuRefreshTools: 'تحديث الأدوات',
      moreActions: 'إجراءات أخرى',
      removeServerTitle: (name: string) => `إزالة ${name}؟`,
      removeServerBody: 'يُحذف الإدخال من mcp.json على هذا الحاسوب. لا يُحذف أي شيء آخر.',
      appSwitch: (name: string) => `يمكن لـHermes استخدام ${name}`,
      waysTitle: (name: string) => `أين يعمل ${name}`,
      wayNotConnected: (name: string) => `غير متصل بعد. سجّل الدخول إلى ${name} في متصفحك.`,
      wayHosted: 'مُدار',
      bothOn: (name: string) => `كلاهما يعمل، فيرى Hermes كل أدوات ${name} مرتين.`,
      turnOffLocal: 'إيقاف الخادم المحلي',
      providedByPlugin: (plugin: string) => `مقدَّم من إضافة ${plugin}`,
      openPlugins: 'فتح تبويب الإضافات',
      nousLine: 'تتبع تطبيقات Nous حسابك لا الملف الشخصي.',
      rulesReadOnly: 'لا يمكن تغيير القواعد حاليًا.',
      rulesAppOff: (name: string) => `شغّل ${name} لتغيير أدواته.`,
      rulesSignIn: 'سجّل الدخول لتغيير ما يجوز لـHermes فعله هنا.',
      orgNote: (count: number) => `أوقفت مؤسستك ${count} أداة.`,
      orgLink: 'فتح إدارة الموصّلات',
      connectEnded: 'لم يكتمل تسجيل الدخول.',
      connectOpenAgain: 'فتح الرابط مجددًا',
      tokensPerCall: 'رمز لكل استدعاء',
      usesPerMonth: 'استخدام في 30 يومًا',
      advanced: 'متقدم',
      advancedHint: 'إدخال mcp.json والسجلات'
    },
    tools: {
      title: 'الأدوات',
      notInstalledBody: 'ثبّته على هذا الجهاز لرؤية الأدوات التي يجلبها.',
      summaryTitle: (name: string) => `ما يجوز لـHermes فعله مع ${name}`,
      summaryPreviewTitle: (name: string) => `ما يمكن لـHermes فعله مع ${name} بعد الاتصال`,
      summaryCount: (count: number) => `${count} أداة`,
      summaryAllTools: 'كل الأدوات',
      summaryOther: 'أخرى',
      allToolsSwitch: 'تشغيل كل الأدوات أو إيقافها',
      summaryAllOn: 'الكل يعمل',
      summarySomeOn: (on: number, total: number) => `${on} من ${total} تعمل`,
      summaryOff: 'متوقفة',
      showAllTools: (count: number) => `عرض كل ${count} أداة`,
      showSummary: 'عرض الملخص',
      facetSwitch: (facet: string) => `تشغيل أدوات ${facet} أو إيقافها`,
      moreHints: (count: number) => `+${count}`,
      staleSignIn: 'سجّل الدخول لقراءة أحدث قائمة أدوات.',
      searchCountPlaceholder: (count: number) => `ابحث في ${count} أداة`,
      toolList: (name: string) => `أدوات ${name}`,
      categorySelect: (count: number) => `${count} فئة`,
      showDeprecated: (count: number) => `عرض ${count} أداة مهملة`,
      hideDeprecated: (count: number) => `إخفاء ${count} أداة مهملة`,
      quickReadOnly: 'قراءة فقط',
      quickNoDestructive: 'إيقاف المدمرة',
      quickEverythingOn: 'تشغيل الكل',
      lockedHint: 'متوقف من مؤسستك',
      turnToolOn: (tool: string) => `تشغيل ${tool}`,
      turnToolOff: (tool: string) => `إيقاف ${tool}`,
      showDetails: (tool: string) => `عرض ما تفعله ${tool}`,
      hideDetails: (tool: string) => `إخفاء ما تفعله ${tool}`,
      noMatch: 'لا أداة تطابق هذه المرشحات.',
      loading: 'جارٍ قراءة قائمة الأدوات',
      unavailableLine: 'قائمة الأدوات غير متاحة.',
      needsAuthTitle: (name: string) => `سجّل الدخول إلى ${name} لقراءة أدواته.`,
      needsAuthBody: 'يبقى تسجيل الدخول على هذا الحاسوب. لا يغادره أي شيء.',
      retry: 'إعادة المحاولة',
      goneTitle: (name: string) => `غادر ${name} الكتالوج.`,
      goneBody: 'لم يعد بإمكان Hermes استدعاؤه. يبقى الصف حتى تزيله، فلا يختفي أي شيء.',
      remove: 'إزالة',
      offTitle: (name: string) => `${name} متوقف.`,
      offBody: 'شغّله بالمفتاح أعلاه لقراءة الأدوات التي يجلبها.',
      signedOutTitle: 'سجّل الدخول إلى Nous لقراءة قائمة الأدوات.',
      signedOutBody: 'خوادمك على هذا الحاسوب غير متأثرة.',
      conflictTitle: 'غيّر شخص ما هذه القاعدة أثناء تحريرك.',
      conflictBody: (theyOff: number, theyOn: number) => {
        const they = [
          theyOff > 0 ? `أوقف ${theyOff} أداة لديك تعمل` : '',
          theyOn > 0 ? `أبقى ${theyOn} أداة تعمل وأنت أوقفتها` : ''
        ].filter(Boolean)

        return `${they.length > 0 ? `هم ${they.join('، و')}. ` : ''}تبقى تعديلاتك على الشاشة؛ لم يُكتب أي شيء.`
      },
      conflictReload: 'إعادة تحميل نسختهم',
      conflictSave: 'الحفظ فوق نسختهم',
      saveFailed: 'لم تُحفظ قواعد الأدوات هذه.',
      footerDirty: (off: number, backOn: number) =>
        `${off} أداة متوقفة، ${backOn === 0 ? 'لا شيء' : backOn} أُعيد تشغيلها`,
      discard: 'تجاهل',
      save: 'حفظ التغييرات',
      saving: 'جارٍ الحفظ…'
    },
    vocabulary: {
      facetRead: {
        label: 'قراءة',
        long: 'يقرأ بيانات من هذا التطبيق. لا يغيّر شيئًا.'
      },
      facetWrite: {
        label: 'كتابة',
        long: 'ينشئ أو يغيّر شيئًا في هذا التطبيق.'
      },
      facetDestructive: {
        label: 'مدمّر',
        long: 'يمكنه حذف شيء في هذا التطبيق نهائيًا.'
      },
      facetUnclassified: {
        label: 'أثر مجهول',
        long: 'لم يوضّح التطبيق ما تفعله هذه الأداة.'
      },
      hintReadOnly: {
        label: 'قراءة فقط',
        long: 'تصرّح الأداة أنها تقرأ فقط.'
      },
      hintCreate: {
        label: 'إنشاء',
        long: 'تُنشئ شيئًا جديدًا.'
      },
      hintUpdate: {
        label: 'تحديث',
        long: 'تغيّر شيئًا موجودًا.'
      },
      hintDelete: {
        label: 'حذف',
        long: 'تزيل شيئًا.'
      },
      hintDestructive: {
        label: 'مدمّر',
        long: 'التغيير الذي تجريه لا يمكن التراجع عنه هنا.'
      },
      hintIdempotent: {
        label: 'قابل للتكرار',
        long: 'تشغيله مرتين يفعل ما تفعله مرة واحدة.'
      },
      hintOpenWorld: {
        label: 'خارجي',
        long: 'يصل إلى شيء خارج هذا التطبيق.'
      }
    }
  }
})
