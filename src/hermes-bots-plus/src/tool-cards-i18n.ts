/**
 * Bot Chat tool card strings, shipped with the plugin and registered under its
 * i18n id as `toolCards.*`. English is the fallback for any locale without a
 * bundle here. Moved out of the core catalog: only this plugin draws tool cards.
 */

import { type PluginLocaleBundles, type PluginTranslate, usePluginI18n } from '@hermes/plugin-sdk'
import { useMemo } from 'react'

import { bind, type Bound } from './i18n-bind'
import { i18nId } from './shared'

/** Live tool activity cards (Bot Mode DMs and group rooms). */
export type ToolCardsCopy = {
  /** Accessible name of a stack of cards. */
  activityLabel: string
  /** Human name per tool family, shown in bold on the card. */
  families: {
    browser: string
    code: string
    files: string
    generic: string
    mcp: string
    search: string
    terminal: string
    web: string
  }
  /** Names for well-known tools that fall in the generic family. */
  names: {
    memory: string
    message: string
    schedule: string
    skills: string
    vision: string
  }
  /** A settled run of the same tool: "Used Browser ×3". */
  usedTimes: (name: string, count: number) => string
  /** Status while a call has no better line yet. */
  working: string
  /** A live browser step heading to a site. */
  opening: (host: string) => string
  awaitingApproval: string
  reviewApproval: string
  failed: string
  stopped: string
  /** Present/past statuses for tools the transcript has no title for. */
  statuses: Record<
    'browser_back' | 'browser_console' | 'browser_get_images' | 'browser_press' | 'browser_scroll' | 'browser_vision',
    { done: string; pending: string }
  >
  /** Detail rows inside an expanded card. */
  details: {
    request: string
    output: string
    duration: string
    noOutput: string
  }
  /** Labels for the human summary of a call's arguments. */
  argLabels: {
    code: string
    command: string
    input: string
    path: string
    query: string
    target: string
    text: string
    url: string
  }
  /** The browser steps viewer. */
  viewer: {
    title: (name: string) => string
    step: (index: number, total: number) => string
    noScreenshot: string
    previous: string
    next: string
    /** Opens the step's page in the preview pane. */
    openPage: string
  }
}

const TOOL_CARDS_EN: ToolCardsCopy = {
  activityLabel: 'Tool activity',
  families: {
    browser: 'Browser',
    code: 'Code',
    files: 'Files',
    generic: 'Tool',
    mcp: 'Connector',
    search: 'Search',
    terminal: 'Terminal',
    web: 'Web'
  },
  names: {
    memory: 'Memory',
    message: 'Messages',
    schedule: 'Schedule',
    skills: 'Skills',
    vision: 'Vision'
  },
  usedTimes: (name, count) => `Used ${name} ×${count}`,
  working: 'Working…',
  opening: host => `Opening ${host}…`,
  awaitingApproval: 'Waiting for your approval',
  reviewApproval: 'Review',
  failed: 'Failed',
  stopped: 'Stopped',
  statuses: {
    browser_back: { done: 'Went back', pending: 'Going back' },
    browser_console: { done: 'Read the page console', pending: 'Reading the page console' },
    browser_get_images: { done: 'Collected page images', pending: 'Collecting page images' },
    browser_press: { done: 'Pressed a key', pending: 'Pressing a key' },
    browser_scroll: { done: 'Scrolled the page', pending: 'Scrolling the page' },
    browser_vision: { done: 'Looked at the page', pending: 'Looking at the page' }
  },
  details: {
    request: 'Request',
    output: 'Output',
    duration: 'Took',
    noOutput: 'No output'
  },
  argLabels: {
    code: 'Code',
    command: 'Command',
    input: 'Input',
    path: 'File',
    query: 'Search',
    target: 'Target',
    text: 'Text',
    url: 'Address'
  },
  viewer: {
    title: name => `${name} steps`,
    step: (index, total) => `Step ${index} of ${total}`,
    noScreenshot: 'No screenshot for this step',
    previous: 'Previous step',
    next: 'Next step',
    openPage: 'Open page'
  }
}

