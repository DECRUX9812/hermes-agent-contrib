import type { TranslationOverrides } from './define-locale'

export const arAssistant = {
  assistant: {
    catalogInstall: {
      preparing: 'جارٍ تجهيز التثبيت…',
      install: 'تثبيت',
      advanced: 'خيارات متقدمة',
      skip: 'تخطٍّ',
      installing: 'جارٍ التثبيت…',
      installed: 'مثبّت',
      notInstalled: 'غير مثبّت',
      failed: 'فشل',
      showNames: 'إظهار الأسماء',
      hideNames: 'إخفاء الأسماء',
      skill: name => `المهارة ${name}`,
      kind: { plugin: 'إضافة', skill: 'مهارة' },
      tier: { official: 'رسمي', community: 'مجتمعي' },
      targetProfile: profile => `يُثبَّت في ملفك الشخصي ${profile}`,
      sendFailed: 'تعذّر إرسال ردك. حاول مرة أخرى.',
      commitLabel: 'الإيداع',
      subdirLabel: 'المجلد',
      securityHeading: 'الأمان',
      scan: { passed: 'نجح الفحص', warnings: 'وجد الفحص تحذيرات', failed: 'فشل الفحص' },
      requirementsLabel: 'المتطلبات',
      credentialsHeading: 'بيانات الاعتماد'
    },
    thread: {
      loadingSession: 'جار تحميل الجلسة...',
      showEarlier: 'عرض الرسائل الأقدم',
      loadingResponse: 'جار تحميل الرد...',
      resumeWhenBackgroundDone: count =>
        count === 1 ? 'سيُستأنف عند انتهاء المهمة الخلفية' : `سيُستأنف عند انتهاء ${count} مهام خلفية`,
      thinking: 'يفكر...',
      thought: 'فكّر',
      thoughtBriefly: 'فكّر قليلاً',
      thoughtFor: duration => `فكّر لمدة ${duration}`,
      turnDuration: duration => `استغرقت هذه الجولة ${duration}`,
      today: time => `اليوم ${time}`,
      yesterday: time => `أمس ${time}`,
      copy: 'نسخ',
      refresh: 'تحديث',
      moreActions: 'إجراءات إضافية',
      branchNewChat: 'تفريع إلى محادثة جديدة',
      react: 'تفاعل',
      dismissError: 'تجاهل الخطأ',
      errorLayers: {
        auth: 'خطأ في المصادقة',
        billing: 'نفاد الرصيد',
        disk: 'القرص ممتلئ',
        endpoint: 'خطأ في نقطة النهاية المخصصة',
        gateway: 'خطأ في البوابة',
        generic: 'فشلت الجولة',
        provider: 'خطأ من المزوّد',
        runtime: 'خطأ في بيئة التشغيل المحلية',
        streaming: 'خطأ في اتصال البث'
      },
      errorRetry: 'إعادة المحاولة',
      errorLimitResets: time => `يُعاد ضبط الحد عند ${time}`,
      errorRetryAtReset: time => `إعادة المحاولة عند إعادة ضبط الحد (${time})`,
      errorRetryScheduled: (time, wait) => `ستتم إعادة المحاولة عند ${time} — بعد ${wait}`,
      errorRetryScheduledCancel: 'إلغاء',
      errorStartNewSession: 'بدء جلسة جديدة',
      errorSwitchProvider: 'تبديل المزوّد',
      errorSignInAgain: provider => `تسجيل الدخول إلى ${provider} مجدداً`,
      errorOauthExpired: provider =>
        `انتهت صلاحية تسجيل دخولك إلى ${provider} أو تم إلغاؤه. سجّل الدخول مجدداً لمتابعة المحادثة.`,
      errorOpenLogs: 'فتح السجلات',
      errorOpenLogsFailed: 'تعذّر فتح مجلد السجلات',
      errorOpenDesktopLogs: 'فتح سجلات سطح المكتب',
      errorCopyDiagnostics: 'نسخ تفاصيل الخطأ',
      errorSendDiagnostics: 'إرسال التشخيصات',
      filesChanged: count => `${count} ملفات تم تغييرها`,
      reviewChanges: 'مراجعة',
      readAloudFailed: 'فشلت القراءة بصوت عال',
      preparingAudio: 'جار تجهيز الصوت',
      stopReading: 'إيقاف القراءة',
      readAloud: 'قراءة بصوت عال',
      copyFullResponse: 'نسخ الرد الكامل',
      readAloudFullResponseHint: 'انقر مع الضغط على Shift: قراءة الرد الكامل بصوت عال',
      editMessage: 'تحرير الرسالة',
      scrollToBottom: 'التمرير إلى الأسفل',
      stop: 'إيقاف',
      restorePrevious: 'استعادة السابق',
      restoreCheckpoint: 'استعادة النقطة',
      restoreFromHere: 'استعادة نقطة التحقق — إعادة التشغيل من هذا الموجّه',
      restoreTitle: 'الاستعادة إلى نقطة التحقق هذه؟',
      restoreBody: 'يُزال كل ما يلي هذا الموجّه من المحادثة، ويُعاد تشغيل الموجّه من هنا.',
      restoreConfirm: 'استعادة وإعادة تشغيل',
      restoreNext: 'استعادة التالي',
      goForward: 'تقدم',
      sendEdited: 'إرسال التعديل',
      attachingFile: 'جار إرفاق الملف',
      timelineScrubber: 'خريطة مصغّرة للنص',
      loadingLocalModel: model => `جارٍ تحميل ${model} إلى الذاكرة`,
      processingPrompt: 'جارٍ معالجة الطلب',
      errorLayerBodies: {
        auth: 'رفضت خدمة الذكاء الاصطناعي تسجيل دخولك. تحقق من بيانات اعتماد هذا المزوّد ثم أعد إرسال رسالتك.',
        billing: 'لا أرصدة متبقية في حسابك لهذا المزوّد. اشحن رصيدك أو بدّل المزوّد ثم أعد الإرسال.',
        disk: 'القرص ممتلئ فتعذّر على Hermes حفظ هذه المحادثة. وفّر مساحة ثم أعد المحاولة.',
        endpoint: 'لا يستطيع Hermes الوصول إلى خادم النموذج المخصص لديك. تحقق من أنه يعمل ثم أعد إرسال رسالتك.',
        gateway: 'واجه Hermes مشكلة داخلية أثناء بدء هذا الرد. أعد إرسال رسالتك؛ إن تكرر الأمر فأرسل التشخيصات.',
        generic: 'حدث خطأ أثناء رد Hermes. أعد المحاولة، أو انسخ التفاصيل إن تكرر الأمر.',
        provider: 'تعذّر على خدمة الذكاء الاصطناعي إتمام هذا الطلب. أعد المحاولة بعد لحظة أو بدّل المزوّد.',
        runtime: 'واجه Hermes مشكلة داخلية أثناء بدء هذا الرد. أعد إرسال رسالتك؛ إن تكرر الأمر فأرسل التشخيصات.',
        streaming: 'انقطع الاتصال قبل اكتمال الرد. أعد المحاولة لإرساله مجددًا.'
      },
      errorCodes: {
        auth: {
          title: provider => `رفض ${provider} تسجيل دخولك`,
          body: provider =>
            `لم تُقبل بيانات الاعتماد المحفوظة لـ${provider}. صحّحها في الإعدادات أو بدّل المزوّد ثم أعد إرسال رسالتك.`
        },
        auth_permanent: {
          title: provider => `رفض ${provider} تسجيل دخولك`,
          body: provider =>
            `بيانات الاعتماد المحفوظة لـ${provider} غير صالحة أو أُلغيت. حدّثها أو بدّل المزوّد ثم أعد إرسال رسالتك.`
        },
        billing: {
          title: 'نفدت الأرصدة',
          body: provider => `لا أرصدة متبقية في حساب ${provider} لديك. اشحن رصيدك أو بدّل المزوّد ثم أعد الإرسال.`
        },
        rate_limit: {
          title: 'خدمة الذكاء الاصطناعي مشغولة',
          body: provider => `يحدّ ${provider} من الطلبات حاليًا. انتظر دقيقة ثم أعد المحاولة.`
        },
        upstream_rate_limit: {
          title: 'خدمة الذكاء الاصطناعي مشغولة',
          body: provider => `يحدّ ${provider} من الطلبات حاليًا. انتظر دقيقة ثم أعد المحاولة.`
        },
        overloaded: {
          title: 'خدمة الذكاء الاصطناعي مثقلة',
          body: provider => `يواجه ${provider} مشاكل حاليًا. أعد المحاولة بعد لحظة أو بدّل المزوّد.`
        },
        server_error: {
          title: 'حدثت مشكلة في خدمة الذكاء الاصطناعي',
          body: provider => `أعاد ${provider} خطأ خادم. أعد المحاولة بعد لحظة أو بدّل المزوّد.`
        },
        timeout: {
          title: 'انتهت مهلة الرد',
          body: provider => `لم يردّ ${provider} في الوقت المحدد. أعد المحاولة لإرساله مجددًا.`
        },
        stream_drop: {
          title: 'انقطع الرد',
          body: 'انقطع الاتصال قبل اكتمال الرد. أعد المحاولة لإرساله مجددًا.'
        },
        upstream_blocked: {
          title: 'حجب جدار ناري الطلب',
          body: provider =>
            `حجب جدار ناري أو CDN أمام ${provider} الطلب قبل وصوله إلى النموذج — مفتاحك سليم على الأرجح. اضبط ترويسة User-Agent عبر extra_headers للمزوّد في الإعدادات، أو بدّل المزوّد، ثم أعد إرسال رسالتك.`
        },
        ssl_cert_verification: {
          title: 'فشل الاتصال الآمن',
          body: provider =>
            `تعذّر على Hermes التحقق من الاتصال الآمن بـ${provider}. تحقق من إعدادات الشبكة أو الوكيل، أو بدّل المزوّد، ثم أعد إرسال رسالتك.`
        },
        context_overflow: {
          title: 'هذه المحادثة طويلة جدًا',
          body: 'لم تعد المحادثة تسع في النموذج. اضغطها أو ابدأ محادثة جديدة ثم أعد الإرسال.'
        },
        payload_too_large: {
          title: 'هذه الرسالة كبيرة جدًا',
          body: 'كان الطلب كبيرًا على النموذج. اضغط المحادثة أو ابدأ محادثة جديدة ثم أعد الإرسال.'
        },
        model_not_found: {
          title: 'هذا النموذج غير متاح',
          body: provider => `لا يوفّر ${provider} هذا النموذج على حسابك. اختر نموذجًا آخر ثم أعد إرسال رسالتك.`
        },
        provider_policy_blocked: {
          title: 'هذا النموذج محظور بإعدادات حسابك',
          body: provider =>
            `لن يوجّه ${provider} هذا الطلب بموجب إعدادات البيانات أو الخصوصية في حسابك. اختر نموذجًا آخر أو بدّل المزوّد.`
        },
        content_policy_blocked: {
          title: 'رفضت خدمة الذكاء الاصطناعي هذا الطلب',
          body: provider => `لن يجيب ${provider} على هذه الرسالة. عدّلها وأعد الإرسال.`
        },
        format_error: {
          title: 'رفضت خدمة الذكاء الاصطناعي الطلب',
          body: provider => `لم يقبل ${provider} كيفية بناء هذا الطلب. بدّل المزوّد أو أرسل التشخيصات لننظر في الأمر.`
        },
        truncated: {
          title: 'اقتُطع الرد',
          body: 'توقف النموذج قبل الإتمام. أعد المحاولة للحصول على رد كامل.'
        },
        invalid_response: {
          title: 'أرسلت خدمة الذكاء الاصطناعي ردًا غير مقروء',
          body: provider => `أعاد ${provider} شيئًا لم يستطع Hermes قراءته. أعد المحاولة بعد لحظة.`
        },
        empty_response: {
          title: 'أرسلت خدمة الذكاء الاصطناعي ردًا فارغًا',
          body: provider => `لم يُعد ${provider} شيئًا لهذه الرسالة. أعد المحاولة بعد لحظة.`
        },
        loop_error: {
          title: 'علق Hermes في حلقة',
          body: 'ظل الرد يكرر الخطوات نفسها فأوقفه Hermes. أعد المحاولة، أو ابدأ محادثة جديدة إن تكرر الأمر.'
        },
        SESSION_NOT_OWNED: {
          title: 'هذه المحادثة مفتوحة في مكان آخر',
          body: 'هذه المحادثة مفتوحة حاليًا في نافذة أو طرفية Hermes أخرى. أغلقها هناك وأعد إرسال رسالتك، أو ابدأ محادثة جديدة هنا.'
        },
        disk_full: {
          title: 'القرص ممتلئ',
          body: 'القرص ممتلئ فتعذّر على Hermes حفظ هذه المحادثة. وفّر مساحة ثم أعد المحاولة.'
        },
        free_tier_disabled: {
          title: 'استخدام Hermes دون تسجيل الدخول متوقف حاليًا',
          body: 'سجّل الدخول بحساب Nous لمتابعة المحادثة، إنه مجاني.'
        },
        free_tier_rate_limited: {
          title: 'استنفدت حصة المحادثة دون تسجيل الدخول',
          body: 'ستتجدد قريبًا. سجّل الدخول بحساب Nous لحصة أكبر، إنه مجاني.'
        },
        free_tier_at_capacity: {
          title: 'المحادثة دون تسجيل الدخول مزدحمة جدًا حاليًا',
          body: 'سجّل الدخول لتخطي الطابور مجانًا، أو أعد المحاولة بعد قليل.'
        },
        free_tier_model_not_free: {
          title: 'هذا النموذج غير متاح دون تسجيل الدخول',
          body: 'يستخدم Hermes النموذج المجاني الآن. سجّل الدخول بحساب Nous لمزيد من النماذج، إنه مجاني.'
        },
        free_tier_route: {
          title: 'تعذّر على Hermes الوصول إلى النموذج المجاني عبر هذا المسار',
          body: 'سجّل الدخول بحساب Nous مجانًا، أو تحقق من إعداد NOUS_INFERENCE_BASE_URL.'
        },
        free_tier_outage: {
          title: 'يواجه النموذج المجاني مشكلة في الرد حاليًا',
          body: 'حاول إرسال رسالتك مجددًا بعد دقيقة.'
        },
        free_tier_refused: {
          title: 'تعذّر على Hermes إرسال ذلك دون تسجيل الدخول',
          body: 'تسجيل الدخول بحساب Nous مجاني.'
        }
      },
      errorAuthKinds: {
        api_key: {
          title: provider => `رفض ${provider} مفتاح API لديك`,
          body: provider => `المفتاح المحفوظ لـ${provider} غير صالح أو أُلغي. حدّثه ثم أعد المحاولة.`
        },
        oauth: {
          title: provider => `انتهت صلاحية تسجيل دخولك إلى ${provider}`
        }
      },
      errorDetails: 'التفاصيل',
      errorGenericProvider: 'خدمة الذكاء الاصطناعي',
      errorToastTitle: 'تعذّر على Hermes إتمام الرد',
      errorChooseModel: 'اختيار نموذج',
      errorCompressConversation: 'ضغط المحادثة',
      errorCompressFailed: 'تعذّر ضغط المحادثة',
      errorOpenHermesFolder: 'فتح مجلد Hermes',
      errorOpenHermesFolderFailed: 'تعذّر فتح مجلد Hermes',
      errorUpdateApiKey: 'تحديث مفتاح API',
      errorSignInFreeTier: 'تسجيل الدخول بحساب Nous',
      copyMarkdown: 'نسخ بتنسيق Markdown',
      expandMessage: 'توسيع الرسالة'
    },
    approval: {
      gatewayDisconnected: 'البوابة غير متصلة',
      sendFailed: 'فشل الإرسال',
      run: 'تشغيل',
      command: 'الأمر',
      moreOptions: 'خيارات إضافية',
      allowSession: 'السماح لهذه الجلسة',
      alwaysAllowMenu: 'السماح دائما',
      jumpToApproval: 'الموافقة مطلوبة',
      reject: 'رفض',
      alwaysTitle: 'السماح دائما',
      alwaysDescription: pattern => `السماح دائما بالأوامر المطابقة لـ ${pattern}`,
      alwaysAllow: 'السماح دائما',
      reconnect: 'إعادة الاتصال',
      timedOutSystemLine:
        'انتهت مهلة الموافقة — لم يُنفَّذ الأمر. اطلب من Hermes إعادة المحاولة، أو ارفع الحد في الإعدادات ← الأمان ← مهلة الموافقة.',
      openSafetySettings: 'فتح إعدادات الأمان',
      commandDetails: 'تفاصيل الأمر'
    },
    clarify: {
      notReady: 'غير جاهز',
      gatewayDisconnected: 'البوابة غير متصلة',
      sendFailed: 'فشل الإرسال',
      loadingQuestion: 'جار تحميل السؤال...',
      other: 'غير ذلك',
      placeholder: 'اكتب إجابتك...',
      skip: 'تخطي',
      confirmAndContinueLabel: 'تأكيد ومتابعة',
      singleSelectHint: 'اختر واحدا',
      multiSelectHint: 'حدد كل ما ينطبق',
      questionProgress: (answered, total) => `تمت الإجابة على ${answered} من ${total}`
    },
    tool: {
      copyCode: 'نسخ الكود',
      renderingImage: 'جار عرض الصورة...',
      copyOutput: 'نسخ الإخراج',
      copyCommand: 'نسخ الأمر',
      copyContent: 'نسخ المحتوى',
      copyUrl: 'نسخ الرابط',
      copyResults: 'نسخ النتائج',
      copyQuery: 'نسخ الاستعلام',
      copyFile: 'نسخ الملف',
      copyPath: 'نسخ المسار',
      failedCalls: (count: number) => `عدد استدعاءات الأدوات الفاشلة: ${count}`,
      skillActivity: {
        loading: 'جارٍ تحميل المهارة',
        loaded: 'تم تحميل المهارة',
        loadFailed: 'تعذر تحميل المهارة',
        readingResource: 'جارٍ قراءة مورد المهارة',
        readResource: 'تمت قراءة مورد المهارة',
        resourceFailed: 'تعذرت قراءة مورد المهارة',
        listing: 'جارٍ عرض المهارات',
        listed: 'تم عرض المهارات',
        listFailed: 'تعذر عرض المهارات',
        unavailable: 'نتيجة المهارة غير متاحة'
      },
      outputAlt: 'إخراج الأداة',
      rawResponse: 'الرد الخام',
      copyActivity: 'نسخ النشاط',
      recoveredOne: 'تم الاسترداد',
      recoveredMany: count => `تم استرداد ${count}`,
      failedOne: 'فشل',
      failedMany: count => `فشل ${count}`,
      statusRunning: 'يعمل',
      statusError: 'خطأ',
      statusRecovered: 'تم الاسترداد',
      statusDone: 'تم',
      resultUnavailable: 'النتيجة غير متاحة',
      resultInterrupted: 'تمت المقاطعة',
      memoryWriteNoted: 'تم تسجيل كتابة الذاكرة',
      actions: {
        read: 'قراءة',
        reading: 'جار القراءة',
        opened: 'تم الفتح',
        opening: 'جار الفتح',
        searched: 'تم البحث',
        searching: 'جار البحث',
        ran: 'تم التشغيل',
        running: 'جار التشغيل',
        ranCode: 'تم تشغيل الكود',
        runningCode: 'جار البرمجة',
        failedToOpen: 'فشل الفتح'
      },
      prefixes: {
        browser: 'المتصفح',
        web: 'الويب'
      },
      titleTemplates: {
        actionCommand: (action, command) => `${action} ${command}`,
        actionQuoted: (action, value) => `${action} “${value}”`,
        actionTarget: (action, target) => `${action} ${target}`,
        prefixedDone: (prefix, action) => `${prefix} ${action}`,
        runningPrefixedTool: (prefix, action) => `جار تشغيل ${prefix.toLowerCase()} ${action.toLowerCase()}`,
        runningTool: action => `جار تشغيل ${action.toLowerCase()}`
      },
      titles: {
        browser_click: {
          done: 'تم النقر على عنصر الصفحة',
          pending: 'جار النقر على عنصر الصفحة',
          pendingAction: 'جار النقر'
        },
        browser_fill: {
          done: 'تم ملء حقل النموذج',
          pending: 'جار ملء حقل النموذج',
          pendingAction: 'جار الملء'
        },
        browser_navigate: {
          done: 'تم فتح الصفحة',
          pending: 'جار فتح الصفحة',
          pendingAction: 'جار الفتح'
        },
        browser_snapshot: {
          done: 'تم التقاط لقطة الصفحة',
          pending: 'جار التقاط لقطة الصفحة',
          pendingAction: 'جار الالتقاط'
        },
        browser_take_screenshot: {
          done: 'تم التقاط لقطة الشاشة',
          pending: 'جار التقاط لقطة الشاشة',
          pendingAction: 'جار الالتقاط'
        },
        browser_type: {
          done: 'تمت الكتابة على الصفحة',
          pending: 'جار الكتابة على الصفحة',
          pendingAction: 'جار الكتابة'
        },
        clarify: {
          done: 'تم طرح سؤال',
          pending: 'جار طرح سؤال',
          pendingAction: 'جار السؤال'
        },
        cronjob: {
          done: 'مهمة مجدولة',
          pending: 'جار جدولة المهمة',
          pendingAction: 'جار الجدولة'
        },
        edit_file: {
          done: 'تم تحرير الملف',
          pending: 'جار تحرير الملف',
          pendingAction: 'جار التحرير'
        },
        execute_code: {
          done: 'تم تشغيل الكود',
          pending: 'جار البرمجة',
          pendingAction: 'جار البرمجة'
        },
        image_generate: {
          done: 'تم إنشاء الصورة',
          pending: 'جار إنشاء الصورة',
          pendingAction: 'جار الإنشاء'
        },
        list_files: {
          done: 'تم سرد الملفات',
          pending: 'جار سرد الملفات',
          pendingAction: 'جار السرد'
        },
        memory: {
          done: 'تم الحفظ في الذاكرة',
          pending: 'جار الحفظ في الذاكرة',
          pendingAction: 'جار الحفظ'
        },
        patch: {
          done: 'تم تصحيح الملف',
          pending: 'جار تصحيح الملف',
          pendingAction: 'جار التصحيح'
        },
        read_file: {
          done: 'تمت قراءة الملف',
          pending: 'جار قراءة الملف',
          pendingAction: 'جار القراءة'
        },
        search_files: {
          done: 'تم البحث في الملفات',
          pending: 'جار البحث في الملفات',
          pendingAction: 'جار البحث'
        },
        session_search_recall: {
          done: 'تم البحث في سجل الجلسة',
          pending: 'جار البحث في سجل الجلسة',
          pendingAction: 'جار البحث'
        },
        terminal: {
          done: 'تم تشغيل الأمر',
          pending: 'جار تشغيل الأمر',
          pendingAction: 'جار التشغيل'
        },
        todo: {
          done: 'تم تحديث المهام',
          pending: 'جار تحديث المهام',
          pendingAction: 'جار التحديث'
        },
        vision_analyze: {
          done: 'تم تحليل الصورة',
          pending: 'جار تحليل الصورة',
          pendingAction: 'جار التحليل'
        },
        web_extract: {
          done: 'تمت قراءة صفحة الويب',
          pending: 'جار قراءة صفحة الويب',
          pendingAction: 'جار القراءة'
        },
        web_search: {
          done: 'تم البحث في الويب',
          pending: 'جار البحث في الويب',
          pendingAction: 'جار البحث'
        },
        write_file: {
          done: 'تم تحرير الملف',
          pending: 'جار تحرير الملف',
          pendingAction: 'جار التحرير'
        }
      }
    },
    sessionRecap: {
      title: 'أين توقّفت',
      dismiss: 'إغلاق',
      turns: count => `${count} جولة`,
      todo: progress => `خطة ${progress}`
    },
    mcpSetup: {
      installTitle: 'إضافة خوادم MCP',
      enableTitle: 'تفعيل خوادم MCP',
      authorizeTitle: 'تفويض خوادم MCP',
      installAction: 'تثبيت',
      enableAction: 'تفعيل',
      authorizeAction: 'تفويض',
      installed: server => `ثُبّت ${server}`,
      enabled: server => `فُعّل ${server}`,
      authorized: server => `فُوّض ${server}`,
      failed: server => `فشل إعداد ${server}`,
      toolCount: count => (count === 1 ? 'أداة واحدة' : `${count} أداة`),
      envRequired: 'املأ بيانات الاعتماد المطلوبة أولًا',
      sendFailed: 'تعذّر إرسال رد إعداد MCP',
      reloadFailed: 'حُفظ الخادم، لكن فشلت إعادة تحميل أدوات MCP — تُحمَّل الجلسة المقبلة',
      gatewayDisconnected: 'Hermes غير متصل الآن. أعد الاتصال ثم أرسلها مجددًا.'
    }
  }
} satisfies Pick<TranslationOverrides, 'assistant'>