const TOOL_CARDS_DE: ToolCardsCopy = {
  activityLabel: 'Werkzeugaktivität',
  families: {
    browser: 'Browser',
    code: 'Code',
    files: 'Dateien',
    generic: 'Werkzeug',
    mcp: 'Connector',
    search: 'Suche',
    terminal: 'Terminal',
    web: 'Web'
  },
  names: {
    memory: 'Gedächtnis',
    message: 'Nachrichten',
    schedule: 'Zeitplan',
    skills: 'Skills',
    vision: 'Bildanalyse'
  },
  usedTimes: (name, count) => `${name} ×${count} genutzt`,
  working: 'Läuft…',
  opening: host => `Öffne ${host}…`,
  awaitingApproval: 'Wartet auf Ihre Freigabe',
  reviewApproval: 'Prüfen',
  failed: 'Fehlgeschlagen',
  stopped: 'Abgebrochen',
  statuses: {
    browser_back: { done: 'Zurückgegangen', pending: 'Geht zurück' },
    browser_console: { done: 'Seitenkonsole gelesen', pending: 'Liest die Seitenkonsole' },
    browser_get_images: { done: 'Seitenbilder gesammelt', pending: 'Sammelt Seitenbilder' },
    browser_press: { done: 'Taste gedrückt', pending: 'Drückt eine Taste' },
    browser_scroll: { done: 'Seite gescrollt', pending: 'Scrollt die Seite' },
    browser_vision: { done: 'Seite betrachtet', pending: 'Betrachtet die Seite' }
  },
  details: {
    request: 'Anfrage',
    output: 'Ausgabe',
    duration: 'Dauer',
    noOutput: 'Keine Ausgabe'
  },
  argLabels: {
    code: 'Code',
    command: 'Befehl',
    input: 'Eingabe',
    path: 'Datei',
    query: 'Suche',
    target: 'Ziel',
    text: 'Text',
    url: 'Adresse'
  },
  viewer: {
    title: name => `Schritte: ${name}`,
    step: (index, total) => `Schritt ${index} von ${total}`,
    noScreenshot: 'Für diesen Schritt gibt es keinen Screenshot',
    previous: 'Vorheriger Schritt',
    next: 'Nächster Schritt',
    openPage: 'Seite öffnen'
  }
}

const TOOL_CARDS_ES: ToolCardsCopy = {
  activityLabel: 'Actividad de herramientas',
  families: {
    browser: 'Navegador',
    code: 'Código',
    files: 'Archivos',
    generic: 'Herramienta',
    mcp: 'Conector',
    search: 'Búsqueda',
    terminal: 'Terminal',
    web: 'Web'
  },
  names: {
    memory: 'Memoria',
    message: 'Mensajes',
    schedule: 'Programación',
    skills: 'Habilidades',
    vision: 'Visión'
  },
  usedTimes: (name, count) => `Usó ${name} ×${count}`,
  working: 'Trabajando…',
  opening: host => `Abriendo ${host}…`,
  awaitingApproval: 'Esperando tu aprobación',
  reviewApproval: 'Revisar',
  failed: 'Error',
  stopped: 'Detenido',
  statuses: {
    browser_back: { done: 'Volvió atrás', pending: 'Volviendo atrás' },
    browser_console: { done: 'Leyó la consola de la página', pending: 'Leyendo la consola de la página' },
    browser_get_images: { done: 'Recopiló imágenes de la página', pending: 'Recopilando imágenes de la página' },
    browser_press: { done: 'Pulsó una tecla', pending: 'Pulsando una tecla' },
    browser_scroll: { done: 'Desplazó la página', pending: 'Desplazando la página' },
    browser_vision: { done: 'Miró la página', pending: 'Mirando la página' }
  },
  details: {
    request: 'Solicitud',
    output: 'Salida',
    duration: 'Duración',
    noOutput: 'Sin salida'
  },
  argLabels: {
    code: 'Código',
    command: 'Comando',
    input: 'Entrada',
    path: 'Archivo',
    query: 'Búsqueda',
    target: 'Destino',
    text: 'Texto',
    url: 'Dirección'
  },
  viewer: {
    title: name => `Pasos de ${name}`,
    step: (index, total) => `Paso ${index} de ${total}`,
    noScreenshot: 'No hay captura para este paso',
    previous: 'Paso anterior',
    next: 'Paso siguiente',
    openPage: 'Abrir página'
  }
}

const TOOL_CARDS_FR: ToolCardsCopy = {
  activityLabel: 'Activité des outils',
  families: {
    browser: 'Navigateur',
    code: 'Code',
    files: 'Fichiers',
    generic: 'Outil',
    mcp: 'Connecteur',
    search: 'Recherche',
    terminal: 'Terminal',
    web: 'Web'
  },
  names: {
    memory: 'Mémoire',
    message: 'Messages',
    schedule: 'Planification',
    skills: 'Compétences',
    vision: 'Vision'
  },
  usedTimes: (name, count) => `Utilisé ${name} ×${count}`,
  working: 'En cours…',
  opening: host => `Ouverture de ${host}…`,
  awaitingApproval: 'En attente de votre approbation',
  reviewApproval: 'Examiner',
  failed: 'Échec',
  stopped: 'Arrêté',
  statuses: {
    browser_back: { done: 'Est revenu en arrière', pending: 'Revient en arrière' },
    browser_console: { done: 'A lu la console de la page', pending: 'Lit la console de la page' },
    browser_get_images: { done: 'A rassemblé les images de la page', pending: 'Rassemble les images de la page' },
    browser_press: { done: 'A appuyé sur une touche', pending: 'Appuie sur une touche' },
    browser_scroll: { done: 'A fait défiler la page', pending: 'Fait défiler la page' },
    browser_vision: { done: 'A regardé la page', pending: 'Regarde la page' }
  },
  details: {
    request: 'Demande',
    output: 'Sortie',
    duration: 'Durée',
    noOutput: 'Aucune sortie'
  },
  argLabels: {
    code: 'Code',
    command: 'Commande',
    input: 'Entrée',
    path: 'Fichier',
    query: 'Recherche',
    target: 'Cible',
    text: 'Texte',
    url: 'Adresse'
  },
  viewer: {
    title: name => `Étapes de ${name}`,
    step: (index, total) => `Étape ${index} sur ${total}`,
    noScreenshot: 'Pas de capture pour cette étape',
    previous: 'Étape précédente',
    next: 'Étape suivante',
    openPage: 'Ouvrir la page'
  }
}

const TOOL_CARDS_JA: ToolCardsCopy = {
  activityLabel: 'ツールの動作',
  families: {
    browser: 'ブラウザ',
    code: 'コード',
    files: 'ファイル',
    generic: 'ツール',
    mcp: 'コネクタ',
    search: '検索',
    terminal: 'ターミナル',
    web: 'Web'
  },
  names: {
    memory: 'メモリ',
    message: 'メッセージ',
    schedule: 'スケジュール',
    skills: 'スキル',
    vision: 'ビジョン'
  },
  usedTimes: (name, count) => `${name} ×${count} 回使用`,
  working: '処理中…',
  opening: host => `${host} を開いています…`,
  awaitingApproval: '承認待ち',
  reviewApproval: '確認',
  failed: '失敗',
  stopped: '停止しました',
  statuses: {
    browser_back: { done: '戻りました', pending: '戻っています' },
    browser_console: { done: 'ページのコンソールを読みました', pending: 'ページのコンソールを読んでいます' },
    browser_get_images: { done: 'ページの画像を集めました', pending: 'ページの画像を集めています' },
    browser_press: { done: 'キーを押しました', pending: 'キーを押しています' },
    browser_scroll: { done: 'ページをスクロールしました', pending: 'ページをスクロールしています' },
    browser_vision: { done: 'ページを確認しました', pending: 'ページを確認しています' }
  },
  details: {
    request: 'リクエスト',
    output: '出力',
    duration: '所要時間',
    noOutput: '出力なし'
  },
  argLabels: {
    code: 'コード',
    command: 'コマンド',
    input: '入力',
    path: 'ファイル',
    query: '検索',
    target: '対象',
    text: 'テキスト',
    url: 'アドレス'
  },
  viewer: {
    title: name => `${name}のステップ`,
    step: (index, total) => `ステップ ${index} / ${total}`,
    noScreenshot: 'このステップのスクリーンショットはありません',
    previous: '前のステップ',
    next: '次のステップ',
    openPage: 'ページを開く'
  }
}

const TOOL_CARDS_RU: ToolCardsCopy = {
  activityLabel: 'Активность инструментов',
  families: {
    browser: 'Браузер',
    code: 'Код',
    files: 'Файлы',
    generic: 'Инструмент',
    mcp: 'Коннектор',
    search: 'Поиск',
    terminal: 'Терминал',
    web: 'Веб'
  },
  names: {
    memory: 'Память',
    message: 'Сообщения',
    schedule: 'Расписание',
    skills: 'Навыки',
    vision: 'Зрение'
  },
  usedTimes: (name, count) => `Использовано: ${name} ×${count}`,
  working: 'Выполняется…',
  opening: host => `Открываю ${host}…`,
  awaitingApproval: 'Ждёт вашего подтверждения',
  reviewApproval: 'Проверить',
  failed: 'Ошибка',
  stopped: 'Остановлено',
  statuses: {
    browser_back: { done: 'Вернулся назад', pending: 'Возвращается назад' },
    browser_console: { done: 'Прочитал консоль страницы', pending: 'Читает консоль страницы' },
    browser_get_images: { done: 'Собрал изображения страницы', pending: 'Собирает изображения страницы' },
    browser_press: { done: 'Нажал клавишу', pending: 'Нажимает клавишу' },
    browser_scroll: { done: 'Прокрутил страницу', pending: 'Прокручивает страницу' },
    browser_vision: { done: 'Посмотрел на страницу', pending: 'Смотрит на страницу' }
  },
  details: {
    request: 'Запрос',
    output: 'Вывод',
    duration: 'Длительность',
    noOutput: 'Нет вывода'
  },
  argLabels: {
    code: 'Код',
    command: 'Команда',
    input: 'Ввод',
    path: 'Файл',
    query: 'Поиск',
    target: 'Цель',
    text: 'Текст',
    url: 'Адрес'
  },
  viewer: {
    title: name => `Шаги: ${name}`,
    step: (index, total) => `Шаг ${index} из ${total}`,
    noScreenshot: 'Для этого шага нет снимка',
    previous: 'Предыдущий шаг',
    next: 'Следующий шаг',
    openPage: 'Открыть страницу'
  }
}

const TOOL_CARDS_ZH: ToolCardsCopy = {
  activityLabel: '工具活动',
  families: {
    browser: '浏览器',
    code: '代码',
    files: '文件',
    generic: '工具',
    mcp: '连接器',
    search: '搜索',
    terminal: '终端',
    web: '网页'
  },
  names: {
    memory: '记忆',
    message: '消息',
    schedule: '计划任务',
    skills: '技能',
    vision: '视觉'
  },
  usedTimes: (name, count) => `已使用 ${name} ×${count}`,
  working: '处理中…',
  opening: host => `正在打开 ${host}…`,
  awaitingApproval: '等待你的批准',
  reviewApproval: '查看',
  failed: '失败',
  stopped: '已停止',
  statuses: {
    browser_back: { done: '已返回', pending: '正在返回' },
    browser_console: { done: '已读取页面控制台', pending: '正在读取页面控制台' },
    browser_get_images: { done: '已收集页面图片', pending: '正在收集页面图片' },
    browser_press: { done: '已按键', pending: '正在按键' },
    browser_scroll: { done: '已滚动页面', pending: '正在滚动页面' },
    browser_vision: { done: '已查看页面', pending: '正在查看页面' }
  },
  details: {
    request: '请求',
    output: '输出',
    duration: '耗时',
    noOutput: '无输出'
  },
  argLabels: {
    code: '代码',
    command: '命令',
    input: '输入',
    path: '文件',
    query: '搜索',
    target: '目标',
    text: '文本',
    url: '地址'
  },
  viewer: {
    title: name => `${name}步骤`,
    step: (index, total) => `第 ${index} 步，共 ${total} 步`,
    noScreenshot: '此步骤没有截图',
    previous: '上一步',
    next: '下一步',
    openPage: '打开页面'
  }
}

const TOOL_CARDS_AR: ToolCardsCopy = {
  activityLabel: 'نشاط الأدوات',
  families: {
    browser: 'المتصفح',
    code: 'الشيفرة',
    files: 'الملفات',
    generic: 'أداة',
    mcp: 'موصّل',
    search: 'البحث',
    terminal: 'الطرفية',
    web: 'الويب'
  },
  names: {
    memory: 'الذاكرة',
    message: 'الرسائل',
    schedule: 'الجدولة',
    skills: 'المهارات',
    vision: 'الرؤية'
  },
  usedTimes: (name, count) => `استُخدم ${name} ×${count}`,
  working: 'جارٍ العمل…',
  opening: host => `جارٍ فتح ${host}…`,
  awaitingApproval: 'في انتظار موافقتك',
  reviewApproval: 'مراجعة',
  failed: 'فشل',
  stopped: 'توقّف',
  statuses: {
    browser_back: { done: 'عاد للخلف', pending: 'يعود للخلف' },
    browser_console: { done: 'قرأ وحدة تحكم الصفحة', pending: 'يقرأ وحدة تحكم الصفحة' },
    browser_get_images: { done: 'جمع صور الصفحة', pending: 'يجمع صور الصفحة' },
    browser_press: { done: 'ضغط على مفتاح', pending: 'يضغط على مفتاح' },
    browser_scroll: { done: 'مرر الصفحة', pending: 'يمرر الصفحة' },
    browser_vision: { done: 'نظر إلى الصفحة', pending: 'ينظر إلى الصفحة' }
  },
  details: {
    request: 'الطلب',
    output: 'المخرجات',
    duration: 'المدة',
    noOutput: 'لا توجد مخرجات'
  },
  argLabels: {
    code: 'الشيفرة',
    command: 'الأمر',
    input: 'الإدخال',
    path: 'الملف',
    query: 'البحث',
    target: 'الهدف',
    text: 'النص',
    url: 'العنوان'
  },
  viewer: {
    title: name => `خطوات ${name}`,
    step: (index, total) => `الخطوة ${index} من ${total}`,
    noScreenshot: 'لا توجد لقطة شاشة لهذه الخطوة',
    previous: 'الخطوة السابقة',
    next: 'الخطوة التالية',
    openPage: 'فتح الصفحة'
  }
}

const TOOL_CARDS_ZH_HANT: ToolCardsCopy = {
  activityLabel: '工具活動',
  families: {
    browser: '瀏覽器',
    code: '程式碼',
    files: '檔案',
    generic: '工具',
    mcp: '連接器',
    search: '搜尋',
    terminal: '終端機',
    web: '網頁'
  },
  names: {
    memory: '記憶',
    message: '訊息',
    schedule: '排程',
    skills: '技能',
    vision: '視覺'
  },
  usedTimes: (name, count) => `已使用 ${name} ×${count}`,
  working: '處理中…',
  opening: host => `正在開啟 ${host}…`,
  awaitingApproval: '等待你的批准',
  reviewApproval: '檢視',
  failed: '失敗',
  stopped: '已停止',
  statuses: {
    browser_back: { done: '已返回', pending: '正在返回' },
    browser_console: { done: '已讀取頁面主控台', pending: '正在讀取頁面主控台' },
    browser_get_images: { done: '已收集頁面圖片', pending: '正在收集頁面圖片' },
    browser_press: { done: '已按鍵', pending: '正在按鍵' },
    browser_scroll: { done: '已捲動頁面', pending: '正在捲動頁面' },
    browser_vision: { done: '已檢視頁面', pending: '正在檢視頁面' }
  },
  details: {
    request: '請求',
    output: '輸出',
    duration: '耗時',
    noOutput: '無輸出'
  },
  argLabels: {
    code: '程式碼',
    command: '指令',
    input: '輸入',
    path: '檔案',
    query: '搜尋',
    target: '目標',
    text: '文字',
    url: '網址'
  },
  viewer: {
    title: name => `${name}步驟`,
    step: (index, total) => `第 ${index} 步，共 ${total} 步`,
    noScreenshot: '此步驟沒有截圖',
    previous: '上一步',
    next: '下一步',
    openPage: '開啟頁面'
  }
}

export const TOOL_CARDS_LOCALES: PluginLocaleBundles = {
  en: { toolCards: TOOL_CARDS_EN },
  de: { toolCards: TOOL_CARDS_DE },
  es: { toolCards: TOOL_CARDS_ES },
  fr: { toolCards: TOOL_CARDS_FR },
  ja: { toolCards: TOOL_CARDS_JA },
  ru: { toolCards: TOOL_CARDS_RU },
  zh: { toolCards: TOOL_CARDS_ZH },
  ar: { toolCards: TOOL_CARDS_AR },
  'zh-hant': { toolCards: TOOL_CARDS_ZH_HANT }
}

/** Resolve `toolCards.<key>` in the plugin's own English bundle. Used before
 *  the bundle is registered (tests, a module evaluated early) and whenever the
 *  registry hands a key back unresolved. */
function englishFallback(key: string, args: unknown[]): string {
  const value = key
    .split('.')
    .slice(1)
    .reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), TOOL_CARDS_EN)

  if (typeof value === 'function') {
    return String((value as (...params: unknown[]) => string)(...args))
  }

  return typeof value === 'string' ? value : key
}

function withFallback(t: PluginTranslate | null): PluginTranslate {
  return (key, ...args) => {
    const value = t ? t(key, ...args) : key

    return value === key ? englishFallback(key, args) : value
  }
}

let moduleT: PluginTranslate | null = null

/** Hand the module-level translator over at `register`; `null` on unload. */
export function setToolCardsTranslator(t: PluginTranslate | null): void {
  moduleT = t
}

/** Non-reactive `toolCards.*` lookup for the card model (mirrors `translateNow`). */
export function toolCardsT(key: string, ...args: unknown[]): string {
  return withFallback(moduleT)(`toolCards.${key}`, ...args)
}

export type ToolCardsText = Bound<ToolCardsCopy>

/** Typed tool card strings for the active locale: `copy.viewer.openPage`. */
export function useToolCardsText(): ToolCardsText {
  const t = usePluginI18n(i18nId())

  return useMemo(() => bind(withFallback(t), TOOL_CARDS_EN, 'toolCards'), [t])
}
